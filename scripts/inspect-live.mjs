/**
 * Verifica o app REAL de ponta a ponta: conecta no DevTools Protocol de uma
 * instância já rodando, lê o que a UI efetivamente renderizou e salva uma
 * captura da janela.
 *
 * 1) electron . --remote-debugging-port=9222
 * 2) node scripts/inspect-live.mjs [porta] [saida.png]
 *
 * Só lê — não dispara nenhuma ação sobre os containers.
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9222'
const SHOT = process.argv[3] || 'live.png'
const WHICH = process.argv[4] || 'popover'

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
const page = targets.find((t) => t.type === 'page' && t.url.includes(WHICH))
if (!page) {
  console.error(
    `Janela "${WHICH}" não encontrada. Disponíveis:`,
    targets.filter((t) => t.type === 'page').map((t) => t.url)
  )
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  const entry = pending.get(msg.id)
  if (!entry) return
  pending.delete(msg.id)
  if (msg.error) entry.reject(new Error(msg.error.message))
  else entry.resolve(msg.result)
})

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
  return res.result.value
}

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('Falha ao abrir o WebSocket')), {
    once: true
  })
})

try {
  const report = await evaluate(`
    (() => {
      const text = (el) => (el ? el.textContent.trim() : null)
      const popover = !!document.querySelector('.pop')

      const stacks = popover
        ? [...document.querySelectorAll('.grp')].map((g) => ({
            nome: text(g.querySelector('.grp__name')),
            contagem: text(g.querySelector('.grp__tally')),
            pior: g.dataset.worst,
            linhas: [...g.querySelectorAll('.svc')].map((r) => ({
              nome: text(r.querySelector('.svc__name')),
              estado: r.dataset.state,
              meta: text(r.querySelector('.svc__note')) ?? '',
              cpu: text(r.querySelectorAll('.svc__num')[0]),
              mem: text(r.querySelectorAll('.svc__num')[1])
            }))
          }))
        : [...document.querySelectorAll('.stack')].map((s) => ({
            nome: text(s.querySelector('.stack__name')),
            contagem: text(s.querySelector('.stack__tally')),
            pior: s.dataset.worst,
            linhas: [...s.querySelectorAll('.row')].map((r) => ({
              nome: text(r.querySelector('.row__name')),
              estado: r.dataset.state,
              meta: text(r.querySelector('.row__meta')),
              cpu: text(r.querySelectorAll('.metric__value')[0]),
              mem: text(r.querySelectorAll('.metric__value')[1])
            }))
          }))

      return {
        superficie: popover ? 'painel da bandeja' : 'janela completa',
        conexao: popover
          ? {
              host: text(document.querySelector('.pop__host')),
              detalhe: text(document.querySelector('.pop__lat')),
              vivo: !document.querySelector('.pop__gate')
            }
          : {
              host: text(document.querySelector('.conn__host')),
              detalhe: text(document.querySelector('.conn__lat')),
              vivo: !!document.querySelector('.conn--live')
            },
        host: text(document.querySelector('.host__name')) ?? text(document.querySelector('.pop__meta')),
        hostLinhas: [...document.querySelectorAll('.host__line')].map((e) => e.textContent.trim()),
        contagens: popover
          ? [...document.querySelectorAll('.score')].map(
              (c) => text(c.querySelector('.score__k')) + ': ' + text(c.querySelector('.score__n'))
            )
          : [...document.querySelectorAll('.tally')].map(
              (t) => text(t.querySelector('.tally__word')) + ': ' + text(t.querySelector('.tally__count'))
            ),
        pontosConstelacao: document.querySelectorAll('.constel__dot').length,
        erroNaTela: text(document.querySelector('.gate__title')) ?? text(document.querySelector('.pop__gate-title')),
        stacks
      }
    })()
  `)

  console.log('=== SUPERFÍCIE ===')
  console.log(report.superficie)

  console.log('\n=== CONEXÃO ===')
  console.log(report.conexao)
  if (report.erroNaTela) console.log('TELA DE ERRO:', report.erroNaTela)

  console.log('\n=== HOST ===')
  console.log(report.host, report.hostLinhas.length ? '| ' + report.hostLinhas.join(' | ') : '')

  console.log('\n=== CONTAGENS ===')
  console.log(report.contagens.join('  ·  '))
  if (report.pontosConstelacao) console.log(`constelação: ${report.pontosConstelacao} pontos`)

  console.log(`\n=== ${report.stacks.length} STACKS RENDERIZADAS ===`)
  for (const s of report.stacks) {
    console.log(`\n  ${s.nome}  ${s.contagem}  [${s.pior}]`)
    for (const r of s.linhas) {
      console.log(
        `     ${String(r.estado).padEnd(14)} ${String(r.nome).padEnd(26)} ` +
          `${String(r.cpu).padStart(6)} ${String(r.mem).padStart(9)}  ${r.meta}`
      )
    }
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(SHOT, Buffer.from(data, 'base64'))
  console.log(`\ncaptura salva em ${SHOT}`)
} finally {
  ws.close()
}
