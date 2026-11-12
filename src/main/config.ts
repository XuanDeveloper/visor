import Store from 'electron-store'
import type { Preferences } from '@shared/types'

/**
 * Preferências persistidas.
 *
 * Os campos de servidor nascem vazios de propósito. Embutir um host concreto
 * aqui já causou um problema real: o endereço, a porta e o usuário de uma
 * máquina de verdade ficaram no repositório. A primeira execução pede esses
 * dados, com sugestões lidas do ~/.ssh/config de quem está usando.
 */
const defaults: Preferences = {
  ssh: {
    host: '',
    port: 22,
    username: '',
    socketPath: '/var/run/docker.sock'
  },
  statsIntervalMs: 3000,
  notifyOnFailure: true,
  notifyOnRestartLoop: true,
  notifyOnRecovery: false,
  launchAtLogin: true,
  startMinimized: false,
  collapsedStacks: []
}

const store = new Store<{ prefs: Preferences }>({
  name: 'visor',
  defaults: { prefs: defaults }
})

export function getPrefs(): Preferences {
  // Merge com os defaults para que campos novos apareçam em perfis antigos.
  const saved = store.get('prefs')
  return { ...defaults, ...saved, ssh: { ...defaults.ssh, ...saved?.ssh } }
}

export function setPrefs(patch: Partial<Preferences>): Preferences {
  const next: Preferences = {
    ...getPrefs(),
    ...patch,
    ssh: { ...getPrefs().ssh, ...(patch.ssh ?? {}) }
  }
  store.set('prefs', next)
  return next
}

/** Há servidor suficiente para sequer tentar conectar? */
export function isConfigured(prefs: Preferences = getPrefs()): boolean {
  return prefs.ssh.host.trim() !== '' && prefs.ssh.username.trim() !== ''
}
