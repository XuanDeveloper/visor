import type { ContainerView, StackView } from '@shared/types'
import { stackLabel } from '@/lib/format'
import { ContainerRow } from './ContainerRow'
import { IconChevron } from './Icons'
import './StackGroup.css'
import type { JSX } from 'react'

interface Props {
  stack: StackView
  open: boolean
  selectedId: string | null
  onToggle: (name: string) => void
  onSelect: (container: ContainerView) => void
}

export function StackGroup({
  stack,
  open,
  selectedId,
  onToggle,
  onSelect
}: Props): JSX.Element {
  const healthy = stack.running === stack.total

  return (
    <section
      className={`stack${open ? ' stack--open' : ''}`}
      data-worst={stack.worst}
      data-state={stack.worst}
    >
      <button
        className="stack__head"
        onClick={() => onToggle(stack.name)}
        aria-expanded={open}
      >
        <span className="stack__chevron">
          <IconChevron />
        </span>

        <span className="stack__name">{stackLabel(stack.name)}</span>

        {/* Recolhida, a stack ainda mostra a saúde de cada serviço em miniatura. */}
        <span className="stack__dots" aria-hidden="true">
          {stack.containers.slice(0, 12).map((c) => (
            <span className="stack__dot" key={c.id} data-state={c.visorState} />
          ))}
        </span>

        <span className="stack__tally num">
          {stack.running}
          <span>/{stack.total}</span>
        </span>
      </button>

      {open && (
        <div className="stack__body">
          {stack.containers.map((c) => (
            <ContainerRow
              key={c.id}
              container={c}
              selected={c.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      {/* Marcador a11y: o estado agregado em texto, para leitores de tela. */}
      <span className="sr-only">
        {healthy ? 'Todos os serviços no ar' : `${stack.total - stack.running} fora do ar`}
      </span>
    </section>
  )
}
