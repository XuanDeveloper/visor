import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ContainerView, Snapshot, StackView } from '@shared/types'
import { containerLabel, stackLabel } from '@/lib/format'
import { ConnectionGate } from './components/ConnectionGate'
import { Inspector } from './components/Inspector'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { StackGroup } from './components/StackGroup'
import { TitleBar } from './components/TitleBar'
import './App.css'
import type { JSX } from 'react'

const EMPTY: Snapshot = { stacks: [], connection: { phase: 'idle' }, at: 0 }

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const mainRef = useRef<HTMLDivElement>(null)
  const stackRefs = useRef(new Map<string, HTMLDivElement>())

  // Estado inicial + assinaturas. O main empurra tudo; aqui só reagimos.
  useEffect(() => {
    void window.visor.getSnapshot().then(setSnapshot)
    void window.visor.getPrefs().then((p) => setCollapsed(new Set(p.collapsedStacks)))

    const offSnapshot = window.visor.onSnapshot(setSnapshot)
    const offConnection = window.visor.onConnection((connection) =>
      setSnapshot((prev) => ({ ...prev, connection }))
    )
    return () => {
      offSnapshot()
      offConnection()
    }
  }, [])

  /** Filtro por nome, serviço, stack ou imagem; stacks sem acerto somem. */
  const filtered = useMemo<StackView[]>(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return snapshot.stacks

    const result: StackView[] = []
    for (const stack of snapshot.stacks) {
      const stackHit = stackLabel(stack.name).toLowerCase().includes(needle)
      const containers = stackHit
        ? stack.containers
        : stack.containers.filter((c) =>
            [c.name, c.service ?? '', c.image, c.statusText]
              .join(' ')
              .toLowerCase()
              .includes(needle)
          )
      if (containers.length > 0) {
        result.push({
          ...stack,
          containers,
          running: containers.filter((c) => c.state === 'running').length,
          total: containers.length
        })
      }
    }
    return result
  }, [snapshot.stacks, query])

  // Mantém o container selecionado em sincronia com o snapshot mais recente.
  const selected = useMemo<ContainerView | null>(() => {
    if (!selectedId) return null
    for (const stack of snapshot.stacks) {
      const found = stack.containers.find((c) => c.id === selectedId)
      if (found) return found
    }
    return null
  }, [snapshot.stacks, selectedId])

  // Se o container selecionado for removido do servidor, fecha a gaveta.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  const persistCollapsed = useCallback((next: Set<string>) => {
    void window.visor.setPrefs({ collapsedStacks: [...next] })
  }, [])

  const toggleStack = useCallback(
    (name: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        persistCollapsed(next)
        return next
      })
    },
    [persistCollapsed]
  )

  const jumpToStack = useCallback(
    (name: string) => {
      // Pular para uma stack recolhida deve abri-la, senão o salto não leva a nada.
      setCollapsed((prev) => {
        if (!prev.has(name)) return prev
        const next = new Set(prev)
        next.delete(name)
        persistCollapsed(next)
        return next
      })
      requestAnimationFrame(() => {
        stackRefs.current.get(name)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [persistCollapsed]
  )

  const selectContainer = useCallback((c: ContainerView) => {
    setSelectedId((prev) => (prev === c.id ? null : c.id))
  }, [])

  const connected = snapshot.connection.phase === 'ready'
  const hasData = snapshot.stacks.length > 0

  return (
    <div className="app">
      <TitleBar
        connection={snapshot.connection}
        query={query}
        onQuery={setQuery}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="app__body">
        {hasData && (
          <Sidebar
            stacks={snapshot.stacks}
            host={snapshot.host}
            onJumpToStack={jumpToStack}
            onSelect={selectContainer}
          />
        )}

        <main className="main" ref={mainRef}>
          {!hasData ? (
            connected ? (
              <div className="empty">
                <div className="empty__title">Nenhum container no servidor</div>
                <div className="empty__text prose">
                  A conexão está de pé, mas o Docker não reportou nenhum container — nem mesmo
                  parados.
                </div>
              </div>
            ) : (
              <ConnectionGate
                connection={snapshot.connection}
                onOpenSettings={() => setShowSettings(true)}
              />
            )
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div className="empty__title">Nada corresponde a “{query}”</div>
              <div className="empty__text prose">
                A busca cobre nome, serviço, stack e imagem.
              </div>
            </div>
          ) : (
            filtered.map((stack) => (
              <div
                key={stack.name}
                ref={(el) => {
                  if (el) stackRefs.current.set(stack.name, el)
                  else stackRefs.current.delete(stack.name)
                }}
              >
                <StackGroup
                  stack={stack}
                  // Durante uma busca tudo abre: esconder acertos seria hostil.
                  open={query.trim() !== '' || !collapsed.has(stack.name)}
                  selectedId={selectedId}
                  onToggle={toggleStack}
                  onSelect={selectContainer}
                />
              </div>
            ))
          )}
        </main>

        {selected && (
          <Inspector
            key={selected.id}
            container={selected}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* Anúncio discreto para leitores de tela quando a conexão muda. */}
      <div className="sr-only" role="status" aria-live="polite">
        {connected
          ? `Conectado. ${snapshot.stacks.length} stacks.`
          : (snapshot.connection.message ?? 'Sem conexão com o servidor.')}
        {selected ? ` Painel aberto: ${containerLabel(selected)}.` : ''}
      </div>
    </div>
  )
}
