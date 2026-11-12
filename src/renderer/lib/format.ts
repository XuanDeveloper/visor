import type { ContainerView, VisorState } from '@shared/types'
import { LOOSE_STACK } from '@shared/types'

/** Bytes legíveis com precisão que cai conforme a grandeza cresce. */
export function bytes(value: number): string {
  if (!value || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const decimals = n >= 100 || i === 0 ? 0 : 1
  return `${n.toFixed(decimals)} ${units[i]}`
}

export function percent(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—'
  return value >= 10 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`
}

/**
 * Duração compacta no estilo do `docker ps`: a maior unidade significativa,
 * porque em uma lista densa o que importa é a ordem de grandeza.
 */
export function duration(since: number | undefined): string {
  if (!since) return '—'
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 60) return `${d}d`
  return `${Math.floor(d / 30)}mes`
}

export function clockTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Stacks têm nome próprio; o balde de avulsos recebe um rótulo humano. */
export function stackLabel(name: string): string {
  return name === LOOSE_STACK ? 'Avulsos' : name
}

/** Dentro de uma stack o nome do serviço basta — o prefixo é ruído. */
export function containerLabel(c: ContainerView): string {
  return c.service ?? c.name
}

/** A linha curta que descreve o estado sem repetir o que o nó já mostra. */
export function stateSummary(c: ContainerView): string {
  switch (c.visorState) {
    case 'up':
      return `no ar há ${duration(c.startedAt)}`
    case 'degraded':
      return c.health === 'unhealthy'
        ? `healthcheck falhando há ${duration(c.startedAt)}`
        : 'pausado'
    case 'transitioning':
      return c.state === 'restarting'
        ? `reiniciando · ${c.restartCount}º`
        : c.health === 'starting'
          ? 'subindo…'
          : c.state
    case 'stopped':
      return `parado há ${duration(c.finishedAt)}`
    case 'failed':
      return c.exitCode !== undefined
        ? `exit ${c.exitCode} · há ${duration(c.finishedAt)}`
        : 'morto'
  }
}

export const STATE_WORD: Record<VisorState, string> = {
  up: 'no ar',
  degraded: 'degradado',
  transitioning: 'em transição',
  stopped: 'parado',
  failed: 'falhou'
}

/**
 * Encurta a referência de imagem para caber na coluna.
 * Containers criados sem tag reportam o digest cru — 64 hex não dizem nada ao
 * leitor, então sobram os 12 primeiros, que é o que o próprio Docker mostra.
 */
export function shortImage(image: string): string {
  const digest = /^sha256:([0-9a-f]{12})/.exec(image)
  if (digest) return digest[1]
  const withoutDigest = image.split('@')[0]
  const parts = withoutDigest.split('/')
  return parts[parts.length - 1]
}

/**
 * Versão telegráfica do estado, para o painel da bandeja — onde cada coluna
 * disputa pixels. A frase completa de `stateSummary` é para a janela.
 */
export function shortState(c: ContainerView): string {
  switch (c.visorState) {
    case 'up':
      return duration(c.startedAt)
    case 'degraded':
      return c.health === 'unhealthy' ? 'unhealthy' : 'pausado'
    case 'transitioning':
      return c.state === 'restarting' ? 'reiniciando' : c.state === 'created' ? 'criado' : 'subindo'
    case 'stopped':
      return 'parado'
    case 'failed':
      return c.exitCode !== undefined ? `exit ${c.exitCode}` : 'morto'
  }
}
