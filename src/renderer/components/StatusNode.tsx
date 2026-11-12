import type { VisorState } from '@shared/types'
import { STATE_WORD } from '@/lib/format'
import './StatusNode.css'
import type { JSX } from 'react'

interface Props {
  state: VisorState
  /** 22 na lista, 14 nos resumos compactos. */
  size?: number
}

/**
 * Desenha o estado de um container. A cor vem de --state, herdada do
 * data-state do elemento pai, então o nó não conhece a paleta.
 */
export function StatusNode({ state, size = 22 }: Props): JSX.Element {
  const c = 11 // centro no viewBox fixo de 22

  return (
    <svg
      className="node"
      width={size}
      height={size}
      viewBox="0 0 22 22"
      role="img"
      aria-label={STATE_WORD[state]}
    >
      <circle className="node__halo" cx={c} cy={c} r={9.5} />

      {state === 'up' && (
        <>
          <circle className="node__ring node__ring--breathe" cx={c} cy={c} r={7} />
          <circle className="node__core" cx={c} cy={c} r={4} />
        </>
      )}

      {state === 'degraded' && (
        <>
          <circle className="node__ring node__ring--dashed" cx={c} cy={c} r={7} />
          <circle className="node__core" cx={c} cy={c} r={3.6} />
        </>
      )}

      {state === 'transitioning' && (
        <>
          <circle className="node__ring node__ring--spin" cx={c} cy={c} r={6.6} />
          <circle className="node__core" cx={c} cy={c} r={2.6} />
        </>
      )}

      {state === 'stopped' && <circle className="node__hollow" cx={c} cy={c} r={4.4} />}

      {state === 'failed' && (
        <>
          <circle className="node__core" cx={c} cy={c} r={6} />
          <path className="node__cross" d="M8.6 8.6 L13.4 13.4 M13.4 8.6 L8.6 13.4" />
        </>
      )}
    </svg>
  )
}
