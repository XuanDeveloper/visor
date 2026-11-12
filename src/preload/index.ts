import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionStatus,
  ContainerAction,
  LogLine,
  Preferences,
  Snapshot,
  SshHostSuggestion
} from '@shared/types'
import { IPC, POPOVER_ENTER, POPOVER_EXIT } from '@shared/types'

/**
 * Superfície única que o renderer enxerga. Nada de ipcRenderer solto na UI —
 * cada canal vira um método tipado, e cada assinatura devolve seu unsubscribe.
 */
const api = {
  getSnapshot: (): Promise<Snapshot> => ipcRenderer.invoke(IPC.requestSnapshot),
  getPrefs: (): Promise<Preferences> => ipcRenderer.invoke(IPC.getPrefs),
  /** Servidores encontrados no ~/.ssh/config, para preencher o formulário. */
  getSshHosts: (): Promise<{ hosts: SshHostSuggestion[]; defaultKey?: string }> =>
    ipcRenderer.invoke(IPC.sshHosts),
  setPrefs: (patch: Partial<Preferences>): Promise<Preferences> =>
    ipcRenderer.invoke(IPC.setPrefs, patch),
  reconnect: (): Promise<void> => ipcRenderer.invoke(IPC.reconnect),

  act: (id: string, action: ContainerAction): Promise<void> =>
    ipcRenderer.invoke(IPC.action, { id, action }),

  subscribeLogs: (id: string): Promise<void> => ipcRenderer.invoke(IPC.subscribeLogs, id),
  unsubscribeLogs: (id: string): Promise<void> => ipcRenderer.invoke(IPC.unsubscribeLogs, id),

  onSnapshot: (handler: (snapshot: Snapshot) => void): (() => void) => {
    const listener = (_e: unknown, snapshot: Snapshot): void => handler(snapshot)
    ipcRenderer.on(IPC.snapshot, listener)
    return () => ipcRenderer.removeListener(IPC.snapshot, listener)
  },

  onConnection: (handler: (status: ConnectionStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: ConnectionStatus): void => handler(status)
    ipcRenderer.on(IPC.connection, listener)
    return () => ipcRenderer.removeListener(IPC.connection, listener)
  },

  onLogLine: (handler: (line: LogLine) => void): (() => void) => {
    const listener = (_e: unknown, line: LogLine): void => handler(line)
    ipcRenderer.on(IPC.logLine, listener)
    return () => ipcRenderer.removeListener(IPC.logLine, listener)
  },

  /** Pede a janela completa, opcionalmente já focando um container. */
  openPanel: (containerId?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.openPanel, containerId),
  closePopover: (): Promise<void> => ipcRenderer.invoke(IPC.closePopover),
  quit: (): Promise<void> => ipcRenderer.invoke(IPC.quit),

  onFocusContainer: (handler: (id: string) => void): (() => void) => {
    const listener = (_e: unknown, id: string): void => handler(id)
    ipcRenderer.on(IPC.focusContainer, listener)
    return () => ipcRenderer.removeListener(IPC.focusContainer, listener)
  },

  /** Sinais de animação do painel: entrada ao exibir, saída antes de esconder. */
  onPopoverMotion: (handler: (phase: 'enter' | 'exit') => void): (() => void) => {
    const enter = (): void => handler('enter')
    const exit = (): void => handler('exit')
    ipcRenderer.on(POPOVER_ENTER, enter)
    ipcRenderer.on(POPOVER_EXIT, exit)
    return () => {
      ipcRenderer.removeListener(POPOVER_ENTER, enter)
      ipcRenderer.removeListener(POPOVER_EXIT, exit)
    }
  },

  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
    maximize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMaximize),
    hide: (): Promise<void> => ipcRenderer.invoke(IPC.windowHide)
  }
}

export type VisorApi = typeof api

contextBridge.exposeInMainWorld('visor', api)
