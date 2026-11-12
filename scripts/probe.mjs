/**
 * Valida o caminho SSH → docker.sock fora do Electron.
 * Uso: VISOR_HOST=<host> VISOR_USER=<user> node scripts/probe.mjs [passphrase]
 *
 * Não altera nada no servidor: só lê a lista de containers e o info do daemon.
 */
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import ssh2 from 'ssh2'
import Docker from 'dockerode'

/**
 * Configure pelo ambiente — nenhum endereço real fica no repositório:
 *   VISOR_HOST=192.168.0.10 VISOR_USER=docker node scripts/probe.mjs
 */
const CONFIG = {
  host: process.env.VISOR_HOST,
  port: Number(process.env.VISOR_PORT ?? 22),
  username: process.env.VISOR_USER,
  keyPath: process.env.VISOR_KEY ?? join(homedir(), '.ssh', 'id_ed25519'),
  socketPath: process.env.VISOR_SOCKET ?? '/var/run/docker.sock'
}

if (!CONFIG.host || !CONFIG.username) {
  console.error('Defina VISOR_HOST e VISOR_USER.')
  console.error('  VISOR_HOST=192.168.0.10 VISOR_USER=docker node scripts/probe.mjs')
  process.exit(1)
}

const passphrase = process.env.VISOR_PASSPHRASE || process.argv[2] || undefined
const conn = new ssh2.Client()

const fail = (stage, err) => {
  console.error(`\n✕ ${stage}`)
  console.error(`  ${err?.message ?? err}`)
  if (err?.level) console.error(`  level: ${err.level}`)
  process.exit(1)
}

conn.on('error', (err) => fail('Conexão SSH', err))

conn.on('ready', () => {
  console.log(`✓ SSH autenticado em ${CONFIG.username}@${CONFIG.host}:${CONFIG.port}`)

  const server = net.createServer((local) => {
    conn.openssh_forwardOutStreamLocal(CONFIG.socketPath, (err, remote) => {
      if (err) {
        local.destroy()
        return
      }
      local.pipe(remote)
      remote.pipe(local)
    })
  })

  server.listen(0, '127.0.0.1', async () => {
    const { port } = server.address()
    console.log(`✓ Túnel local em 127.0.0.1:${port} → ${CONFIG.socketPath}`)

    const docker = new Docker({ host: '127.0.0.1', port, protocol: 'http' })

    try {
      const version = await docker.version()
      console.log(`✓ Docker Engine ${version.Version} (API ${version.ApiVersion})`)

      const info = await docker.info()
      console.log(
        `✓ Host "${info.Name}" · ${info.NCPU} núcleos · ` +
          `${(info.MemTotal / 1024 ** 3).toFixed(1)} GB · ${info.OperatingSystem}`
      )

      const list = await docker.listContainers({ all: true })
      console.log(`\n${list.length} containers encontrados:\n`)

      // Agrupa igual o app faz, para conferir que as labels do compose existem.
      const stacks = new Map()
      for (const c of list) {
        const key = c.Labels?.['com.docker.compose.project'] ?? '(avulsos)'
        if (!stacks.has(key)) stacks.set(key, [])
        stacks.get(key).push(c)
      }

      for (const [stack, items] of [...stacks].sort()) {
        const up = items.filter((c) => c.State === 'running').length
        console.log(`  ${stack}  —  ${up}/${items.length} no ar`)
        for (const c of items) {
          const name = (c.Names[0] ?? '').replace(/^\//, '')
          const svc = c.Labels?.['com.docker.compose.service'] ?? ''
          const ports = c.Ports.filter((p) => p.PublicPort)
            .map((p) => p.PublicPort)
            .join(',')
          console.log(
            `     ${c.State.padEnd(10)} ${name.padEnd(28)} ${svc.padEnd(18)} ${ports}`
          )
        }
        console.log('')
      }

      // Stats de um container vivo confirmam que o cálculo de CPU fecha.
      const alive = list.find((c) => c.State === 'running')
      if (alive) {
        const raw = await docker.getContainer(alive.Id).stats({ stream: false })
        const cpuDelta =
          raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage
        const sysDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage
        const cores = raw.cpu_stats.online_cpus || 1
        const cpu = sysDelta > 0 ? (cpuDelta / sysDelta) * cores * 100 : 0
        console.log(
          `✓ Stats OK — ${(alive.Names[0] ?? '').replace(/^\//, '')}: ` +
            `CPU ${cpu.toFixed(2)}% · MEM ${(raw.memory_stats.usage / 1024 ** 2).toFixed(0)} MB`
        )
      }

      console.log('\nTudo pronto. O app consegue falar com esse servidor.')
    } catch (err) {
      fail('Docker Engine API', err)
    } finally {
      server.close()
      conn.end()
    }
  })
})

let privateKey
try {
  privateKey = readFileSync(CONFIG.keyPath)
} catch (err) {
  fail(`Leitura da chave ${CONFIG.keyPath}`, err)
}

conn.connect({
  host: CONFIG.host,
  port: CONFIG.port,
  username: CONFIG.username,
  privateKey,
  passphrase,
  readyTimeout: 15000
})
