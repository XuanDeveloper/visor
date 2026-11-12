import { useEffect, useState } from 'react'
import type { Preferences, SshHostSuggestion } from '@shared/types'
import { IconClose } from './Icons'
import type { JSX } from 'react'

interface Props {
  onClose: () => void
}

/**
 * Ajustes. Salvar reconfigura o túnel no main — não há botão "testar"
 * separado porque a própria barra de título já é o teste: ela muda de cor.
 */
export function Settings({ onClose }: Props): JSX.Element {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState<SshHostSuggestion[]>([])
  const [defaultKey, setDefaultKey] = useState<string | undefined>()

  useEffect(() => {
    void window.visor.getPrefs().then(setPrefs)
    void window.visor.getSshHosts().then(({ hosts, defaultKey: key }) => {
      setSuggestions(hosts)
      setDefaultKey(key)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!prefs) return <div className="scrim" />

  const patchSsh = (patch: Partial<Preferences['ssh']>): void =>
    setPrefs({ ...prefs, ssh: { ...prefs.ssh, ...patch } })

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.visor.setPrefs(prefs)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet" role="dialog" aria-label="Configurações do Visor">
        <header className="sheet__head">
          <span className="sheet__title">Configurações</span>
          <button className="iconbtn" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </header>

        <section className="sheet__section">
          <div className="label" style={{ marginBottom: 'var(--s4)' }}>
            Servidor
          </div>

          {suggestions.length > 0 && (
            <div className="suggest">
              <div className="suggest__label">
                Encontrados no seu <code>~/.ssh/config</code>
              </div>
              <div className="suggest__row">
                {suggestions.map((h) => (
                  <button
                    key={h.alias}
                    className="suggest__chip"
                    title={`${h.username ?? '?'}@${h.hostname}:${h.port}`}
                    onClick={() =>
                      patchSsh({
                        host: h.hostname,
                        port: h.port,
                        username: h.username ?? prefs.ssh.username,
                        // A chave do bloco tem precedência; senão, a padrão.
                        privateKeyPath: h.identityFile ?? prefs.ssh.privateKeyPath ?? defaultKey
                      })
                    }
                  >
                    {h.alias}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field field--row">
            <span className="field__label">Host / porta</span>
            <input
              type="text"
              value={prefs.ssh.host}
              onChange={(e) => patchSsh({ host: e.target.value })}
              spellCheck={false}
            />
            <input
              type="number"
              value={prefs.ssh.port}
              onChange={(e) => patchSsh({ port: Number(e.target.value) || 22 })}
            />
          </div>

          <div className="field">
            <span className="field__label">Usuário</span>
            <input
              type="text"
              value={prefs.ssh.username}
              onChange={(e) => patchSsh({ username: e.target.value })}
              spellCheck={false}
            />
          </div>

          <div className="field">
            <span className="field__label">Chave privada</span>
            <input
              type="text"
              value={prefs.ssh.privateKeyPath ?? ''}
              onChange={(e) => patchSsh({ privateKeyPath: e.target.value })}
              placeholder={defaultKey ?? 'caminho da chave privada'}
              spellCheck={false}
            />
          </div>

          <div className="field">
            <span className="field__label">Passphrase</span>
            <input
              type="password"
              value={prefs.ssh.passphrase ?? ''}
              onChange={(e) => patchSsh({ passphrase: e.target.value })}
              placeholder="deixe vazio se a chave não tiver"
            />
          </div>

          <div className="field">
            <span className="field__label">Socket</span>
            <input
              type="text"
              value={prefs.ssh.socketPath}
              onChange={(e) => patchSsh({ socketPath: e.target.value })}
              spellCheck={false}
            />
          </div>
        </section>

        <section className="sheet__section">
          <div className="label" style={{ marginBottom: 'var(--s3)' }}>
            Em segundo plano
          </div>

          <Toggle
            checked={prefs.launchAtLogin}
            onChange={(v) => setPrefs({ ...prefs, launchAtLogin: v })}
            title="Subir junto com o Windows"
            hint="Inicia direto na bandeja, sem abrir janela — só vale no app instalado"
          />
          <Toggle
            checked={prefs.startMinimized}
            onChange={(v) => setPrefs({ ...prefs, startMinimized: v })}
            title="Abrir sempre só na bandeja"
            hint="Mesmo quando você inicia o Visor manualmente"
          />
        </section>

        <section className="sheet__section">
          <div className="label" style={{ marginBottom: 'var(--s3)' }}>
            Avisos
          </div>

          <Toggle
            checked={prefs.notifyOnFailure}
            onChange={(v) => setPrefs({ ...prefs, notifyOnFailure: v })}
            title="Quando um container cair"
            hint="Saída com erro, container morto ou healthcheck falhando"
          />
          <Toggle
            checked={prefs.notifyOnRestartLoop}
            onChange={(v) => setPrefs({ ...prefs, notifyOnRestartLoop: v })}
            title="Loop de reinício"
            hint="Três ou mais reinícios em cinco minutos"
          />
          <Toggle
            checked={prefs.notifyOnRecovery}
            onChange={(v) => setPrefs({ ...prefs, notifyOnRecovery: v })}
            title="Quando voltar ao normal"
            hint="Desligado por padrão — costuma ser barulho"
          />
        </section>

        <section className="sheet__section">
          <div className="field">
            <span className="field__label">Amostragem</span>
            <input
              type="number"
              min={1000}
              step={500}
              value={prefs.statsIntervalMs}
              onChange={(e) =>
                setPrefs({
                  ...prefs,
                  statsIntervalMs: Math.max(1000, Number(e.target.value) || 3000)
                })
              }
            />
          </div>
          <div className="toggle__text">
            <small>Intervalo em ms entre leituras de CPU e memória.</small>
          </div>
        </section>

        <footer className="sheet__foot">
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar e reconectar'}
          </button>
        </footer>
      </div>
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  title: string
  hint: string
}

function Toggle({ checked, onChange, title, hint }: ToggleProps): JSX.Element {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" />
      <span className="toggle__text">
        {title}
        <small>{hint}</small>
      </span>
    </label>
  )
}
