import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type IpcMainInvokeEvent
} from 'electron'
import type {
  ConnectionStatus,
  ContainerAction,
  Preferences,
  Snapshot,
  VisorState
} from '@shared/types'
import { IPC } from '@shared/types'
import { getPrefs, setPrefs } from './config'
import { guessDefaultKey, readSshHosts } from './sshConfig'
import { DockerClient } from './docker'
import { Popover, preloadFor } from './popover'
import { Tunnel } from './tunnel'
import { Watcher } from './watcher'

/**
 * Orquestra os três atores: o túnel SSH, o cliente Docker e a janela.
 * O app vive na bandeja — fechar a janela esconde, não encerra.
 */

/** Cadência do refresh da lista. Os eventos do Docker cobrem o resto. */
const REFRESH_MS = 4000

/** Janela completa: existe só sob demanda, quando o usuário pede logs/detalhe. */
let win: BrowserWindow | null = null
/** O painel da bandeja — a forma principal do app. */
let popover: Popover | null = null
let tray: Tray | null = null
/** Só o Ctrl+Q / "Sair" da bandeja liberam o encerramento de verdade. */
let allowQuit = false
/**
 * O item de inicialização do Windows passa --hidden: nesse caso o app sobe
 * direto para a bandeja, sem roubar foco de quem acabou de ligar a máquina.
 */
const startedHidden = process.argv.includes('--hidden')

const docker = new DockerClient()
const watcher = new Watcher()
let tunnel: Tunnel
let refreshTimer: NodeJS.Timeout | null = null
let statsTimer: NodeJS.Timeout | null = null
/** Guarda o último estado agregado para não redesenhar o tray à toa. */
let trayState: VisorState | 'offline' | null = null
/** Impede refreshes concorrentes quando um evento chega durante um poll. */
let refreshing = false

/**
 * Registra (ou remove) o Visor na inicialização do Windows.
 *
 * Só faz efeito no app empacotado: em desenvolvimento `getPath('exe')` é o
 * electron.exe do node_modules, e registrar isso criaria uma entrada quebrada
 * no registro do usuário.
 */
function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Sobe silencioso: quem liga o PC não pediu uma janela na cara.
    args: ['--hidden']
  })
}

/**
 * Caminho de um recurso empacotado.
 *
 * `getAppPath()` vale nos dois modos: em desenvolvimento é a raiz do projeto, e
 * no app instalado aponta para dentro do app.asar — que o Electron lê de forma
 * transparente. Usar `process.resourcesPath` aqui seria errado: os ícones são
 * empacotados no asar, não copiados para fora dele.
 */
const resourcePath = (file: string): string => join(app.getAppPath(), 'resources', file)

/* ------------------------------------------------------------------ */
/* Janela                                                              */
/* ------------------------------------------------------------------ */

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    // Frameless: a barra de título é desenhada pela própria UI.
    frame: false,
    backgroundColor: '#0e0f15',
    icon: resourcePath('icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // A janela completa é sempre aberta por um gesto explícito, então mostrar
  // ao ficar pronta é o comportamento certo — nunca é criada "de fundo".
  window.on('ready-to-show', () => window.show())

  // Fechar a janela só esconde — o app continua vigiando em segundo plano.
  window.on('close', (event) => {
    if (allowQuit) return
    event.preventDefault()
    window.hide()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?mode=panel`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { search: '?mode=panel' })
  }

  return window
}

function showWindow(): void {
  if (!win || win.isDestroyed()) win = createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/* ------------------------------------------------------------------ */
/* Bandeja                                                             */
/* ------------------------------------------------------------------ */

/** Pior estado entre todas as stacks — é o que o ícone da bandeja comunica. */
function aggregateState(): VisorState | 'offline' {
  if (!docker.isConnected || tunnel.status.phase !== 'ready') return 'offline'
  const order: VisorState[] = ['failed', 'degraded', 'transitioning', 'stopped', 'up']
  const present = new Set(docker.stacks.map((s) => s.worst))
  return order.find((s) => present.has(s)) ?? 'up'
}

function trayIconFor(state: VisorState | 'offline'): string {
  if (state === 'offline') return 'tray-offline.png'
  if (state === 'failed') return 'tray-fail.png'
  if (state === 'degraded' || state === 'transitioning') return 'tray-warn.png'
  return 'tray-ok.png'
}

function refreshTray(): void {
  if (!tray) return
  const state = aggregateState()
  const host = docker.host?.name ?? getPrefs().ssh.host

  if (state !== trayState) {
    trayState = state
    tray.setImage(nativeImage.createFromPath(resourcePath(trayIconFor(state))))
  }

  const running = docker.stacks.flatMap((s) => s.containers).filter((c) => c.state === 'running')
  const total = docker.stacks.reduce((n, s) => n + s.total, 0)
  const summary =
    state === 'offline' ? 'Desconectado' : `${running.length}/${total} containers rodando`
  tray.setToolTip(`Visor · ${host}\n${summary}`)

  const trouble = docker.stacks
    .filter((s) => s.worst === 'failed' || s.worst === 'degraded')
    .slice(0, 6)

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${host} · ${summary}`, enabled: false },
      ...(trouble.length > 0
        ? [
            { type: 'separator' as const },
            ...trouble.map((s) => ({
              label: `${s.worst === 'failed' ? '✕' : '!'}  ${s.name}  (${s.running}/${s.total})`,
              click: () => showWindow()
            }))
          ]
        : []),
      { type: 'separator' },
      { label: 'Abrir painel', accelerator: 'CommandOrControl+Shift+D', click: () => popover?.show() },
      { label: 'Janela completa', click: () => showWindow() },
      { label: 'Reconectar', click: () => void tunnel.restart() },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          allowQuit = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(resourcePath('tray-offline.png')))
  // Clique esquerdo abre o painel ancorado; o menu de contexto fica no direito.
  popover?.attach(tray)
  refreshTray()
}

/* ------------------------------------------------------------------ */
/* Ciclo de dados                                                      */
/* ------------------------------------------------------------------ */

/** Empurra para as duas superfícies: o painel da bandeja e a janela completa. */
function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  popover?.send(channel, payload)
}

function buildSnapshot(): Snapshot {
  return {
    stacks: docker.stacks,
    host: docker.host,
    connection: tunnel.status,
    at: Date.now()
  }
}

function pushSnapshot(): void {
  send(IPC.snapshot, buildSnapshot())
  refreshTray()
}

async function doRefresh(): Promise<void> {
  if (refreshing || !docker.isConnected) return
  refreshing = true
  try {
    await docker.refresh()
    watcher.inspect(docker.stacks, getPrefs())
    pushSnapshot()
  } catch (err) {
    send(IPC.connection, {
      ...tunnel.status,
      message: (err as Error).message
    } satisfies ConnectionStatus)
  } finally {
    refreshing = false
  }
}

async function doStats(): Promise<void> {
  if (!docker.isConnected) return
  try {
    await docker.sampleStats()
    pushSnapshot()
  } catch {
    /* uma amostra perdida não é motivo de alarme */
  }
}

function startLoops(): void {
  stopLoops()
  refreshTimer = setInterval(() => void doRefresh(), REFRESH_MS)
  statsTimer = setInterval(() => void doStats(), getPrefs().statsIntervalMs)
}

function stopLoops(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  if (statsTimer) clearInterval(statsTimer)
  refreshTimer = null
  statsTimer = null
}

function wireTunnel(): void {
  tunnel = new Tunnel(getPrefs().ssh)

  tunnel.on('status', (status) => {
    send(IPC.connection, status)
    refreshTray()
  })

  tunnel.on('up', (endpoint) => {
    docker.connect(endpoint)
    // O túnel novo pode ter atravessado uma queda longa; não alertar em massa.
    watcher.reset()
    void doRefresh().then(() => doStats())
    startLoops()
  })

  tunnel.on('down', () => {
    stopLoops()
    docker.disconnect()
    watcher.reset()
    pushSnapshot()
  })

  // Um evento do Docker chega antes do próximo poll — reflete na hora.
  docker.on('changed', () => void doRefresh())
  docker.on('logLine', (line) => send(IPC.logLine, line))
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function wireIpc(): void {
  ipcMain.handle(IPC.requestSnapshot, () => buildSnapshot())
  ipcMain.handle(IPC.getPrefs, () => getPrefs())

  // Sugestões para a primeira execução: quem roda Docker remoto quase sempre
  // já tem o host no próprio ~/.ssh/config.
  ipcMain.handle(IPC.sshHosts, async () => ({
    hosts: await readSshHosts(),
    defaultKey: await guessDefaultKey()
  }))

  ipcMain.handle(IPC.setPrefs, async (_e: IpcMainInvokeEvent, patch: Partial<Preferences>) => {
    const before = getPrefs()
    const next = setPrefs(patch)
    if (JSON.stringify(before.ssh) !== JSON.stringify(next.ssh)) {
      await tunnel.reconfigure(next.ssh)
    }
    if (before.statsIntervalMs !== next.statsIntervalMs && docker.isConnected) startLoops()
    if (before.launchAtLogin !== next.launchAtLogin) applyLaunchAtLogin(next.launchAtLogin)
    return next
  })

  ipcMain.handle(IPC.reconnect, async () => {
    await tunnel.restart()
  })

  ipcMain.handle(
    IPC.action,
    async (_e: IpcMainInvokeEvent, payload: { id: string; action: ContainerAction }) => {
      await docker.act(payload.id, payload.action)
      await doRefresh()
    }
  )

  ipcMain.handle(IPC.subscribeLogs, async (_e: IpcMainInvokeEvent, id: string) => {
    await docker.subscribeLogs(id)
  })

  ipcMain.handle(IPC.unsubscribeLogs, (_e: IpcMainInvokeEvent, id: string) => {
    docker.unsubscribeLogs(id)
  })

  // O painel da bandeja pede a janela completa (logs, inspetor, detalhe).
  ipcMain.handle(IPC.openPanel, (_e: IpcMainInvokeEvent, containerId?: string) => {
    popover?.hide()
    showWindow()
    if (containerId) send(IPC.focusContainer, containerId)
  })

  ipcMain.handle(IPC.closePopover, () => popover?.hide())

  ipcMain.handle(IPC.quit, () => {
    allowQuit = true
    app.quit()
  })

  ipcMain.handle(IPC.windowMinimize, () => win?.minimize())
  ipcMain.handle(IPC.windowMaximize, () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IPC.windowHide, () => win?.hide())
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

// Instância única: a segunda invocação apenas traz a janela para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.visor.app')

    applyLaunchAtLogin(getPrefs().launchAtLogin)
    wireTunnel()
    wireIpc()
    watcher.setOpenHandler(() => showWindow())

    popover = new Popover(
      preloadFor(__dirname),
      process.env['ELECTRON_RENDERER_URL'] ?? null,
      join(__dirname, '../renderer/index.html')
    )
    createTray()

    // Atalho global. Falha em silêncio se outro app já registrou a combinação
    // — não vale derrubar a inicialização por causa disso.
    const ok = globalShortcut.register('CommandOrControl+Shift+D', () => popover?.toggle())
    if (!ok) console.warn('Ctrl+Shift+D já está em uso; o atalho global ficou de fora.')

    // A janela completa não existe até alguém pedir: o app é o painel.
    if (!getPrefs().startMinimized && !startedHidden) popover.show()

    void tunnel.start()

    app.on('activate', () => showWindow())
  })

  // Sem isso o app encerraria ao esconder a última janela no Windows.
  app.on('window-all-closed', () => {
    /* intencionalmente vazio: o app vive na bandeja */
  })

  app.on('before-quit', () => {
    allowQuit = true
    stopLoops()
    docker.disconnect()
    tunnel?.dispose()
    popover?.destroy()
    globalShortcut.unregisterAll()
  })
}
