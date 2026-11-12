/**
 * Mede o contraste real dos textos no app EM EXECUÇÃO e salva uma captura.
 *
 * Existe porque validar no servidor de preview não basta: o app carrega o
 * bundle de `out/`, então uma correção de estilo sem `electron-vite build`
 * não chega à tela que o usuário vê.
 *
 *   1) electron . --remote-debugging-port=9222
 *   2) node scripts/check-contrast.mjs popover [saida.png] [porta]
 */
import { writeFileSync } from 'node:fs'

const WHICH = process.argv[2] ?? 'popover'
const OUT = process.argv[3]
const PORT = process.argv[4] ?? '9222'

/** Alvo da WCAG para texto pequeno. */
const TARGET = 4.5

/** Os textos de apoio, que são os primeiros a ficar ilegíveis. */
const PROBES =
  WHICH === 'popover'
    ? [
        ['.score__k', 'rótulo placar'],
        ['.pop__meta', 'rodapé'],
        ['.grp__idx', 'índice'],
        ['.svc__name', 'nome serviço'],
        ['.svc__num', 'número serviço'],
        ['.grp__name', 'nome stack'],
        ['.pop__host', 'host'],
        ['.pop__foot .pop__btn', 'ícone rodapé']
      ]
    : [
        ['.label', 'rótulo seção'],
        ['.row__name', 'nome container'],
        ['.row__meta', 'meta container'],
        ['.metric__value', 'métrica'],
        ['.host__line', 'linha host'],
        ['.navitem__name', 'nav stack'],
        ['.tally__word', 'legenda'],
        ['.port', 'porta']
      ]

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
const page = targets.find(
  (t) => t.type === 'page' && (WHICH === 'popover' ? t.url.includes('popover') : t.url.includes('panel'))
)
if (!page) {
  console.log(`janela "${WHICH}" não encontrada. alvos:`, targets.map((t) => t.url))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 1
const pend = new Map()
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = id++
    pend.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
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

// Avaliado dentro da página: só o navegador sabe a cor computada final,
// incluindo color-mix e herança.
const expression = `
(() => {
  function channels(css) {
    var out = [], num = ''
    for (var i = 0; i < css.length; i++) {
      var ch = css[i]
      if ((ch >= '0' && ch <= '9') || ch === '.') num += ch
      else if (num.length) { out.push(parseFloat(num)); num = '' }
    }
    if (num.length) out.push(parseFloat(num))
    return out
  }
  function lum(css) {
    var c = channels(css)
    // O Chrome serializa color-mix() como "color(srgb 0.42 0.87 0.69)", com
    // canais de 0 a 1 — não de 0 a 255. Tratar os dois como 0-255 fazia uma
    // cor clara ser lida como quase preta e inventava falhas de contraste.
    var scale = css.indexOf('color(') === 0 ? 1 : 255
    var v = [c[0] || 0, c[1] || 0, c[2] || 0].map(function (x) {
      var s = x / scale
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
  }
  function rgbOf(css) {
    var c = channels(css)
    var scale = css.indexOf('color(') === 0 ? 1 : 255
    return {
      r: (c[0] || 0) * (255 / scale),
      g: (c[1] || 0) * (255 / scale),
      b: (c[2] || 0) * (255 / scale),
      a: css.indexOf('rgba') === 0 || css.indexOf('/') !== -1
        ? (c[3] === undefined ? 1 : c[3])
        : 1
    }
  }
  /**
   * Compõe a pilha de fundos até achar um opaco. Sem isso, um fundo
   * semitransparente da mesma matiz do texto é lido como contraste 1:1.
   */
  function bgOf(el) {
    var stack = [], n = el
    while (n) {
      var c = getComputedStyle(n).backgroundColor
      if (c && c.indexOf('rgba(0, 0, 0, 0)') === -1) {
        var col = rgbOf(c)
        stack.push(col)
        if (col.a >= 0.999) break
      }
      n = n.parentElement
    }
    if (!stack.length) return 'rgb(15, 13, 22)'
    var base = stack[stack.length - 1]
    if (base.a < 0.999) base = { r: 15, g: 13, b: 22, a: 1 }
    var out = { r: base.r, g: base.g, b: base.b }
    for (var i = stack.length - 2; i >= 0; i--) {
      var t = stack[i]
      out.r = t.r * t.a + out.r * (1 - t.a)
      out.g = t.g * t.a + out.g * (1 - t.a)
      out.b = t.b * t.a + out.b * (1 - t.a)
    }
    return 'rgb(' + Math.round(out.r) + ', ' + Math.round(out.g) + ', ' + Math.round(out.b) + ')'
  }
  var list = ${JSON.stringify(PROBES)}
  return list.map(function (pair) {
    var el = document.querySelector(pair[0])
    if (!el) return null
    var st = getComputedStyle(el)
    var a = lum(st.color), b = lum(bgOf(el))
    var hi = Math.max(a, b), lo = Math.min(a, b)
    return {
      rotulo: pair[1],
      px: st.fontSize,
      contraste: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
      texto: el.textContent.trim().slice(0, 24)
    }
  }).filter(Boolean)
})()`

const r = await send('Runtime.evaluate', { expression, returnByValue: true })
if (r.exceptionDetails) {
  console.log('ERRO JS:', r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  process.exit(1)
}

let worst = 99
console.log(`contraste em "${WHICH}" — alvo ${TARGET}:1 para texto pequeno\n`)
for (const p of r.result.value) {
  worst = Math.min(worst, p.contraste)
  console.log(
    `${p.contraste >= TARGET ? 'ok ' : '!! '}${p.rotulo.padEnd(16)} ${p.px.padEnd(8)}` +
      `${String(p.contraste).padStart(6)}:1   "${p.texto}"`
  )
}
console.log(`\npior: ${worst}:1`)

if (OUT) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log('captura:', OUT)
}
ws.close()
