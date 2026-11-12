/**
 * Captura as telas do Visor em tamanhos exatos, para revisão e para o UI kit.
 *
 * Usa o DevTools Protocol em vez de `--screenshot`: a flag `--window-size` do
 * Chrome/Edge headless não garante a viewport (aqui ela vinha 492px quando
 * pedimos 408), e qualquer diferença corta a imagem em silêncio.
 * `Emulation.setDeviceMetricsOverride` define a viewport de verdade.
 *
 *   1) npx vite --config vite.preview.config.ts
 *   2) msedge --headless=new --remote-debugging-port=9333 about:blank
 *   3) node scripts/shoot-ui.mjs 9333 docs 2
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = process.argv[2] || '9333'
const OUT = process.argv[3] || 'docs'
/** 2 gera imagens nítidas o bastante para impressão no PDF. */
const SCALE = Number(process.argv[4] || 2)
const BASE = 'http://localhost:5188'

/** Cada cena: arquivo, URL, viewport e o que fazer antes de capturar. */
const SCENES = [
  { name: 'panel', url: `${BASE}/?mode=popover`, w: 416, h: 672 },
  {
    name: 'panel-groups',
    url: `${BASE}/?mode=popover`,
    w: 416,
    h: 672,
    // Abre três grupos saudáveis para mostrar a lista expandida.
    act: `[...document.querySelectorAll('.grp')].slice(3,6).forEach(g => g.querySelector('.grp__head').click())`
  },
  {
    name: 'panel-actions',
    url: `${BASE}/?mode=popover`,
    w: 416,
    h: 672,
    // Desce o cursor pelo teclado até um serviço: revela as ações inline e
    // exercita a navegação de verdade, em vez de simular hover (que o React
    // ouve como mouseover, e o CSS :hover nem responde a evento sintético).
    act: `[1,2].forEach(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })))`
  },
  {
    name: 'panel-search',
    url: `${BASE}/?mode=popover`,
    w: 416,
    h: 672,
    act: `'postgres'.split('').forEach(ch =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch })))`
  },
  { name: 'window', url: `${BASE}/?mode=panel`, w: 1180, h: 760 },
  { name: 'window-inspector', url: `${BASE}/?mode=panel&view=inspector`, w: 1180, h: 760, wait: 4200 },
  { name: 'window-find', url: `${BASE}/?mode=panel&view=search`, w: 1180, h: 760 },
  { name: 'window-settings', url: `${BASE}/?mode=panel&view=settings`, w: 1180, h: 760 },
  { name: 'window-collapsed', url: `${BASE}/?mode=panel&view=collapsed`, w: 1180, h: 760 },
  { name: 'window-narrow', url: `${BASE}/?mode=panel`, w: 880, h: 700 }
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())
const page = targets.find((t) => t.type === 'page')
if (!page) {
  console.error('Nenhuma aba encontrada. O navegador subiu com --remote-debugging-port?')
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

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('WebSocket não abriu')), { once: true })
})

mkdirSync(OUT, { recursive: true })
await send('Page.enable')

for (const scene of SCENES) {
  // A viewport precisa ser aplicada antes da navegação: componentes que medem
  // o próprio tamanho na montagem leriam a viewport antiga.
  await send('Emulation.setDeviceMetricsOverride', {
    width: scene.w,
    height: scene.h,
    deviceScaleFactor: SCALE,
    mobile: false
  })

  await send('Page.navigate', { url: scene.url })

  // Espera a interface existir de fato. Um tempo fixo não basta: com o Vite
  // subindo a frio, a primeira cena saía em branco e ninguém percebia.
  const ready = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `new Promise((ok) => {
      const t0 = Date.now()
      const tick = () => {
        if (document.querySelector('.pop__list, .pop__gate, .stack, .gate')) ok(true)
        else if (Date.now() - t0 > 20000) ok(false)
        else setTimeout(tick, 100)
      }
      tick()
    })`
  })
  if (!ready.result.value) throw new Error(`${scene.name}: a interface não apareceu em 20s`)
  await sleep(scene.wait ?? 1400)

  if (scene.act) {
    await send('Runtime.evaluate', { expression: `(() => { ${scene.act}; return true })()` })
    await sleep(700)
  }

  // Fonte carregada antes de capturar, senão sai no fallback do sistema.
  await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })

  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false
  })
  const file = join(OUT, `${scene.name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))

  const check = await send('Runtime.evaluate', {
    expression: `({ vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth })`,
    returnByValue: true
  })
  const { vw, vh, over } = check.result.value
  console.log(
    `${scene.name.padEnd(20)} ${vw}x${vh}` + (over > 0 ? `  ⚠ estoura ${over}px` : '  ok')
  )
}

await send('Emulation.clearDeviceMetricsOverride')
ws.close()
console.log(`\n${SCENES.length} telas em ${OUT}/ (escala ${SCALE}x)`)
