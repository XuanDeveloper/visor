import { useEffect, useState } from 'react'
import type { ConnectionStatus } from '@shared/types'
import { IconPlug, IconSettings } from './Icons'
import type { JSX } from 'react'

interface Props {
  connection: ConnectionStatus
  onOpenSettings: () => void
}

/**
 * Tela que substitui a lista quando não há dados. Em vez de um spinner mudo,
 * mostra em que etapa a conexão parou e o que fazer a respeito — a causa mais
 * comum é o usuário não estar no grupo `docker` do servidor.
 */
export function ConnectionGate({ connection, onOpenSettings }: Props): JSX.Element {
  const [now, setNow] = useState(Date.now())

  // Tique de 1s só enquanto houver contagem regressiva para mostrar.
  useEffect(() => {
    if (!connection.retryAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [connection.retryAt])

  const secondsLeft = connection.retryAt
    ? Math.max(0, Math.ceil((connection.retryAt - now) / 1000))
    : null

  const working = connection.phase === 'connecting' || connection.phase === 'authenticating'

  const unconfigured = connection.phase === 'unconfigured'

  const title = unconfigured
    ? 'Escolha um servidor'
    : connection.phase === 'error'
      ? 'Não consegui falar com o servidor'
      : connection.phase === 'retrying'
        ? 'Conexão perdida'
        : connection.phase === 'authenticating'
          ? 'Autenticando'
          : 'Conectando'

  return (
    <div className="gate">
      <svg className="gate__mark" width="22" height="58" viewBox="0 0 22 58" aria-hidden="true">
        <path d="M11 8v42" stroke="var(--iris-line)" strokeWidth="1.5" />
        <circle cx="11" cy="8" r="4.5" fill="var(--iris-bright)" />
        <circle cx="11" cy="29" r="5" fill={working ? 'var(--iris-bright)' : 'var(--fail)'} />
        <circle cx="11" cy="50" r="4.5" fill="var(--iris-bright)" />
      </svg>

      <div className="gate__title">{title}</div>

      <p className="gate__text prose">
        {unconfigured
          ? 'O Visor fala com o Docker do seu servidor por SSH, sem expor porta nenhuma. Diga qual é o servidor e ele cuida do resto.'
          : (connection.message ?? `Abrindo túnel SSH para ${connection.host ?? 'o servidor'}…`)}
      </p>

      {connection.phase === 'error' && !unconfigured && (
        <div className="gate__hint prose">
          O Visor conversa com o Docker pelo socket do servidor, por cima do SSH. Para isso
          funcionar, confira no servidor:
          <br />
          <br />
          1. O serviço está de pé — <code>systemctl status docker</code>
          <br />
          2. Seu usuário enxerga o socket — <code>groups | grep docker</code>
          <br />
          Se não aparecer, rode <code>sudo usermod -aG docker $USER</code> e reconecte a sessão.
        </div>
      )}

      {secondsLeft !== null && (
        <div className="gate__countdown">nova tentativa em {secondsLeft}s</div>
      )}

      <div className="gate__row">
        {unconfigured ? (
          <button className="btn btn--primary" onClick={onOpenSettings}>
            <IconSettings size={14} /> Configurar servidor
          </button>
        ) : (
          <>
            <button className="btn btn--primary" onClick={() => void window.visor.reconnect()}>
              <IconPlug size={14} /> Tentar agora
            </button>
            <button className="btn" onClick={onOpenSettings}>
              <IconSettings size={14} /> Ajustar conexão
            </button>
          </>
        )}
      </div>
    </div>
  )
}
