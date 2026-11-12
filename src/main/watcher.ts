import { Notification } from 'electron'
import type { ContainerView, Preferences, StackView, VisorState } from '@shared/types'

/**
 * Compara snapshots consecutivos e avisa quando algo digno de interrupção
 * acontece. A régua é alta de propósito: uma notificação que você aprende a
 * ignorar não vale nada.
 */

/** Silêncio mínimo entre dois alertas do mesmo container. */
const COOLDOWN_MS = 2 * 60 * 1000
/** Reinícios dentro da janela que caracterizam um loop. */
const RESTART_LOOP_THRESHOLD = 3
const RESTART_WINDOW_MS = 5 * 60 * 1000

interface Memo {
  visorState: VisorState
  restartCount: number
  /** Timestamps dos reinícios observados, dentro da janela. */
  restartTimes: number[]
  lastNotifiedAt: number
  /** Para não alertar queda e, logo em seguida, loop pelo mesmo evento. */
  loopReported: boolean
}

export class Watcher {
  private memo = new Map<string, Memo>()
  /** Pula o primeiro ciclo: na largada tudo é "mudança". */
  private primed = false
  private onOpen: ((containerId: string) => void) | null = null

  setOpenHandler(handler: (containerId: string) => void): void {
    this.onOpen = handler
  }

  /** Esquece o histórico — usado quando a conexão cai, para não alertar em massa no retorno. */
  reset(): void {
    this.memo.clear()
    this.primed = false
  }

  inspect(stacks: StackView[], prefs: Preferences): void {
    const now = Date.now()
    const containers = stacks.flatMap((s) => s.containers)
    const seen = new Set<string>()

    for (const c of containers) {
      seen.add(c.id)
      const prev = this.memo.get(c.id)
      const next: Memo = {
        visorState: c.visorState,
        restartCount: c.restartCount,
        restartTimes: prev ? prev.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS) : [],
        lastNotifiedAt: prev?.lastNotifiedAt ?? 0,
        loopReported: prev?.loopReported ?? false
      }

      if (prev && c.restartCount > prev.restartCount) {
        const delta = c.restartCount - prev.restartCount
        for (let i = 0; i < delta; i++) next.restartTimes.push(now)
      }

      if (this.primed && prev) {
        const alert = this.classify(c, prev, next, prefs)
        if (alert && now - next.lastNotifiedAt > COOLDOWN_MS) {
          next.lastNotifiedAt = now
          this.notify(alert.title, alert.body, c.id)
        }
      }

      // Saiu do loop e voltou a ficar estável → pode reportar de novo no futuro.
      if (next.restartTimes.length < RESTART_LOOP_THRESHOLD) next.loopReported = false

      this.memo.set(c.id, next)
    }

    for (const id of this.memo.keys()) if (!seen.has(id)) this.memo.delete(id)
    this.primed = true
  }

  private classify(
    c: ContainerView,
    prev: Memo,
    next: Memo,
    prefs: Preferences
  ): { title: string; body: string } | null {
    const label = c.service && c.stack ? `${c.stack} / ${c.service}` : c.name

    if (
      prefs.notifyOnRestartLoop &&
      next.restartTimes.length >= RESTART_LOOP_THRESHOLD &&
      !next.loopReported
    ) {
      next.loopReported = true
      return {
        title: `Loop de reinício · ${label}`,
        body: `${next.restartTimes.length} reinícios em menos de 5 minutos. Algo está derrubando o container logo após subir.`
      }
    }

    if (prefs.notifyOnFailure && prev.visorState !== 'failed' && c.visorState === 'failed') {
      const code = c.exitCode !== undefined ? ` (exit ${c.exitCode})` : ''
      return { title: `Caiu · ${label}`, body: `O container parou com erro${code}.` }
    }

    if (prefs.notifyOnFailure && prev.visorState === 'up' && c.visorState === 'degraded') {
      const reason = c.health === 'unhealthy' ? 'healthcheck falhando' : 'container pausado'
      return { title: `Degradado · ${label}`, body: `Ainda rodando, mas com ${reason}.` }
    }

    if (
      prefs.notifyOnRecovery &&
      (prev.visorState === 'failed' || prev.visorState === 'degraded') &&
      c.visorState === 'up'
    ) {
      return { title: `Recuperado · ${label}`, body: 'O container voltou ao normal.' }
    }

    return null
  }

  private notify(title: string, body: string, containerId: string): void {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    n.on('click', () => this.onOpen?.(containerId))
    n.show()
  }
}
