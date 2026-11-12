import { join } from 'node:path'
import { BrowserWindow, screen, type Tray } from 'electron'
import { POPOVER_ENTER, POPOVER_EXIT } from '@shared/types'

/**
 * O painel ancorado na bandeja — a forma principal do Visor, no espírito dos
 * menu bar apps do macOS: o ícone *é* o app, clicou abre ali mesmo.
 *
 * Duas armadilhas do Windows são tratadas aqui:
 *
 * 1. Clicar no ícone da bandeja não transfere foco para a janela, então o
 *    handler de `blur` dispara logo após o `show` e a janela pisca e some.
 *    Resolvido com uma janela de carência após exibir.
 * 2. Clicar no ícone com o painel aberto dispara `blur` (que esconde) e em
 *    seguida `click` (que mostraria de novo). Sem guarda, o toggle nunca
 *    fecha. Resolvido lembrando quando foi a última ocultação.
 */

const WIDTH = 416
const HEIGHT = 672
/** Respiro entre o painel e a borda da tela/bandeja. */
const GAP = 10
/** Carência após exibir, durante a qual um blur é ignorado. */
const BLUR_GRACE_MS = 420
/** Clique no ícone logo após fechar não deve reabrir. */
const REOPEN_GUARD_MS = 260
/**
 * Tempo dado ao renderer para tocar a animação de saída antes de a janela
 * sumir. Precisa acompanhar --pop-out em popover.css.
 */
const EXIT_MS = 160

export class Popover {
  private win: BrowserWindow
  private tray: Tray | null = null
  private ignoreBlurUntil = 0
  private hiddenAt = 0
  /** Evita empilhar animações de saída se o blur dispara mais de uma vez. */
  private exiting = false

  constructor(preloadPath: string, rendererUrl: string | null, rendererFile: string) {
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Fora da barra de tarefas e do Alt+Tab: é um painel, não uma janela.
      skipTaskbar: true,
      alwaysOnTop: true,
      // Transparente para que a entrada anime a si mesma (escala + fade) em
      // vez de surgir como um retângulo opaco e animar o conteúdo lá dentro.
      transparent: true,
      hasShadow: false,
      webPreferences: {
        preload: preloadPath,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    this.win.setAlwaysOnTop(true, 'pop-up-menu')

    this.win.on('blur', () => {
      if (Date.now() < this.ignoreBlurUntil) return
      this.hide()
    })

    // Fechar a janela nunca destrói o painel — ele só esconde.
    this.win.on('close', (event) => {
      event.preventDefault()
      this.hide()
    })

    const query = '?mode=popover'
    if (rendererUrl) void this.win.loadURL(`${rendererUrl}${query}`)
    else void this.win.loadFile(rendererFile, { search: query })
  }

  /** Liga o painel ao ícone da bandeja, incluindo o toggle no clique esquerdo. */
  attach(tray: Tray): void {
    this.tray = tray
    tray.on('click', () => this.toggle())
  }

  get window(): BrowserWindow {
    return this.win
  }

  get isVisible(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible()
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide()
      return
    }
    // Sem isto, o blur disparado pelo próprio clique fecharia e o clique
    // reabriria em seguida — o painel nunca fecharia pelo ícone.
    if (Date.now() - this.hiddenAt < REOPEN_GUARD_MS) return
    this.show()
  }

  show(): void {
    if (this.win.isDestroyed()) return
    this.exiting = false
    this.position()
    this.ignoreBlurUntil = Date.now() + BLUR_GRACE_MS
    this.win.show()
    this.win.focus()
    // O renderer reinicia a animação de entrada a cada exibição.
    this.send(POPOVER_ENTER, null)
  }

  /** Toca a saída no renderer e só então tira a janela da tela. */
  hide(): void {
    if (this.win.isDestroyed() || !this.win.isVisible() || this.exiting) return
    this.exiting = true
    this.hiddenAt = Date.now()
    this.send(POPOVER_EXIT, null)
    setTimeout(() => {
      if (this.win.isDestroyed()) return
      this.win.hide()
      this.exiting = false
      // Carimba de novo: o guarda de reabertura conta a partir do sumiço real.
      this.hiddenAt = Date.now()
    }, EXIT_MS)
  }

  send(channel: string, payload: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  destroy(): void {
    this.win.removeAllListeners('close')
    if (!this.win.isDestroyed()) this.win.destroy()
  }

  /**
   * Ancora o painel no ícone da bandeja, respeitando a área útil do monitor.
   *
   * `tray.getBounds()` devolve zeros quando o ícone está no flyout de ícones
   * ocultos; nesse caso caímos no canto da área de trabalho, que é onde o
   * usuário espera encontrar o painel de qualquer forma.
   */
  private position(): void {
    const bounds = this.tray?.getBounds()
    const anchorPoint =
      bounds && bounds.width > 0
        ? { x: Math.round(bounds.x + bounds.width / 2), y: bounds.y }
        : screen.getCursorScreenPoint()

    const display = screen.getDisplayNearestPoint(anchorPoint)
    const area = display.workArea

    let x = Math.round(anchorPoint.x - WIDTH / 2)
    // Acima do ícone quando a barra está embaixo; abaixo quando está em cima.
    const trayAtTop = bounds && bounds.width > 0 ? bounds.y < area.y + area.height / 2 : false
    let y = trayAtTop
      ? (bounds ? bounds.y + bounds.height : area.y) + GAP
      : (bounds && bounds.width > 0 ? bounds.y : area.y + area.height) - HEIGHT - GAP

    // Mantém o painel inteiro dentro da área útil.
    x = Math.min(Math.max(x, area.x + GAP), area.x + area.width - WIDTH - GAP)
    y = Math.min(Math.max(y, area.y + GAP), area.y + area.height - HEIGHT - GAP)

    this.win.setBounds({ x, y, width: WIDTH, height: HEIGHT })
  }
}

/** Resolve o caminho do preload a partir do diretório do bundle do main. */
export const preloadFor = (dirname: string): string => join(dirname, '../preload/index.js')
