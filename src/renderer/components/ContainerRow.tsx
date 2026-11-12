import { useState } from 'react'
import type { ContainerAction, ContainerView } from '@shared/types'
import { bytes, containerLabel, percent, shortImage, stateSummary } from '@/lib/format'
import { IconLogs, IconPlay, IconRestart, IconStop } from './Icons'
import { Sparkline } from './Sparkline'
import { StatusNode } from './StatusNode'
import type { JSX } from 'react'

interface Props {
  container: ContainerView
  selected: boolean
  onSelect: (container: ContainerView) => void
}

/**
 * Uma linha do rail. Densa por escolha: nome e diagnóstico à esquerda, portas
 * no meio, carga à direita, ações só no hover. Nada pisca sem motivo.
 */
export function ContainerRow({ container, selected, onSelect }: Props): JSX.Element {
  const [busy, setBusy] = useState<ContainerAction | null>(null)
  const running = container.state === 'running'
  const stats = container.stats

  const run = async (action: ContainerAction, event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    setBusy(action)
    try {
      await window.visor.act(container.id, action)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className={`row${selected ? ' row--selected' : ''}`}
      data-state={container.visorState}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(container)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(container)
        }
      }}
    >
      <div className="row__rail" />

      <div className="row__node">
        <StatusNode state={container.visorState} />
      </div>

      <div className="row__ident">
        <div className="row__name">{containerLabel(container)}</div>
        <div className="row__meta">
          {stateSummary(container)}
          <span style={{ color: 'var(--mist-faint)' }}> · {shortImage(container.image)}</span>
        </div>
      </div>

      <div className="row__ports">
        {container.ports
          .filter((p) => p.publicPort)
          .slice(0, 2)
          .map((p) => (
            <span className="port port--open" key={`${p.privatePort}-${p.publicPort}`}>
              :{p.publicPort}
            </span>
          ))}
      </div>

      <div className="metric">
        {running && stats ? (
          <>
            <Sparkline values={stats.cpuHistory} />
            <span className="metric__value">{percent(stats.cpuPercent)}</span>
          </>
        ) : (
          <span className="metric__value metric__value--muted">—</span>
        )}
      </div>

      <div className="metric">
        <span className={`metric__value${running && stats ? '' : ' metric__value--muted'}`}>
          {running && stats ? bytes(stats.memBytes) : '—'}
        </span>
      </div>

      <div className="row__actions">
        {running ? (
          <button
            className={`act act--danger${busy === 'stop' ? ' act--busy' : ''}`}
            title="Parar"
            aria-label={`Parar ${containerLabel(container)}`}
            disabled={busy !== null}
            onClick={(e) => void run('stop', e)}
          >
            <IconStop />
          </button>
        ) : (
          <button
            className={`act act--go${busy === 'start' ? ' act--busy' : ''}`}
            title="Iniciar"
            aria-label={`Iniciar ${containerLabel(container)}`}
            disabled={busy !== null}
            onClick={(e) => void run('start', e)}
          >
            <IconPlay />
          </button>
        )}

        <button
          className={`act${busy === 'restart' ? ' act--busy' : ''}`}
          title="Reiniciar"
          aria-label={`Reiniciar ${containerLabel(container)}`}
          disabled={busy !== null}
          onClick={(e) => void run('restart', e)}
        >
          <IconRestart />
        </button>

        <button
          className="act"
          title="Ver logs"
          aria-label={`Ver logs de ${containerLabel(container)}`}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(container)
          }}
        >
          <IconLogs />
        </button>
      </div>
    </div>
  )
}
