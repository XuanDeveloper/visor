import { useEffect, useRef } from 'react'
import type { ConnectionStatus, VisorState } from '@shared/types'
import { IconClose, IconMaximize, IconMinimize, IconSearch, IconSettings } from './Icons'
import './TitleBar.css'
import type { JSX } from 'react'

interface Props {
  connection: ConnectionStatus
  query: string
  onQuery: (value: string) => void
  onOpenSettings: () => void
}

/** Mapeia a fase da conexão para o vocabulário de cor já existente. */
function phaseState(phase: ConnectionStatus['phase']): VisorState {
  if (phase === 'ready') return 'up'
  if (phase === 'error') return 'failed'
  if (phase === 'retrying') return 'degraded'
  if (phase === 'idle' || phase === 'unconfigured') return 'stopped'
  return 'transitioning'
}

const PHASE_WORD: Record<ConnectionStatus['phase'], string> = {
  idle: 'ocioso',
  unconfigured: 'configure o servidor',
  connecting: 'conectando…',
  authenticating: 'autenticando…',
  ready: '',
  retrying: 'reconectando…',
  error: 'sem conexão'
}

export function TitleBar({
  connection,
  query,
  onQuery,
  onOpenSettings
}: Props): JSX.Element {
  const searchRef = useRef<HTMLInputElement>(null)

  // Ctrl+K foca a busca de qualquer lugar — atalho esperado nesse tipo de app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        onQuery('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onQuery])

  const state = phaseState(connection.phase)
  const word = PHASE_WORD[connection.phase]

  return (
    <header className="titlebar">
      <div className="brand">
        {/* A marca é o próprio rail: três nós costurados por uma linha. */}
        <svg className="brand__mark" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
          <path d="M7 3.5v11" stroke="var(--iris-line)" strokeWidth="1.5" />
          <circle cx="7" cy="3.5" r="2.2" fill="var(--iris-bright)" />
          <circle cx="7" cy="9" r="2.6" fill="var(--ok)" />
          <circle cx="7" cy="14.5" r="2.2" fill="var(--iris-bright)" />
        </svg>
        <span className="brand__word">VISOR</span>
      </div>

      <button
        className={`conn${connection.phase === 'ready' ? ' conn--live' : ''}`}
        data-state={state}
        onClick={() => void window.visor.reconnect()}
        title={connection.message ?? 'Clique para reconectar'}
      >
        <span className="conn__beacon" />
        <span className="conn__host">{connection.host ?? 'nenhum servidor'}</span>
        {connection.phase === 'ready' && connection.latencyMs !== undefined ? (
          <span className="conn__lat num">{connection.latencyMs}ms</span>
        ) : (
          <span className="conn__lat">{word}</span>
        )}
      </button>

      <div className="search">
        <IconSearch size={14} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filtrar containers, stacks, imagens…"
          aria-label="Filtrar containers"
          spellCheck={false}
        />
        {query ? null : <kbd>Ctrl K</kbd>}
      </div>

      <button className="iconbtn" onClick={onOpenSettings} title="Configurações" aria-label="Configurações">
        <IconSettings />
      </button>

      <div className="wincontrols">
        <button onClick={() => void window.visor.window.minimize()} aria-label="Minimizar">
          <IconMinimize />
        </button>
        <button onClick={() => void window.visor.window.maximize()} aria-label="Maximizar">
          <IconMaximize />
        </button>
        <button
          onClick={() => void window.visor.window.hide()}
          aria-label="Fechar para a bandeja"
          title="Fecha para a bandeja — o Visor continua vigiando"
        >
          <IconClose />
        </button>
      </div>
    </header>
  )
}
