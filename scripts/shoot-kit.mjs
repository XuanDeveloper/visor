/**
 * Captura cada página do UI kit separadamente, para revisão visual antes de
 * gerar o PDF. Uma página = uma imagem, no mesmo formato A4 paisagem.
 *
 *   msedge --headless=new --remote-debugging-port=9333 about:blank
 *   node scripts/shoot-kit.mjs 9333 <dirSaida>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PORT = process.argv[2] || '9333'
const OUT = process.argv[3] || 'ui-kit/paginas'

/** A4 paisagem a 96dpi. */
const W = 1122
const H = 794

const file = resolve('ui-kit/ui-kit.html').replace(/\\/g, '/')
const url = `file:///${file}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('nenhuma aba disponível')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const pend = new Map()
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = id++
    pend.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
  })
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  const p = pend.get(m.id)
  if (!p) return
  pend.delete(m.id)
  if (m.error) p.rej(new Error(m.error.message))
  else p.res(m.result)
})
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

mkdirSync(OUT, { recursive: true })
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: W,
  height: H,
  deviceScaleFactor: 1.5,
  mobile: false
})
await send('Page.navigate', { url })
await sleep(3500)
await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })

const count = (
  await send('Runtime.evaluate', {
    expression: 'document.querySelectorAll(".page").length',
    returnByValue: true
  })
).result.value

for (let i = 0; i < count; i++) {
  // Cada .page tem exatamente a altura da folha, então rolar por múltiplos
  // dela enquadra a página inteira sem cálculo de offset.
  const r = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelectorAll('.page')[${i}]
      const b = el.getBoundingClientRect()
      scrollTo(0, scrollY + b.top)
      return { w: Math.round(b.width), h: Math.round(b.height) }
    })()`,
    returnByValue: true
  })
  await sleep(350)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const name = `p${String(i + 1).padStart(2, '0')}.png`
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
  console.log(`${name}  ${r.result.value.w}x${r.result.value.h}`)
}

await send('Emulation.clearDeviceMetricsOverride')
ws.close()
console.log(`\n${count} páginas em ${OUT}/`)
