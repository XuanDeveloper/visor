import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type {
  ContainerAction,
  ContainerView,
  Snapshot,
  StackView,
  VisorState
} from '@shared/types'
import { bytes, containerLabel, percent, shortState, stackLabel } from '@/lib/format'
import {
  IconClose,
  IconPlay,
  IconRestart,
  IconSearch,
  IconSettings,
  IconStop
} from './Icons'
import './Popover.css'

const EMPTY: Snapshot = { stacks: [], connection: { phase: 'idle' }, at: 0 }

/** Grupos com algo errado abrem sozinhos — é o que você veio ver. */
const AUTO_OPEN: VisorState[] = ['failed', 'degraded', 'transitioning']

/**
 * Lista achatada: grupos e serviços na mesma sequência em que aparecem na
 * tela. É isso que torna a navegação por teclado possível — sem ela, "próximo
 * item" exigiria percorrer uma árvore a cada tecla.
 */
type Row =
  | { kind: 'group'; key: string; stack: StackView }
  | { kind: 'service'; key: string; container: ContainerView; stack: StackView }

export function Popover(): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [motion, setMotion] = useState<'enter' | 'exit'>('enter')
  const [enterKey, setEnterKey] = useState(0)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  /** Ação em voo por container, para o botão mostrar que está trabalhando. */
  const [busy, setBusy] = useState<Record<string, ContainerAction>>({})
  /** Mensagem efêmera no rodapé depois de uma ação. */
  const [flash, setFlash] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const flashTimer = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    void window.visor.getSnapshot().then(setSnapshot)
    const offSnapshot = window.visor.onSnapshot(setSnapshot)
    const offConnection = window.visor.onConnection((connection) =>
      setSnapshot((prev) => ({ ...prev, connection }))
    )
    const offMotion = window.visor.onPopoverMotion((phase) => {
      setMotion(phase)
      if (phase === 'enter') {
        setEnterKey((n) => n + 1)
        // Reabrir é um gesto novo: limpa busca e volta o cursor ao topo.
        setQuery('')
        setCursor(0)
      }
    })
    return () => {
      offSnapshot()
      offConnection()
      offMotion()
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  /* ---------------- filtro ---------------- */

  const stacks = useMemo<StackView[]>(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return snapshot.stacks

    const out: StackView[] = []
    for (const stack of snapshot.stacks) {
      const stackHit = stackLabel(stack.name).toLowerCase().includes(needle)
      const containers = stackHit
        ? stack.containers
        : stack.containers.filter((c) =>
            `${c.name} ${c.service ?? ''} ${c.image}`.toLowerCase().includes(needle)
          )
      if (containers.length > 0) {
        out.push({
          ...stack,
          containers,
          running: containers.filter((c) => c.state === 'running').length,
          total: containers.length
        })
      }
    }
    return out
  }, [snapshot.stacks, query])

  const isOpen = useCallback(
    (stack: StackView): boolean => {
      // Durante uma busca tudo abre: esconder acertos seria hostil.
      if (query.trim()) return true
      return touched.has(stack.name) ? open.has(stack.name) : AUTO_OPEN.includes(stack.worst)
    },
    [query, touched, open]
  )

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const stack of stacks) {
      out.push({ kind: 'group', key: `g:${stack.name}`, stack })
      if (isOpen(stack)) {
        for (const c of stack.containers) {
          out.push({ kind: 'service', key: `s:${c.id}`, container: c, stack })
        }
      }
    }
    return out
  }, [stacks, isOpen])

  // O cursor não pode apontar para fora da lista depois de um filtro.
  useEffect(() => {
    setCursor((c) => Math.min(Math.max(0, c), Math.max(0, rows.length - 1)))
  }, [rows.length])

  /* ---------------- ações ---------------- */

  const say = useCallback((message: string) => {
    setFlash(message)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 2600)
  }, [])

  const act = useCallback(
    async (c: ContainerView, action: ContainerAction) => {
      setBusy((prev) => ({ ...prev, [c.id]: action }))
      const verb =
        action === 'start' ? 'iniciando' : action === 'stop' ? 'parando' : 'reiniciando'
      say(`${verb} ${containerLabel(c)}…`)
      try {
        await window.visor.act(c.id, action)
        const done =
          action === 'start' ? 'iniciado' : action === 'stop' ? 'parado' : 'reiniciado'
        say(`${containerLabel(c)} ${done}`)
      } catch (err) {
        say(`falhou: ${(err as Error).message.slice(0, 60)}`)
      } finally {
        setBusy((prev) => {
          const next = { ...prev }
          delete next[c.id]
          return next
        })
      }
    },
    [say]
  )

  const toggleGroup = useCallback(
    (name: string) => {
      setTouched((prev) => new Set(prev).add(name))
      setOpen((prev) => {
        const wasOpen = touched.has(name)
          ? prev.has(name)
          : AUTO_OPEN.includes(stacks.find((s) => s.name === name)?.worst ?? 'up')
        const next = new Set(prev)
        if (wasOpen) next.delete(name)
        else next.add(name)
        return next
      })
    },
    [touched, stacks]
  )

  /* ---------------- teclado ---------------- */

  const move = useCallback(
    (delta: number) => {
      setCursor((c) => {
        const next = c + delta
        if (next < 0) return 0
        if (next > rows.length - 1) return rows.length - 1
        return next
      })
    },
    [rows.length]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const row = rows[cursor]

      if (e.key === 'Escape') {
        e.preventDefault()
        // Esc em duas etapas: primeiro desfaz a busca, depois fecha.
        if (query) setQuery('')
        else void window.visor.closePopover()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        move(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        move(-1)
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setCursor(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setCursor(rows.length - 1)
        return
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (row?.kind === 'group') {
          e.preventDefault()
          const nowOpen = isOpen(row.stack)
          if ((e.key === 'ArrowRight') !== nowOpen) toggleGroup(row.stack.name)
        }
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        if (row?.kind === 'group') toggleGroup(row.stack.name)
        else if (row?.kind === 'service') void window.visor.openPanel(row.container.id)
        return
      }

      if (e.key === 'Backspace' && query) {
        e.preventDefault()
        setQuery((q) => q.slice(0, -1))
        return
      }

      // Atalhos de ação sobre o serviço focado. Só com modificador livre,
      // senão colidiriam com a busca por digitação.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && row?.kind === 'service') {
        const c = row.container
        const k = e.key.toLowerCase()
        if (k === 'r' && query === '') {
          e.preventDefault()
          void act(c, 'restart')
          return
        }
        if (k === 's' && query === '') {
          e.preventDefault()
          void act(c, c.state === 'running' ? 'stop' : 'start')
          return
        }
      }

      // Qualquer caractere imprimível começa a filtrar. Um popover não tem
      // espaço para um campo de busca permanente.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (/[\w\-./]/.test(e.key)) {
          e.preventDefault()
          setQuery((q) => q + e.key)
          setCursor(0)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, cursor, query, move, isOpen, toggleGroup, act])

  // Mantém o item focado visível conforme o cursor anda.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-cursor="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor, rows.length])

  /* ---------------- resumo ---------------- */

  /** Resultados visíveis — só para o contador de acertos da busca. */
  const containers = useMemo(() => stacks.flatMap((s) => s.containers), [stacks])

  /**
   * O placar resume o SERVIDOR, não a busca: contar só os filtrados faria
   * parecer que o host tem quatro containers quando você digita "postgres".
   * O número de acertos já aparece na barra de busca.
   */
  const score = useMemo(() => {
    const all = snapshot.stacks.flatMap((s) => s.containers)
    const n = (fn: (c: ContainerView) => boolean): number => all.filter(fn).length
    return {
      up: n((c) => c.visorState === 'up'),
      attention: n((c) => c.visorState === 'degraded' || c.visorState === 'transitioning'),
      down: n((c) => c.visorState === 'failed' || c.visorState === 'stopped')
    }
  }, [snapshot.stacks])

  const connected = snapshot.connection.phase === 'ready'
  const host = snapshot.host?.name ?? snapshot.connection.host ?? 'servidor'

  return (
    <div className={`pop pop--${motion}`} key={enterKey}>
      <header className="pop__head">
        <div className="pop__brand">
          <svg width="11" height="15" viewBox="0 0 14 18" aria-hidden="true">
            <path d="M7 3.5v11" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
            <circle cx="7" cy="3.5" r="2.1" fill="#c3b6f2" />
            <circle cx="7" cy="9" r="2.5" fill={connected ? 'var(--ok)' : 'var(--idle)'} />
            <circle cx="7" cy="14.5" r="2.1" fill="#c3b6f2" />
          </svg>
          <span className="pop__word">VISOR</span>
        </div>

        <div className="pop__host">
          {host}
          {connected && snapshot.connection.latencyMs !== undefined && (
            <span className="pop__lat">{snapshot.connection.latencyMs}ms</span>
          )}
        </div>

        <button
          className="pop__btn"
          title="Abrir janela completa"
          aria-label="Abrir janela completa"
          onClick={() => void window.visor.openPanel()}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.4 2.6h4v4M13.4 2.6 8.6 7.4" />
            <path d="M12.4 9.9v2.6a1.4 1.4 0 0 1-1.4 1.4H3.5a1.4 1.4 0 0 1-1.4-1.4V5a1.4 1.4 0 0 1 1.4-1.4h2.6" />
          </svg>
        </button>

        <button
          className="pop__btn"
          title="Fechar (Esc)"
          aria-label="Fechar painel"
          onClick={() => void window.visor.closePopover()}
        >
          <IconClose size={14} />
        </button>
      </header>

      {snapshot.connection.phase === 'unconfigured' ? (
        <div className="pop__gate">
          <div className="pop__gate-title">Escolha um servidor</div>
          <div className="pop__gate-text prose">
            O Visor conversa com o Docker por SSH. Se o servidor já está no seu
            <code> ~/.ssh/config</code>, ele aparece na lista.
          </div>
          <button className="btn btn--primary" onClick={() => void window.visor.openPanel()}>
            <IconSettings size={13} /> Configurar
          </button>
        </div>
      ) : !connected && snapshot.stacks.length === 0 ? (
        <div className="pop__gate">
          <div className="pop__gate-title">Sem conexão</div>
          <div className="pop__gate-text prose">
            {snapshot.connection.message ?? 'Abrindo o túnel para o servidor…'}
          </div>
          <button className="btn btn--primary" onClick={() => void window.visor.reconnect()}>
            <IconRestart size={13} /> Tentar agora
          </button>
        </div>
      ) : (
        <>
          <div className="pop__score">
            <div className="score" data-state="up">
              <span className={`score__n${score.up === 0 ? ' score__n--zero' : ''}`}>
                {score.up}
              </span>
              <span className={`score__k${score.up === 0 ? ' score__k--zero' : ''}`}>no ar</span>
            </div>
            <div className="score" data-state="degraded">
              <span className={`score__n${score.attention === 0 ? ' score__n--zero' : ''}`}>
                {score.attention}
              </span>
              <span className={`score__k${score.attention === 0 ? ' score__k--zero' : ''}`}>
                atenção
              </span>
            </div>
            <div className="score" data-state="failed">
              <span className={`score__n${score.down === 0 ? ' score__n--zero' : ''}`}>
                {score.down}
              </span>
              <span className={`score__k${score.down === 0 ? ' score__k--zero' : ''}`}>
                fora
              </span>
            </div>
          </div>

          {query && (
            <div className="pop__query">
              <IconSearch size={12} />
              <span className="pop__query-term">{query}</span>
              <span className="pop__query-hits">
                {containers.length} {containers.length === 1 ? 'acerto' : 'acertos'}
              </span>
              <button
                className="pop__query-clear"
                onClick={() => setQuery('')}
                aria-label="Limpar busca"
              >
                <IconClose size={11} />
              </button>
            </div>
          )}

          <div className="pop__list" ref={listRef}>
            {rows.length === 0 && (
              <div className="pop__none prose">Nada corresponde a “{query}”.</div>
            )}

            {rows.map((row, i) => {
              const focused = i === cursor
              if (row.kind === 'group') {
                const stack = row.stack
                return (
                  <button
                    key={row.key}
                    className={`grp__head${focused ? ' is-cursor' : ''}`}
                    data-cursor={focused}
                    data-state={stack.worst}
                    data-worst={stack.worst}
                    aria-expanded={isOpen(stack)}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => toggleGroup(stack.name)}
                  >
                    <span className="grp__idx">
                      {String(stacks.indexOf(stack) + 1).padStart(2, '0')}
                    </span>
                    <span className="grp__name">{stackLabel(stack.name)}</span>
                    <span className="grp__pips" aria-hidden="true">
                      {stack.containers.slice(0, 8).map((c) => (
                        <span className="pip" key={c.id} data-state={c.visorState} />
                      ))}
                    </span>
                    <span className="grp__tally">
                      {stack.running}
                      <span>/{stack.total}</span>
                    </span>
                  </button>
                )
              }

              const c = row.container
              const running = c.state === 'running'
              const working = busy[c.id]

              return (
                <div
                  key={row.key}
                  className={`svc${focused ? ' is-cursor' : ''}`}
                  data-cursor={focused}
                  data-state={c.visorState}
                  onMouseEnter={() => setCursor(i)}
                >
                  <button
                    className="svc__main"
                    title={`${containerLabel(c)} — abrir detalhe`}
                    onClick={() => void window.visor.openPanel(c.id)}
                  >
                    <span className="svc__dot" data-state={c.visorState} />
                    <span className="svc__name">{containerLabel(c)}</span>
                    {running && c.stats ? (
                      <span className="svc__num">{percent(c.stats.cpuPercent)}</span>
                    ) : (
                      <span className="svc__note">{shortState(c)}</span>
                    )}
                    <span className="svc__num">{c.stats ? bytes(c.stats.memBytes) : ''}</span>
                  </button>

                  {/* Ações inline: o motivo mais comum de abrir o painel é
                      reiniciar algo. Mandar o usuário para a janela só para
                      isso seria um desvio sem propósito. */}
                  <span className="svc__acts">
                    <button
                      className={`svc__act${working === 'restart' ? ' is-busy' : ''}`}
                      title="Reiniciar (R)"
                      aria-label={`Reiniciar ${containerLabel(c)}`}
                      disabled={!!working}
                      onClick={() => void act(c, 'restart')}
                    >
                      <IconRestart size={13} />
                    </button>
                    <button
                      className={`svc__act${
                        running ? ' svc__act--danger' : ' svc__act--go'
                      }${working === 'stop' || working === 'start' ? ' is-busy' : ''}`}
                      title={running ? 'Parar (S)' : 'Iniciar (S)'}
                      aria-label={`${running ? 'Parar' : 'Iniciar'} ${containerLabel(c)}`}
                      disabled={!!working}
                      onClick={() => void act(c, running ? 'stop' : 'start')}
                    >
                      {running ? <IconStop size={12} /> : <IconPlay size={12} />}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>

          <footer className="pop__foot">
            <span className="pop__beacon" data-state={connected ? 'up' : 'failed'} />
            <span className={`pop__meta${flash ? ' pop__meta--flash' : ''}`}>
              {flash ??
                (snapshot.host
                  ? `${snapshot.host.cpus} núcleos · ${bytes(snapshot.host.memTotalBytes)} · docker ${snapshot.host.dockerVersion}`
                  : (snapshot.connection.message ?? 'reconectando…'))}
            </span>
            <span className="pop__keys">
              <kbd>↑↓</kbd>
              <kbd>R</kbd>
              <kbd>S</kbd>
            </span>
            <button
              className="pop__btn"
              title="Configurações"
              aria-label="Configurações"
              onClick={() => void window.visor.openPanel()}
            >
              <IconSettings size={13} />
            </button>
          </footer>
        </>
      )}
    </div>
  )
}
