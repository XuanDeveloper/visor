import { EventEmitter } from 'node:events'
import net from 'node:net'
import { readFile } from 'node:fs/promises'
import { Client, type ClientChannel } from 'ssh2'
import type { ConnectionStatus, SshConfig } from '@shared/types'

/**
 * Abre uma conexão SSH e publica um endpoint TCP local que entrega cada
 * conexão no /var/run/docker.sock do servidor, via a extensão
 * direct-streamlocal@openssh.com. Com isso o dockerode fala a Docker Engine
 * API inteira — incluindo os streams de /events, /stats e /logs — sem expor
 * nenhuma porta no servidor.
 *
 * Reconecta sozinho com backoff exponencial; a UI só observa `status`.
 */

/** Backoff: 1s, 2s, 4s, 8s, 15s, 30s e depois estaciona em 30s. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
const KEEPALIVE_MS = 10_000
const CONNECT_TIMEOUT_MS = 15_000

export interface TunnelEvents {
  status: (status: ConnectionStatus) => void
  /** Emitido sempre que um túnel novo fica pronto — o Docker client religa aqui. */
  up: (endpoint: { host: string; port: number }) => void
  down: () => void
}

export declare interface Tunnel {
  on<K extends keyof TunnelEvents>(event: K, listener: TunnelEvents[K]): this
  emit<K extends keyof TunnelEvents>(event: K, ...args: Parameters<TunnelEvents[K]>): boolean
}

export class Tunnel extends EventEmitter {
  private ssh: Client | null = null
  private server: net.Server | null = null
  private config: SshConfig
  private attempt = 0
  private retryTimer: NodeJS.Timeout | null = null
  private disposed = false
  /** Evita que dois caminhos de erro disparem duas reconexões para o mesmo ciclo. */
  private generation = 0

  private _status: ConnectionStatus = { phase: 'idle' }

  constructor(config: SshConfig) {
    super()
    this.config = config
  }

  get status(): ConnectionStatus {
    return this._status
  }

  private setStatus(next: Partial<ConnectionStatus>): void {
    this._status = { ...this._status, ...next }
    this.emit('status', this._status)
  }

  /** Troca a configuração e religa do zero. */
  async reconfigure(config: SshConfig): Promise<void> {
    this.config = config
    this.attempt = 0
    await this.restart()
  }

  /** Força uma reconexão imediata, zerando o backoff. */
  async restart(): Promise<void> {
    this.attempt = 0
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.teardown()
    await this.connect()
  }

  async start(): Promise<void> {
    this.disposed = false
    await this.connect()
  }

  dispose(): void {
    this.disposed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.teardown()
    this.setStatus({ phase: 'idle', message: undefined })
  }

  private teardown(): void {
    this.generation++
    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (this.ssh) {
      // removeAllListeners antes de end() para o handler de 'close' não
      // reagendar um retry que já está sendo gerenciado por quem chamou.
      this.ssh.removeAllListeners()
      try {
        this.ssh.end()
      } catch {
        /* socket já morto */
      }
      this.ssh = null
    }
  }

  private scheduleRetry(reason: string): void {
    if (this.disposed) return
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
    this.attempt++
    this.setStatus({
      phase: 'retrying',
      message: reason,
      retryAt: Date.now() + delay
    })
    this.emit('down')
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, delay)
  }

  private async readAuth(): Promise<{ privateKey?: Buffer; password?: string }> {
    const { privateKeyPath, password } = this.config
    if (privateKeyPath) {
      try {
        return { privateKey: await readFile(privateKeyPath) }
      } catch (err) {
        throw new Error(
          `Não consegui ler a chave em ${privateKeyPath}: ${(err as Error).message}`
        )
      }
    }
    if (password) return { password }
    throw new Error('Nenhuma chave privada nem senha configurada.')
  }

  private async connect(): Promise<void> {
    if (this.disposed) return
    this.teardown()

    // Sem servidor definido não há o que tentar. Entrar em retry aqui
    // produziria uma tela de erro para quem ainda nem configurou nada.
    if (!this.config.host.trim() || !this.config.username.trim()) {
      this.setStatus({
        phase: 'unconfigured',
        host: undefined,
        message: undefined,
        retryAt: undefined
      })
      return
    }

    const gen = this.generation
    const label = `${this.config.username}@${this.config.host}:${this.config.port}`
    this.setStatus({ phase: 'connecting', host: label, message: undefined, retryAt: undefined })

    let auth: { privateKey?: Buffer; password?: string }
    try {
      auth = await this.readAuth()
    } catch (err) {
      // Erro de configuração não melhora com retry — para e espera o usuário.
      this.setStatus({ phase: 'error', message: (err as Error).message })
      return
    }

    const ssh = new Client()
    this.ssh = ssh
    const startedAt = Date.now()

    ssh.on('ready', () => {
      if (gen !== this.generation) return
      this.setStatus({ phase: 'authenticating' })
      void this.publishEndpoint(ssh, gen, Date.now() - startedAt)
    })

    ssh.on('error', (err) => {
      if (gen !== this.generation) return
      this.scheduleRetry(humanizeSshError(err))
    })

    ssh.on('close', () => {
      if (gen !== this.generation) return
      if (this._status.phase === 'ready') this.scheduleRetry('Conexão encerrada pelo servidor.')
    })

    ssh.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([]))

    ssh.connect({
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      privateKey: auth.privateKey,
      passphrase: this.config.passphrase || undefined,
      password: auth.password,
      readyTimeout: CONNECT_TIMEOUT_MS,
      keepaliveInterval: KEEPALIVE_MS,
      keepaliveCountMax: 3
    })
  }

  /**
   * Valida que o socket remoto responde e, só então, sobe o listener local.
   * Falhar cedo aqui dá uma mensagem muito melhor do que deixar o dockerode
   * estourar ECONNRESET depois.
   */
  private async publishEndpoint(ssh: Client, gen: number, handshakeMs: number): Promise<void> {
    try {
      await probeSocket(ssh, this.config.socketPath)
    } catch (err) {
      if (gen !== this.generation) return
      this.setStatus({ phase: 'error', message: (err as Error).message })
      this.emit('down')
      return
    }
    if (gen !== this.generation) return

    const server = net.createServer((local) => {
      ssh.openssh_forwardOutStreamLocal(this.config.socketPath, (err, remote) => {
        if (err) {
          local.destroy()
          return
        }
        pipeDuplex(local, remote)
      })
    })

    server.on('error', (err) => {
      if (gen !== this.generation) return
      this.scheduleRetry(`Falha no listener local: ${err.message}`)
    })

    this.server = server
    server.listen(0, '127.0.0.1', () => {
      if (gen !== this.generation) {
        server.close()
        return
      }
      const address = server.address()
      if (typeof address === 'string' || address === null) {
        this.scheduleRetry('Não consegui determinar a porta local.')
        return
      }
      this.attempt = 0
      this.setStatus({
        phase: 'ready',
        message: undefined,
        latencyMs: handshakeMs,
        retryAt: undefined
      })
      this.emit('up', { host: '127.0.0.1', port: address.port })
    })
  }
}

/** Abre um stream descartável para o socket só para confirmar que ele existe. */
function probeSocket(ssh: Client, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('O servidor não respondeu ao abrir o socket do Docker.')),
      CONNECT_TIMEOUT_MS
    )
    ssh.openssh_forwardOutStreamLocal(socketPath, (err, stream) => {
      clearTimeout(timer)
      if (err) {
        reject(
          new Error(
            `Não consegui abrir ${socketPath} no servidor. ` +
              `Confirme que o Docker está rodando e que o usuário está no grupo "docker". (${err.message})`
          )
        )
        return
      }
      stream.destroy()
      resolve()
    })
  })
}

function pipeDuplex(local: net.Socket, remote: ClientChannel): void {
  local.pipe(remote)
  remote.pipe(local)
  const close = (): void => {
    local.destroy()
    remote.destroy()
  }
  local.on('error', close)
  remote.on('error', close)
  local.on('close', close)
  remote.on('close', close)
}

/** Traduz os erros crus do ssh2 para algo acionável na tela. */
function humanizeSshError(err: Error & { level?: string; code?: string }): string {
  const code = err.code ?? ''
  if (code === 'ECONNREFUSED') return 'Conexão recusada — verifique host e porta.'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'Servidor inalcançável na rede.'
  if (code === 'ETIMEDOUT') return 'Tempo esgotado ao conectar.'
  if (code === 'ENOTFOUND') return 'Host não encontrado (DNS).'
  if (err.level === 'client-authentication')
    return 'Autenticação recusada — confira usuário, chave ou passphrase.'
  if (/passphrase/i.test(err.message)) return 'A chave privada exige passphrase.'
  return err.message
}
