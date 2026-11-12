import type {
  ContainerView,
  DockerState,
  LogLine,
  Preferences,
  Snapshot,
  StackView,
  VisorState
} from '@shared/types'
import { LOOSE_STACK } from '@shared/types'

/**
 * Harness de desenvolvimento da UI.
 *
 * A topologia aqui é fictícia, montada com software self-hosted conhecido.
 * Nunca use dados de um servidor real: estas telas acabam em capturas e no
 * material público do projeto.
 *
 * Instalado apenas quando `window.visor` não existe — ou seja, ao abrir o
 * renderer direto no navegador (`npx vite src/renderer`) em vez de dentro do
 * Electron. Permite iterar no visual sem depender do servidor, e cobre de
 * propósito os estados difíceis: falha, loop de reinício, container sem
 * healthcheck, stack com init que já terminou.
 *
 * Os dados espelham a topologia real do servidor de referência.
 */

interface Seed {
  stack?: string
  service?: string
  name: string
  image: string
  state: DockerState
  visorState: VisorState
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none'
  ports?: number[]
  cpu?: number
  mem?: number
  exitCode?: number
  restarts?: number
  upHours?: number
}

const SEEDS: Seed[] = [
  // Stack grande e saudável.
  { stack: 'immich', service: 'server', name: 'immich-server', image: 'ghcr.io/immich-app/immich-server:v1.126', state: 'running', visorState: 'up', health: 'healthy', ports: [2283], cpu: 4.1, mem: 512, upHours: 73 },
  { stack: 'immich', service: 'machine-learning', name: 'immich-ml', image: 'ghcr.io/immich-app/immich-machine-learning', state: 'running', visorState: 'up', ports: [], cpu: 61.8, mem: 1870, upHours: 73 },
  { stack: 'immich', service: 'postgres', name: 'immich-postgres', image: 'tensorchord/pgvecto-rs:pg16', state: 'running', visorState: 'up', health: 'healthy', ports: [], cpu: 2.4, mem: 310, upHours: 73 },

  // Healthcheck falhando: o caso que o rail precisa denunciar.
  { stack: 'nextcloud', service: 'proxy', name: 'nextcloud-proxy', image: 'nginxproxy/nginx-proxy', state: 'running', visorState: 'up', health: 'healthy', ports: [443, 8443], cpu: 0.2, mem: 28, upHours: 410 },
  { stack: 'nextcloud', service: 'app', name: 'nextcloud-app', image: 'nextcloud:30-apache', state: 'running', visorState: 'up', ports: [], cpu: 0.1, mem: 64, upHours: 410 },
  { stack: 'nextcloud', service: 'cron', name: 'nextcloud-cron', image: 'nextcloud:30-apache', state: 'running', visorState: 'degraded', health: 'unhealthy', ports: [], cpu: 97.4, mem: 1420, upHours: 2 },
  { stack: 'nextcloud', service: 'db', name: 'nextcloud-db', image: 'mariadb:11', state: 'running', visorState: 'up', health: 'healthy', ports: [3306], cpu: 1.8, mem: 740, upHours: 410 },

  // Stack quebrada de verdade.
  { stack: 'monitoring', service: 'prometheus', name: 'prometheus', image: 'prom/prometheus:v3.1.0', state: 'exited', visorState: 'failed', exitCode: 2, restarts: 5 },
  { stack: 'monitoring', service: 'grafana', name: 'grafana', image: 'grafana/grafana:11.5.1', state: 'running', visorState: 'up', health: 'healthy', ports: [3000], cpu: 0.7, mem: 180, upHours: 96 },
  { stack: 'monitoring', service: 'node-exporter', name: 'node-exporter', image: 'prom/node-exporter', state: 'restarting', visorState: 'transitioning', restarts: 12 },

  // Infra com um init de compose que já terminou — exit 0, não é problema.
  { stack: 'infra', service: 'postgres', name: 'infra-postgres', image: 'postgres:17-alpine', state: 'running', visorState: 'up', health: 'healthy', ports: [5432], cpu: 2.4, mem: 310, upHours: 73 },
  { stack: 'infra', service: 'redis', name: 'infra-redis', image: 'redis:7.4-alpine', state: 'running', visorState: 'up', ports: [6379], cpu: 0.4, mem: 42, upHours: 73 },
  { stack: 'infra', service: 'minio', name: 'infra-minio', image: 'minio/minio', state: 'running', visorState: 'up', health: 'healthy', ports: [9000, 9001], cpu: 1.1, mem: 260, upHours: 73 },
  { stack: 'infra', service: 'minio-init', name: 'infra-minio-init', image: 'minio/mc', state: 'exited', visorState: 'stopped', exitCode: 0 },

  { stack: 'paperless', service: 'webserver', name: 'paperless-webserver', image: 'ghcr.io/paperless-ngx/paperless-ngx:2.14', state: 'running', visorState: 'up', health: 'healthy', ports: [8010], cpu: 1.2, mem: 288, upHours: 220 },
  { stack: 'paperless', service: 'broker', name: 'paperless-broker', image: 'redis:7', state: 'running', visorState: 'up', ports: [], cpu: 0.3, mem: 38, upHours: 220 },
  { stack: 'paperless', service: 'db', name: 'paperless-db', image: 'postgres:16', state: 'running', visorState: 'up', health: 'healthy', ports: [], cpu: 0.8, mem: 240, upHours: 220 },
  { stack: 'paperless', service: 'gotenberg', name: 'paperless-gotenberg', image: 'gotenberg/gotenberg:8', state: 'running', visorState: 'up', ports: [], cpu: 0.2, mem: 34, upHours: 220 },

  { stack: 'media', service: 'jellyfin', name: 'jellyfin', image: 'jellyfin/jellyfin:10.10.5', state: 'running', visorState: 'up', health: 'healthy', ports: [8096], cpu: 38.6, mem: 2240, upHours: 512 },
  { stack: 'media', service: 'qbittorrent', name: 'qbittorrent', image: 'lscr.io/linuxserver/qbittorrent', state: 'running', visorState: 'up', ports: [8080, 6881], cpu: 7.2, mem: 420, upHours: 512 },

  { stack: 'n8n', service: 'n8n', name: 'n8n', image: 'n8nio/n8n:1.76.1', state: 'running', visorState: 'up', health: 'healthy', ports: [5678], cpu: 1.4, mem: 390, upHours: 300 },
  { stack: 'vaultwarden', service: 'vaultwarden', name: 'vaultwarden', image: 'vaultwarden/server:1.33', state: 'running', visorState: 'up', health: 'healthy', ports: [8222], cpu: 0.3, mem: 72, upHours: 700 },
  { stack: 'homeassistant', service: 'homeassistant', name: 'homeassistant', image: 'ghcr.io/home-assistant/home-assistant:2025.1', state: 'running', visorState: 'up', ports: [8123], cpu: 0.6, mem: 96, upHours: 180 },
  { stack: 'whisper', service: 'whisper', name: 'whisper-asr', image: 'onerahmet/openai-whisper-asr-webservice', state: 'running', visorState: 'up', ports: [9010], cpu: 0.1, mem: 1540, upHours: 73 },
  { stack: 'traefik', service: 'traefik', name: 'traefik', image: 'traefik:v3.3', state: 'running', visorState: 'up', health: 'healthy', ports: [80, 8080], cpu: 12.4, mem: 680, upHours: 73 },

  { name: 'friendly_keller', image: 'alpine:3.21', state: 'exited', visorState: 'stopped', exitCode: 0 },
  { name: 'lucid_blackwell', image: 'busybox', state: 'created', visorState: 'transitioning' }
]

const HOUR = 3600_000
const MB = 1024 ** 2

/** Série sintética com um pouco de ruído, só para o sparkline ter forma. */
function series(base: number, length = 40): number[] {
  const out: number[] = []
  let v = base
  for (let i = 0; i < length; i++) {
    const wave = Math.sin(i / 4.5) * base * 0.22
    const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1
    v = Math.max(0, base + wave + noise * base * 0.18)
    out.push(v)
  }
  return out
}

function toContainer(seed: Seed, index: number): ContainerView {
  const now = Date.now()
  const started = seed.upHours ? now - seed.upHours * HOUR : undefined
  const running = seed.state === 'running'

  return {
    id: `mock${String(index).padStart(2, '0')}${'0'.repeat(58)}`,
    name: seed.name,
    image: seed.image,
    service: seed.service,
    stack: seed.stack,
    state: seed.state,
    visorState: seed.visorState,
    health: seed.health ?? 'none',
    statusText: running ? `Up ${seed.upHours}h` : `Exited (${seed.exitCode ?? 0})`,
    createdAt: now - (seed.upHours ?? 100) * HOUR - 2 * HOUR,
    startedAt: started,
    finishedAt: running ? undefined : now - 3 * HOUR,
    exitCode: seed.state === 'exited' ? seed.exitCode : undefined,
    restartCount: seed.restarts ?? 0,
    ports: (seed.ports ?? []).map((p) => ({ privatePort: p, publicPort: p, type: 'tcp' })),
    stats:
      running && seed.cpu !== undefined
        ? {
            cpuPercent: seed.cpu,
            memBytes: (seed.mem ?? 0) * MB,
            memLimitBytes: 15.1 * 1024 ** 3,
            memPercent: ((seed.mem ?? 0) * MB) / (15.1 * 1024 ** 3) * 100,
            netRxBytes: 1024 ** 2 * (seed.cpu * 31),
            netTxBytes: 1024 ** 2 * (seed.cpu * 12),
            cpuHistory: series(seed.cpu),
            memHistory: series(((seed.mem ?? 0) * MB) / (15.1 * 1024 ** 3) * 100)
          }
        : undefined
  }
}

const SEVERITY: Record<VisorState, number> = {
  failed: 0,
  degraded: 1,
  transitioning: 2,
  stopped: 3,
  up: 4
}

function buildStacks(): StackView[] {
  const containers = SEEDS.map(toContainer)
  const byStack = new Map<string, ContainerView[]>()
  for (const c of containers) {
    const key = c.stack ?? LOOSE_STACK
    byStack.set(key, [...(byStack.get(key) ?? []), c])
  }

  const stacks: StackView[] = [...byStack].map(([name, list]) => ({
    name,
    containers: list,
    running: list.filter((c) => c.state === 'running').length,
    total: list.length,
    worst: list.reduce<VisorState>(
      (acc, c) => (SEVERITY[c.visorState] < SEVERITY[acc] ? c.visorState : acc),
      'up'
    )
  }))

  stacks.sort((a, b) => {
    if (a.name === LOOSE_STACK) return 1
    if (b.name === LOOSE_STACK) return -1
    return SEVERITY[a.worst] - SEVERITY[b.worst] || a.name.localeCompare(b.name)
  })
  return stacks
}

const LOG_SAMPLES: Array<[string, 'stdout' | 'stderr']> = [
  ['GET /api/projects 200 · 14ms', 'stdout'],
  ['POST /api/render/queue 202 · 38ms', 'stdout'],
  ['worker: job 8841 picked up (transcode)', 'stdout'],
  ['ffmpeg: stream 0:0 -> h264, 1920x1080 @ 30fps', 'stdout'],
  ['WARN pool near capacity: 18/20 connections in use', 'stderr'],
  ['worker: job 8841 done in 4.2s', 'stdout'],
  ['GET /healthz 200 · 1ms', 'stdout'],
  ['ERROR upstream timeout after 30000ms (whisper:8765)', 'stderr'],
  ['retrying in 2s (attempt 2/5)', 'stdout'],
  ['GET /api/projects/4412 200 · 22ms', 'stdout']
]

export function installMockApi(): void {
  const prefs: Preferences = {
    ssh: {
      host: '192.168.0.10',
      port: 22,
      username: 'docker',
      privateKeyPath: 'C:\\Users\\você\\.ssh\\id_ed25519',
      socketPath: '/var/run/docker.sock'
    },
    statsIntervalMs: 3000,
    notifyOnFailure: true,
    notifyOnRestartLoop: true,
    notifyOnRecovery: false,
    launchAtLogin: true,
    startMinimized: false,
    collapsedStacks: []
  }

  const snapshot = (): Snapshot => ({
    stacks: buildStacks(),
    host: {
      name: 'homelab',
      dockerVersion: '27.5.1',
      os: 'Ubuntu 25.04',
      arch: 'x86_64',
      cpus: 8,
      memTotalBytes: 15.1 * 1024 ** 3,
      containersRunning: 22,
      containersStopped: 3,
      images: 64
    },
    connection: {
      phase: 'ready',
      host: 'docker@192.168.0.10',
      latencyMs: 41
    },
    at: Date.now()
  })

  const logHandlers = new Set<(line: LogLine) => void>()
  let seq = 0
  let activeLogId: string | null = null

  setInterval(() => {
    if (!activeLogId || logHandlers.size === 0) return
    const [text, stream] = LOG_SAMPLES[seq % LOG_SAMPLES.length]
    const line: LogLine = {
      containerId: activeLogId,
      seq: seq++,
      timestamp: Date.now(),
      stream,
      text
    }
    for (const h of logHandlers) h(line)
  }, 700)

  const snapshotHandlers = new Set<(s: Snapshot) => void>()
  setInterval(() => {
    for (const h of snapshotHandlers) h(snapshot())
  }, 3000)

  const noop = async (): Promise<void> => undefined

  window.visor = {
    getSnapshot: async () => snapshot(),
    getPrefs: async () => prefs,
    getSshHosts: async () => ({
      hosts: [
        { alias: 'homelab', hostname: '192.168.0.10', port: 22, username: 'docker' },
        { alias: 'vps', hostname: 'vps.exemplo.net', port: 2222, username: 'deploy' }
      ],
      defaultKey: 'C:\Users\voce\.ssh\id_ed25519'
    }),
    setPrefs: async (patch) => Object.assign(prefs, patch),
    reconnect: noop,
    act: noop,
    subscribeLogs: async (id: string) => {
      activeLogId = id
      seq = 0
    },
    unsubscribeLogs: async () => {
      activeLogId = null
    },
    onSnapshot: (handler) => {
      snapshotHandlers.add(handler)
      return () => snapshotHandlers.delete(handler)
    },
    onConnection: () => () => undefined,
    openPanel: noop,
    closePopover: noop,
    quit: noop,
    onFocusContainer: () => () => undefined,
    onPopoverMotion: () => () => undefined,
    onLogLine: (handler) => {
      logHandlers.add(handler)
      return () => logHandlers.delete(handler)
    },
    window: { minimize: noop, maximize: noop, hide: noop }
  }
}

/**
 * Abre a UI já em um estado específico, para revisão visual e capturas:
 *   ?view=inspector | search | settings | collapsed
 * Só existe no harness; dentro do Electron esse arquivo nunca é carregado.
 */
export function applyViewFromQuery(): void {
  const view = new URLSearchParams(location.search).get('view')
  if (!view) return

  const click = (selector: string, index = 0): void => {
    const el = document.querySelectorAll<HTMLElement>(selector)[index]
    el?.click()
  }

  // Espera o primeiro render do React antes de mexer no DOM.
  setTimeout(() => {
    if (view === 'inspector') click('.row')
    if (view === 'settings') click('.titlebar .iconbtn')
    if (view === 'collapsed') {
      document.querySelectorAll<HTMLElement>('.stack__head').forEach((el) => el.click())
    }
    if (view === 'search') {
      const input = document.querySelector<HTMLInputElement>('.search input')
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(input, 'postgres')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, 400)
}
