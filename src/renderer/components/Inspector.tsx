import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContainerAction, ContainerView, LogLine } from '@shared/types'
import {
  bytes,
  clockTime,
  containerLabel,
  duration,
  percent,
  stateSummary,
  STATE_WORD
} from '@/lib/format'
import {
  IconClose,
  IconPause,
  IconPlay,
  IconRestart,
  IconScrollDown,
  IconSearch,
  IconStop
} from './Icons'
import { Sparkline } from './Sparkline'
import { StatusNode } from './StatusNode'
import './Inspector.css'
import type { JSX } from 'react'

interface Props {
  container: ContainerView
  onClose: () => void
}

/** Teto de linhas em memória. Acima disso, as mais antigas caem. */
const LOG_CAP = 2000
/** Folga em px dentro da qual consideramos que o usuário está "no fim". */
const TAIL_SLACK = 40

export function Inspector({ container, onClose }: Props): JSX.Element {
  const [lines, setLines] = useState<LogLine[]>([])
  const [filter, setFilter] = useState('')
  const [tailing, setTailing] = useState(true)
  const [busy, setBusy] = useState<ContainerAction | null>(null)

  const streamRef = useRef<HTMLDivElement>(null)
  const id = container.id

  // Assina os logs deste container e limpa ao trocar de seleção.
  useEffect(() => {
    setLines([])
    setTailing(true)
    void window.visor.subscribeLogs(id)

    const off = window.visor.onLogLine((line) => {
      if (line.containerId !== id) return
      setLines((prev) => {
        const next = [...prev, line]
        return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next
      })
    })

    return () => {
      off()
      void window.visor.unsubscribeLogs(id)
    }
  }, [id])

  // Esc fecha a gaveta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = useMemo(() => {
    if (!filter.trim()) return lines
    const needle = filter.toLowerCase()
    return lines.filter((l) => l.text.toLowerCase().includes(needle))
  }, [lines, filter])

  // Só rola sozinho se o usuário não tiver subido para ler algo.
  useEffect(() => {
    if (!tailing) return
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible, tailing])

  const onScroll = useCallback(() => {
    const el = streamRef.current
    if (!el) return
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < TAIL_SLACK
    setTailing(atEnd)
  }, [])

  const jumpToTail = useCallback(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
    setTailing(true)
  }, [])

  const run = async (action: ContainerAction): Promise<void> => {
    setBusy(action)
    try {
      await window.visor.act(container.id, action)
    } finally {
      setBusy(null)
    }
  }

  const running = container.state === 'running'
  const stats = container.stats

  return (
    <aside className="inspector" data-state={container.visorState}>
      <header className="insp__head">
        <StatusNode state={container.visorState} size={26} />
        <div className="insp__title">
          <div className="insp__name">{containerLabel(container)}</div>
          <div className="insp__sub">
            {STATE_WORD[container.visorState]} · {stateSummary(container)}
          </div>
        </div>
        <button className="iconbtn" onClick={onClose} aria-label="Fechar painel">
          <IconClose />
        </button>
      </header>

      <div className="gauges">
        <div className="gauge">
          <div className="label gauge__label">CPU</div>
          <div className="gauge__value">
            {running && stats ? percent(stats.cpuPercent) : '—'}
          </div>
          <div className="gauge__spark">
            <Sparkline values={stats?.cpuHistory ?? []} width={140} height={26} />
          </div>
        </div>

        <div className="gauge">
          <div className="label gauge__label">Memória</div>
          <div className="gauge__value">
            {running && stats ? bytes(stats.memBytes) : '—'}
            {running && stats && stats.memLimitBytes > 0 && (
              <span className="gauge__unit">de {bytes(stats.memLimitBytes)}</span>
            )}
          </div>
          <div className="gauge__spark">
            <Sparkline values={stats?.memHistory ?? []} width={140} height={26} floor={2} />
          </div>
        </div>

        <div className="gauge">
          <div className="label gauge__label">Rede</div>
          <div className="gauge__value">
            {running && stats ? bytes(stats.netRxBytes) : '—'}
            {running && stats && <span className="gauge__unit">recebidos</span>}
          </div>
          <div className="gauge__spark" style={{ fontSize: 'var(--t-small)', color: 'var(--mist-faint)' }}>
            {running && stats ? `${bytes(stats.netTxBytes)} enviados` : ''}
          </div>
        </div>
      </div>

      <div className="insp__actions">
        {running ? (
          <>
            <button
              className="btn btn--danger"
              disabled={busy !== null}
              onClick={() => void run('stop')}
            >
              <IconStop size={14} /> Parar
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void run('restart')}>
              <IconRestart size={14} /> Reiniciar
            </button>
            <button className="btn" disabled={busy !== null} onClick={() => void run('pause')}>
              <IconPause size={14} /> Pausar
            </button>
          </>
        ) : (
          <button
            className="btn btn--primary"
            disabled={busy !== null}
            onClick={() => void run(container.state === 'paused' ? 'unpause' : 'start')}
          >
            <IconPlay size={14} /> {container.state === 'paused' ? 'Retomar' : 'Iniciar'}
          </button>
        )}
      </div>

      <div className="facts">
        <div className="fact">
          <span className="fact__key">Container</span>
          <span className="fact__val">{container.name}</span>
        </div>
        <div className="fact">
          <span className="fact__key">Imagem</span>
          <span className="fact__val">{container.image}</span>
        </div>
        {container.stack && (
          <div className="fact">
            <span className="fact__key">Stack</span>
            <span className="fact__val">
              {container.stack}
              {container.service ? ` / ${container.service}` : ''}
            </span>
          </div>
        )}
        <div className="fact">
          <span className="fact__key">Portas</span>
          <span className="fact__val">
            {container.ports.length === 0
              ? 'nenhuma publicada'
              : container.ports
                  .map((p) =>
                    p.publicPort
                      ? `${p.publicPort} → ${p.privatePort}/${p.type}`
                      : `${p.privatePort}/${p.type}`
                  )
                  .join('  ·  ')}
          </span>
        </div>
        <div className="fact">
          <span className="fact__key">Healthcheck</span>
          <span className="fact__val">
            {container.health === 'none' ? 'não definido' : container.health}
          </span>
        </div>
        <div className="fact">
          <span className="fact__key">Reinícios</span>
          <span className="fact__val">{container.restartCount}</span>
        </div>
        <div className="fact">
          <span className="fact__key">Criado</span>
          <span className="fact__val">há {duration(container.createdAt)}</span>
        </div>
        <div className="fact">
          <span className="fact__key">ID</span>
          <span className="fact__val">{container.id.slice(0, 12)}</span>
        </div>
      </div>

      <div className="logs">
        <div className="logs__bar">
          <span className="label">Logs</span>
          <label className="logs__filter">
            <IconSearch size={12} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filtrar linhas"
              spellCheck={false}
              aria-label="Filtrar linhas de log"
            />
          </label>
          <span className="conn__lat num">
            {visible.length}
            {filter ? `/${lines.length}` : ''}
          </span>
        </div>

        <div className="logs__stream" ref={streamRef} onScroll={onScroll}>
          {visible.length === 0 ? (
            <div className="logs__empty prose">
              {filter ? 'Nenhuma linha corresponde ao filtro.' : 'Aguardando saída do container…'}
            </div>
          ) : (
            visible.map((l) => (
              <div
                className={`logline${l.stream === 'stderr' ? ' logline--err' : ''}`}
                key={`${l.seq}`}
              >
                <span className="logline__time">{clockTime(l.timestamp)}</span>
                <span className="logline__text">{l.text}</span>
              </div>
            ))
          )}
        </div>

        {!tailing && (
          <button className="logs__tail" onClick={jumpToTail}>
            <IconScrollDown size={13} /> acompanhar
          </button>
        )}
      </div>
    </aside>
  )
}
