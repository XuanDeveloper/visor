/**
 * Contrato único entre main, preload e renderer.
 * Tudo que cruza o IPC está tipado aqui.
 */

/** Estado bruto reportado pela Docker Engine API. */
export type DockerState =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead'

/** Resultado do healthcheck, quando o container define um. */
export type HealthState = 'healthy' | 'unhealthy' | 'starting' | 'none'

/**
 * Estado derivado que a UI realmente desenha. Colapsa os estados do Docker em
 * cinco intenções visuais — a cor e a forma do nó no rail saem daqui.
 */
export type VisorState = 'up' | 'degraded' | 'transitioning' | 'stopped' | 'failed'

export interface ContainerStats {
  /** Percentual de CPU do host (pode passar de 100% em multi-core). */
  cpuPercent: number
  memBytes: number
  memLimitBytes: number
  memPercent: number
  netRxBytes: number
  netTxBytes: number
  /** Janela deslizante de CPU% para o sparkline, mais antigo primeiro. */
  cpuHistory: number[]
  memHistory: number[]
}

export interface ContainerView {
  id: string
  /** Nome sem a barra inicial que a API devolve. */
  name: string
  image: string
  /** Nome do serviço no compose, quando houver. */
  service?: string
  /** Valor de com.docker.compose.project, ou undefined para containers avulsos. */
  stack?: string
  state: DockerState
  visorState: VisorState
  health: HealthState
  /** Texto cru do Docker, ex. "Up 12 days (healthy)". */
  statusText: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  exitCode?: number
  restartCount: number
  ports: PortBinding[]
  stats?: ContainerStats
}

export interface PortBinding {
  privatePort: number
  publicPort?: number
  type: string
}

export interface StackView {
  /** Nome do projeto compose, ou o sentinel '~loose' para avulsos. */
  name: string
  containers: ContainerView[]
  running: number
  total: number
  /** Pior estado entre os filhos — governa a cor do cabeçalho da stack. */
  worst: VisorState
}

export interface HostInfo {
  name: string
  dockerVersion: string
  os: string
  arch: string
  cpus: number
  memTotalBytes: number
  containersRunning: number
  containersStopped: number
  images: number
}

export type ConnectionPhase =
  | 'idle'
  /** Nenhum servidor definido ainda — primeira execução. */
  | 'unconfigured'
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'retrying'
  | 'error'

export interface ConnectionStatus {
  phase: ConnectionPhase
  /** Mensagem legível para humanos — vai direto para a tela de erro. */
  message?: string
  host?: string
  latencyMs?: number
  /** Timestamp do próximo retry automático, para a UI fazer a contagem. */
  retryAt?: number
}

export interface SshConfig {
  host: string
  port: number
  username: string
  /** Caminho para a chave privada. Tem precedência sobre password. */
  privateKeyPath?: string
  passphrase?: string
  password?: string
  /** Caminho do socket do Docker no servidor. */
  socketPath: string
}

/** Servidor encontrado no ~/.ssh/config de quem está usando. */
export interface SshHostSuggestion {
  /** O rótulo do bloco `Host`, que é como a pessoa reconhece o servidor. */
  alias: string
  hostname: string
  port: number
  username?: string
  identityFile?: string
}

export interface Preferences {
  ssh: SshConfig
  /** Intervalo de amostragem de stats, em ms. */
  statsIntervalMs: number
  notifyOnFailure: boolean
  notifyOnRestartLoop: boolean
  notifyOnRecovery: boolean
  /** Registra o app para subir junto com o Windows. */
  launchAtLogin: boolean
  startMinimized: boolean
  /** Stacks recolhidas, por nome. */
  collapsedStacks: string[]
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause'

export interface LogLine {
  containerId: string
  /** Monótono por container, usado como key do React. */
  seq: number
  timestamp: number
  stream: 'stdout' | 'stderr'
  text: string
}

/** Payload empurrado do main para o renderer a cada tick. */
export interface Snapshot {
  stacks: StackView[]
  host?: HostInfo
  connection: ConnectionStatus
  /** Quando o main montou este snapshot. */
  at: number
}

export const LOOSE_STACK = '~loose'

/** Sinais de animação do painel da bandeja (main → renderer). */
export const POPOVER_ENTER = 'visor:popover-enter'
export const POPOVER_EXIT = 'visor:popover-exit'

/** Canais IPC. Centralizados para evitar strings soltas nos dois lados. */
export const IPC = {
  snapshot: 'visor:snapshot',
  connection: 'visor:connection',
  logLine: 'visor:log-line',
  requestSnapshot: 'visor:request-snapshot',
  action: 'visor:action',
  reconnect: 'visor:reconnect',
  getPrefs: 'visor:get-prefs',
  sshHosts: 'visor:ssh-hosts',
  setPrefs: 'visor:set-prefs',
  testConnection: 'visor:test-connection',
  subscribeLogs: 'visor:subscribe-logs',
  unsubscribeLogs: 'visor:unsubscribe-logs',
  openPanel: 'visor:open-panel',
  closePopover: 'visor:close-popover',
  focusContainer: 'visor:focus-container',
  quit: 'visor:quit',
  windowMinimize: 'visor:window-minimize',
  windowMaximize: 'visor:window-maximize',
  windowHide: 'visor:window-hide'
} as const
