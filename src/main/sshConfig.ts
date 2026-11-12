import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshHostSuggestion } from '@shared/types'

/**
 * Lê ~/.ssh/config para sugerir servidores na primeira execução.
 *
 * Quem roda Docker em outra máquina quase sempre já tem esse host no config
 * do SSH. Pedir que a pessoa redigite host, porta, usuário e caminho da chave
 * seria pedir duas vezes a mesma informação.
 *
 * Parser deliberadamente parcial: só as quatro diretivas que o Visor usa.
 * Não resolve Include, Match nem curingas — um host com `*` no nome não vira
 * sugestão, porque não é um destino concreto.
 */

const DIRECTIVES = new Set(['hostname', 'port', 'user', 'identityfile'])

/** Expande `~` e `%d`, que o OpenSSH aceita em IdentityFile. */
function expandHome(path: string): string {
  const home = homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  if (path === '~') return home
  return path.replace(/%d/g, home)
}

export async function readSshHosts(): Promise<SshHostSuggestion[]> {
  let text: string
  try {
    text = await readFile(join(homedir(), '.ssh', 'config'), 'utf8')
  } catch {
    // Não ter ~/.ssh/config é perfeitamente normal.
    return []
  }

  const hosts: SshHostSuggestion[] = []
  let current: SshHostSuggestion | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    // As diretivas aceitam "Chave valor" e "Chave=valor".
    const match = /^(\w+)\s*[=\s]\s*(.+)$/.exec(line)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()

    if (key === 'host') {
      if (current) hosts.push(current)
      // Vários aliases na mesma linha: o primeiro concreto representa o bloco.
      const alias = value.split(/\s+/).find((a) => !a.includes('*') && !a.includes('?'))
      current = alias ? { alias, hostname: alias, port: 22 } : null
      continue
    }

    if (!current || !DIRECTIVES.has(key)) continue

    if (key === 'hostname') current.hostname = value
    else if (key === 'port') current.port = Number(value) || 22
    else if (key === 'user') current.username = value
    else if (key === 'identityfile') current.identityFile = expandHome(value.replace(/^["']|["']$/g, ''))
  }

  if (current) hosts.push(current)
  return hosts
}

/** Caminhos de chave que o OpenSSH tenta por padrão, na ordem de preferência. */
const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa']

/** Primeira chave padrão existente, para preencher o campo quando o config não diz. */
export async function guessDefaultKey(): Promise<string | undefined> {
  const { access } = await import('node:fs/promises')
  for (const name of DEFAULT_KEYS) {
    const path = join(homedir(), '.ssh', name)
    try {
      await access(path)
      return path
    } catch {
      /* tenta a próxima */
    }
  }
  return undefined
}
