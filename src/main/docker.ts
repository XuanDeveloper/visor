import { EventEmitter } from 'node:events'
import Docker from 'dockerode'
import type {
  ContainerStats,
  ContainerView,
  DockerState,
  HealthState,
  HostInfo,
  LogLine,
  PortBinding,
  StackView,
  VisorState
} from '@shared/types'
import { LOOSE_STACK } from '@shared/types'

/**
 * Camada sobre o dockerode. Mantém o estado do servidor em memória, reage ao
 * stream de /events para refletir mudanças na hora, e amostra stats em
 * intervalo próprio para não misturar duas cadências.
 */

/** Quantas amostras de CPU/MEM o sparkline guarda por container. */
const HISTORY_LEN = 40
/** Inspects simultâneos. Segura a fila sem afogar o túnel. */
const INSPECT_CONCURRENCY = 6

export interface DockerClientEvents {
  changed: () => void
  logLine: (line: LogLine) => void
  error: (err: Error) => void
}

export declare interface DockerClient {
  on<K extends keyof DockerClientEvents>(event: K, listener: DockerClientEvents[K]): this
  emit<K extends keyof DockerClientEvents>(
    event: K,
    ...args: Parameters<DockerClientEvents[K]>
  ): boolean
}

export class DockerClient extends EventEmitter {
  private docker: Docker | null = null
  private eventStream: NodeJS.ReadableStream | null = null
  private history = new Map<string, { cpu: number[]; mem: number[] }>()
  private statsCache = new Map<string, ContainerStats>()
  private logStreams = new Map<string, { stream: NodeJS.ReadableStream; seq: number }>()
  private lastStacks: StackView[] = []
  private lastHost: HostInfo | undefined
  private connected = false

  /** Religa o cliente em um endpoint novo (chamado quando o túnel sobe). */
  connect(endpoint: { host: string; port: number }): void {
    this.disconnect()
    this.docker = new Docker({ host: endpoint.host, port: endpoint.port, protocol: 'http' })
    this.connected = true
    void this.watchEvents()
  }

  disconnect(): void {
    this.connected = false
    for (const [, entry] of this.logStreams) destroyStream(entry.stream)
    this.logStreams.clear()
    if (this.eventStream) {
      destroyStream(this.eventStream)
      this.eventStream = null
    }
    this.docker = null
  }

  get isConnected(): boolean {
    return this.connected && this.docker !== null
  }

  get stacks(): StackView[] {
    return this.lastStacks
  }

  get host(): HostInfo | undefined {
    return this.lastHost
  }

  /**
   * Assina /events e dispara um refresh a cada mudança relevante. É isso que
   * faz a UI reagir instantaneamente em vez de esperar o próximo poll.
   */
  private async watchEvents(): Promise<void> {
    const docker = this.docker
    if (!docker) return
    try {
      const stream = (await docker.getEvents({
        filters: { type: ['container'] }
      })) as NodeJS.ReadableStream
      this.eventStream = stream
      stream.on('data', () => this.emit('changed'))
      stream.on('error', () => {
        /* o túnel cuida da reconexão; aqui só não derrubamos o processo */
      })
    } catch (err) {
      this.emit('error', err as Error)
    }
  }

  /** Lê a lista completa, enriquece com inspect e remonta as stacks. */
  async refresh(): Promise<void> {
    const docker = this.docker
    if (!docker) return

    const list = await docker.listContainers({ all: true })
    const live = new Set(list.map((c) => c.Id))
    for (const id of this.history.keys()) if (!live.has(id)) this.history.delete(id)
    for (const id of this.statsCache.keys()) if (!live.has(id)) this.statsCache.delete(id)

    const details = await mapWithConcurrency(list, INSPECT_CONCURRENCY, async (info) => {
      try {
        return await docker.getContainer(info.Id).inspect()
      } catch {
        // O container pode ter sumido entre o list e o inspect — ignora.
        return null
      }
    })

    const views: ContainerView[] = []
    list.forEach((info, i) => {
      const detail = details[i]
      if (!detail) return
      views.push(this.toView(info, detail))
    })

    this.lastStacks = groupIntoStacks(views)
    this.lastHost = await this.readHost(docker)
  }

  private async readHost(docker: Docker): Promise<HostInfo | undefined> {
    try {
      const info = await docker.info()
      const version = await docker.version()
      return {
        name: info.Name,
        dockerVersion: version.Version,
        os: `${info.OperatingSystem}`,
        arch: info.Architecture,
        cpus: info.NCPU,
        memTotalBytes: info.MemTotal,
        containersRunning: info.ContainersRunning,
        containersStopped: info.ContainersStopped + info.ContainersPaused,
        images: info.Images
      }
    } catch {
      return this.lastHost
    }
  }

  private toView(info: Docker.ContainerInfo, detail: Docker.ContainerInspectInfo): ContainerView {
    const labels = info.Labels ?? {}
    const stack = labels['com.docker.compose.project']
    const service = labels['com.docker.compose.service']
    const state = info.State as DockerState
    const health = readHealth(detail)
    const exitCode = detail.State.ExitCode
    const restartCount = detail.RestartCount ?? 0

    return {
      id: info.Id,
      name: (info.Names[0] ?? detail.Name ?? '').replace(/^\//, ''),
      image: info.Image,
      service,
      stack: stack && stack.length > 0 ? stack : undefined,
      state,
      visorState: deriveVisorState(state, health, exitCode),
      health,
      statusText: info.Status,
      createdAt: info.Created * 1000,
      startedAt: parseTime(detail.State.StartedAt),
      finishedAt: parseTime(detail.State.FinishedAt),
      exitCode: state === 'exited' ? exitCode : undefined,
      restartCount,
      ports: dedupePorts(info.Ports),
      stats: this.statsCache.get(info.Id)
    }
  }

  /** Amostra stats de todos os containers em execução, em paralelo controlado. */
  async sampleStats(): Promise<void> {
    const docker = this.docker
    if (!docker) return
    const running = this.lastStacks
      .flatMap((s) => s.containers)
      .filter((c) => c.state === 'running')

    await mapWithConcurrency(running, INSPECT_CONCURRENCY, async (container) => {
      try {
        const raw = (await docker
          .getContainer(container.id)
          .stats({ stream: false })) as unknown as Docker.ContainerStats
        const stats = this.computeStats(container.id, raw)
        this.statsCache.set(container.id, stats)
      } catch {
        /* container pode ter parado no meio da amostragem */
      }
    })

    // Reanexa as stats novas às views já montadas, sem refazer o inspect.
    for (const stack of this.lastStacks) {
      for (const c of stack.containers) c.stats = this.statsCache.get(c.id)
    }
  }

  private computeStats(id: string, raw: Docker.ContainerStats): ContainerStats {
    const cpuPercent = calcCpuPercent(raw)
    const memBytes = calcMemUsage(raw)
    const memLimit = raw.memory_stats?.limit ?? 0
    const memPercent = memLimit > 0 ? (memBytes / memLimit) * 100 : 0

    let rx = 0
    let tx = 0
    for (const iface of Object.values(raw.networks ?? {})) {
      rx += iface.rx_bytes ?? 0
      tx += iface.tx_bytes ?? 0
    }

    const hist = this.history.get(id) ?? { cpu: [], mem: [] }
    hist.cpu = pushCapped(hist.cpu, cpuPercent)
    hist.mem = pushCapped(hist.mem, memPercent)
    this.history.set(id, hist)

    return {
      cpuPercent,
      memBytes,
      memLimitBytes: memLimit,
      memPercent,
      netRxBytes: rx,
      netTxBytes: tx,
      cpuHistory: [...hist.cpu],
      memHistory: [...hist.mem]
    }
  }

  async act(
    id: string,
    action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause'
  ): Promise<void> {
    const docker = this.docker
    if (!docker) throw new Error('Sem conexão com o servidor.')
    const container = docker.getContainer(id)
    switch (action) {
      case 'start':
        await container.start()
        break
      case 'stop':
        await container.stop({ t: 10 })
        break
      case 'restart':
        await container.restart({ t: 10 })
        break
      case 'pause':
        await container.pause()
        break
      case 'unpause':
        await container.unpause()
        break
    }
  }

  /** Abre um stream de logs e emite linha a linha. Idempotente por container. */
  async subscribeLogs(id: string, tail = 300): Promise<void> {
    const docker = this.docker
    if (!docker) throw new Error('Sem conexão com o servidor.')
    if (this.logStreams.has(id)) return

    const container = docker.getContainer(id)
    const detail = await container.inspect()
    const stream = (await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
      tail
    })) as unknown as NodeJS.ReadableStream

    const entry = { stream, seq: 0 }
    this.logStreams.set(id, entry)

    const emit = (text: string, isErr: boolean): void => {
      for (const raw of text.split('\n')) {
        if (!raw.trim()) continue
        const { timestamp, body } = splitTimestamp(raw)
        this.emit('logLine', {
          containerId: id,
          seq: entry.seq++,
          timestamp,
          stream: isErr ? 'stderr' : 'stdout',
          text: body
        })
      }
    }

    if (detail.Config.Tty) {
      // Com TTY o Docker manda texto puro, sem o header de multiplexação.
      stream.on('data', (chunk: Buffer) => emit(chunk.toString('utf8'), false))
    } else {
      demuxDockerStream(stream, emit)
    }

    stream.on('error', () => this.unsubscribeLogs(id))
    stream.on('end', () => this.logStreams.delete(id))
  }

  unsubscribeLogs(id: string): void {
    const entry = this.logStreams.get(id)
    if (!entry) return
    destroyStream(entry.stream)
    this.logStreams.delete(id)
  }
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

/**
 * Colapsa estado + health + exit code na intenção visual.
 * Um container "running" mas unhealthy é 'degraded', não 'up' — é a distinção
 * que faz o rail avisar antes do serviço cair de vez.
 */
export function deriveVisorState(
  state: DockerState,
  health: HealthState,
  exitCode: number
): VisorState {
  if (state === 'running') {
    if (health === 'unhealthy') return 'degraded'
    if (health === 'starting') return 'transitioning'
    return 'up'
  }
  if (state === 'restarting' || state === 'created' || state === 'removing')
    return 'transitioning'
  if (state === 'paused') return 'degraded'
  if (state === 'dead') return 'failed'
  // exited
  return exitCode === 0 ? 'stopped' : 'failed'
}

function readHealth(detail: Docker.ContainerInspectInfo): HealthState {
  const status = detail.State.Health?.Status
  if (status === 'healthy' || status === 'unhealthy' || status === 'starting') return status
  return 'none'
}

/** Gravidade para escolher o pior estado de uma stack (governa a cor). */
const SEVERITY: Record<VisorState, number> = {
  failed: 0,
  degraded: 1,
  transitioning: 2,
  stopped: 3,
  up: 4
}

/**
 * Urgência para ordenar as stacks. Difere de SEVERITY de propósito: um
 * container parado com exit 0 — tipicamente um init de compose que já cumpriu
 * seu papel — não é um problema, então não pode empurrar a stack inteira para
 * o topo e enterrar o que de fato precisa de atenção.
 */
const URGENCY: Record<VisorState, number> = {
  failed: 0,
  degraded: 1,
  transitioning: 2,
  stopped: 3,
  up: 3
}

export function groupIntoStacks(containers: ContainerView[]): StackView[] {
  const byStack = new Map<string, ContainerView[]>()
  for (const c of containers) {
    const key = c.stack ?? LOOSE_STACK
    const bucket = byStack.get(key)
    if (bucket) bucket.push(c)
    else byStack.set(key, [c])
  }

  const stacks: StackView[] = []
  for (const [name, list] of byStack) {
    list.sort((a, b) => (a.service ?? a.name).localeCompare(b.service ?? b.name))
    const running = list.filter((c) => c.state === 'running').length
    const worst = list.reduce<VisorState>(
      (acc, c) => (SEVERITY[c.visorState] < SEVERITY[acc] ? c.visorState : acc),
      'up'
    )
    stacks.push({ name, containers: list, running, total: list.length, worst })
  }

  stacks.sort((a, b) => {
    // Avulsos sempre por último, independente da gravidade.
    if (a.name === LOOSE_STACK) return 1
    if (b.name === LOOSE_STACK) return -1
    const urgency = URGENCY[a.worst] - URGENCY[b.worst]
    return urgency !== 0 ? urgency : a.name.localeCompare(b.name)
  })
  return stacks
}

function calcCpuPercent(raw: Docker.ContainerStats): number {
  const cpu = raw.cpu_stats
  const pre = raw.precpu_stats
  if (!cpu?.cpu_usage || !pre?.cpu_usage) return 0
  const cpuDelta = cpu.cpu_usage.total_usage - pre.cpu_usage.total_usage
  const systemDelta = (cpu.system_cpu_usage ?? 0) - (pre.system_cpu_usage ?? 0)
  if (cpuDelta <= 0 || systemDelta <= 0) return 0
  const cores = cpu.online_cpus || cpu.cpu_usage.percpu_usage?.length || 1
  return (cpuDelta / systemDelta) * cores * 100
}

/**
 * O `usage` cru inclui o page cache, o que infla a leitura. Descontar
 * inactive_file (cgroup v2) ou cache (v1) dá o número que o `docker stats` mostra.
 */
function calcMemUsage(raw: Docker.ContainerStats): number {
  const usage = raw.memory_stats?.usage ?? 0
  const detail = raw.memory_stats?.stats as Record<string, number> | undefined
  if (!detail) return usage
  const offset = detail['inactive_file'] ?? detail['total_inactive_file'] ?? detail['cache'] ?? 0
  return Math.max(0, usage - offset)
}

function pushCapped(arr: number[], value: number): number[] {
  const next = [...arr, value]
  return next.length > HISTORY_LEN ? next.slice(next.length - HISTORY_LEN) : next
}

function parseTime(value?: string): number | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  // O Docker usa 0001-01-01 como "nunca".
  return Number.isNaN(ms) || ms < 0 ? undefined : ms
}

/** Portas repetem por protocolo/IP; a UI só quer o par único. */
function dedupePorts(ports: Docker.Port[] = []): PortBinding[] {
  const seen = new Map<string, PortBinding>()
  for (const p of ports) {
    const key = `${p.PrivatePort}/${p.Type}/${p.PublicPort ?? ''}`
    if (!seen.has(key)) {
      seen.set(key, { privatePort: p.PrivatePort, publicPort: p.PublicPort, type: p.Type })
    }
  }
  return [...seen.values()].sort((a, b) => (a.publicPort ?? 0) - (b.publicPort ?? 0))
}

/**
 * Sem TTY o Docker multiplexa stdout/stderr em frames de 8 bytes de header:
 * [stream_type, 0,0,0, size(uint32 BE)]. Precisamos reagrupar entre chunks.
 */
function demuxDockerStream(
  stream: NodeJS.ReadableStream,
  emit: (text: string, isErr: boolean) => void
): void {
  let buffer = Buffer.alloc(0)
  stream.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 8) {
      const size = buffer.readUInt32BE(4)
      if (buffer.length < 8 + size) break
      const type = buffer[0]
      const payload = buffer.subarray(8, 8 + size)
      buffer = buffer.subarray(8 + size)
      emit(payload.toString('utf8'), type === 2)
    }
  })
}

/** Separa o timestamp RFC3339 que o Docker prefixa quando timestamps:true. */
function splitTimestamp(line: string): { timestamp: number; body: string } {
  const space = line.indexOf(' ')
  if (space > 0) {
    const ms = Date.parse(line.slice(0, space))
    if (!Number.isNaN(ms)) return { timestamp: ms, body: line.slice(space + 1) }
  }
  return { timestamp: Date.now(), body: line }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function destroyStream(stream: NodeJS.ReadableStream): void {
  const destroyable = stream as NodeJS.ReadableStream & { destroy?: () => void }
  try {
    destroyable.destroy?.()
  } catch {
    /* já fechado */
  }
}
