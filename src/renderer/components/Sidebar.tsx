import { useMemo } from 'react'
import type { ContainerView, HostInfo, StackView, VisorState } from '@shared/types'
import { bytes, containerLabel, stackLabel, STATE_WORD } from '@/lib/format'
import './Sidebar.css'
import type { JSX } from 'react'

interface Props {
  stacks: StackView[]
  host?: HostInfo
  onJumpToStack: (name: string) => void
  onSelect: (container: ContainerView) => void
}

/** Ordem de leitura da legenda: primeiro o que exige ação. */
const TALLY_ORDER: VisorState[] = ['failed', 'degraded', 'transitioning', 'up', 'stopped']

export function Sidebar({ stacks, host, onJumpToStack, onSelect }: Props): JSX.Element {
  const containers = useMemo(() => stacks.flatMap((s) => s.containers), [stacks])

  const counts = useMemo(() => {
    const map = new Map<VisorState, number>()
    for (const c of containers) map.set(c.visorState, (map.get(c.visorState) ?? 0) + 1)
    return map
  }, [containers])

  /**
   * A constelação ordena por gravidade, não por nome: os pontos que importam
   * ficam sempre no mesmo canto, então a mudança é percebida sem leitura.
   */
  const constellation = useMemo(() => {
    const rank = (s: VisorState): number => TALLY_ORDER.indexOf(s)
    return [...containers].sort(
      (a, b) =>
        rank(a.visorState) - rank(b.visorState) ||
        containerLabel(a).localeCompare(containerLabel(b))
    )
  }, [containers])

  return (
    <aside className="side">
      <div className="side__block">
        <div className="label side__title">Servidor</div>

        <div className="constel">
          {constellation.map((c) => (
            <button
              key={c.id}
              className="constel__dot"
              data-state={c.visorState}
              title={`${containerLabel(c)} — ${STATE_WORD[c.visorState]}`}
              aria-label={`${containerLabel(c)}, ${STATE_WORD[c.visorState]}`}
              onClick={() => onSelect(c)}
            />
          ))}
        </div>

        <div className="tallies">
          {TALLY_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => (
            <div className="tally" key={s} data-state={s}>
              <span className="tally__pip" />
              <span className="tally__word">{STATE_WORD[s]}</span>
              <span className="tally__count num">{counts.get(s)}</span>
            </div>
          ))}
          {containers.length === 0 && (
            <span className="tally__word">nenhum container visível</span>
          )}
        </div>
      </div>

      {host && (
        <div className="side__block">
          <div className="label side__title">Host</div>
          <div className="host__name">{host.name}</div>
          <div className="host__line">Docker {host.dockerVersion}</div>
          <div className="host__line">
            {host.cpus} núcleos · {bytes(host.memTotalBytes)}
          </div>
          <div className="host__line">{host.os}</div>
          <div className="host__line">{host.images} imagens</div>
        </div>
      )}

      <div className="side__block">
        <div className="label side__title">Stacks</div>
        <nav className="navlist">
          {stacks.map((s) => (
            <button
              className="navitem"
              key={s.name}
              data-state={s.worst}
              onClick={() => onJumpToStack(s.name)}
            >
              <span className="navitem__pip" />
              <span className="navitem__name">{stackLabel(s.name)}</span>
              <span className="navitem__count num">
                {s.running}/{s.total}
              </span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}
