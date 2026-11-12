/**
 * Gera os PNGs do tray e do app sem depender de nenhuma lib de imagem.
 * O desenho é a própria marca do Visor: um rail vertical com três nós — o
 * mesmo dispositivo que a UI usa para representar uma stack.
 *
 * Rode com: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'resources')

/* ---------------------------------------------------------------- */
/* Encoder PNG mínimo (RGBA, 8 bits, sem filtros)                    */
/* ---------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // 10..12 = compression, filter, interlace — todos 0

  // Cada scanline precisa do byte de filtro na frente.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------------------------------------------------------------- */
/* Canvas minúsculo com antialias por supersampling                  */
/* ---------------------------------------------------------------- */

/** Fator de supersampling: desenhamos 4x e reduzimos, o que dá bordas suaves. */
const SS = 4

function createCanvas(size) {
  const dim = size * SS
  const buf = Buffer.alloc(dim * dim * 4)
  return {
    dim,
    buf,
    /** Mistura uma cor no pixel respeitando o alpha de origem. */
    blend(x, y, [r, g, b, a]) {
      if (x < 0 || y < 0 || x >= dim || y >= dim || a <= 0) return
      const i = (y * dim + x) * 4
      const sa = a / 255
      const da = buf[i + 3] / 255
      const outA = sa + da * (1 - sa)
      if (outA === 0) return
      buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / outA)
      buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / outA)
      buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / outA)
      buf[i + 3] = Math.round(outA * 255)
    }
  }
}

function downsample(canvas, size) {
  const out = Buffer.alloc(size * size * 4)
  const n = SS * SS
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * canvas.dim + (x * SS + sx)) * 4
          const pa = canvas.buf[i + 3]
          // Premultiplica para a média não escurecer as bordas transparentes.
          r += canvas.buf[i] * pa
          g += canvas.buf[i + 1] * pa
          b += canvas.buf[i + 2] * pa
          a += pa
        }
      }
      const o = (y * size + x) * 4
      out[o] = a > 0 ? Math.round(r / a) : 0
      out[o + 1] = a > 0 ? Math.round(g / a) : 0
      out[o + 2] = a > 0 ? Math.round(b / a) : 0
      out[o + 3] = Math.round(a / n)
    }
  }
  return out
}

function fillCircle(canvas, cx, cy, radius, color) {
  const r2 = radius * radius
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(canvas.dim - 1, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(canvas.dim - 1, Math.ceil(cy + radius))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r2) canvas.blend(x, y, color)
    }
  }
}

function fillRoundedRect(canvas, x, y, w, h, radius, color) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      // Distância até o retângulo interno encolhido pelo raio.
      const qx = Math.max(x + radius - (px + 0.5), px + 0.5 - (x + w - radius), 0)
      const qy = Math.max(y + radius - (py + 0.5), py + 0.5 - (y + h - radius), 0)
      if (qx * qx + qy * qy <= radius * radius) canvas.blend(px, py, color)
    }
  }
}

const hex = (value, alpha = 255) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
  alpha
]

/* ---------------------------------------------------------------- */
/* As marcas                                                         */
/* ---------------------------------------------------------------- */

const PALETTE = {
  ok: '#3ddc97',
  warn: '#f2b53c',
  fail: '#ff5c7a',
  offline: '#6b6d82',
  iris: '#8f7fe0',
  void: '#14151c'
}

/**
 * Tray: rail vertical com três nós. O nó do meio carrega a cor do estado;
 * os outros dois ficam esmaecidos para o olho achar o foco imediatamente.
 */
function drawTray(size, accentHex) {
  const canvas = createCanvas(size)
  const u = size * SS
  const accent = hex(accentHex)
  const dim = hex(accentHex, 110)

  const cx = u * 0.5
  const nodes = [u * 0.22, u * 0.5, u * 0.78]
  const nodeR = u * 0.115

  // O rail: uma barra fina que atravessa os três nós.
  fillRoundedRect(
    canvas,
    cx - u * 0.028,
    nodes[0],
    u * 0.056,
    nodes[2] - nodes[0],
    u * 0.028,
    hex(accentHex, 90)
  )

  fillCircle(canvas, cx, nodes[0], nodeR, dim)
  fillCircle(canvas, cx, nodes[2], nodeR, dim)
  // O nó central ganha um halo para sobreviver a 16px.
  fillCircle(canvas, cx, nodes[1], nodeR * 1.55, hex(accentHex, 60))
  fillCircle(canvas, cx, nodes[1], nodeR * 1.05, accent)

  return encodePng(size, size, downsample(canvas, size))
}

/** Ícone do app: a mesma marca sobre um quadrado arredondado grafite. */
function drawApp(size) {
  const canvas = createCanvas(size)
  const u = size * SS

  fillRoundedRect(canvas, 0, 0, u, u, u * 0.22, hex(PALETTE.void))

  const cx = u * 0.5
  const nodes = [u * 0.27, u * 0.5, u * 0.73]
  const nodeR = u * 0.085

  fillRoundedRect(
    canvas,
    cx - u * 0.02,
    nodes[0],
    u * 0.04,
    nodes[2] - nodes[0],
    u * 0.02,
    hex(PALETTE.iris, 120)
  )

  fillCircle(canvas, cx, nodes[0], nodeR, hex(PALETTE.iris))
  fillCircle(canvas, cx, nodes[1], nodeR * 1.5, hex(PALETTE.ok, 55))
  fillCircle(canvas, cx, nodes[1], nodeR, hex(PALETTE.ok))
  fillCircle(canvas, cx, nodes[2], nodeR, hex(PALETTE.iris))

  return encodePng(size, size, downsample(canvas, size))
}

mkdirSync(OUT, { recursive: true })

for (const [name, color] of Object.entries(PALETTE)) {
  if (!['ok', 'warn', 'fail', 'offline'].includes(name)) continue
  // 32px cobre bem o tray do Windows em 100% e 150% de escala.
  writeFileSync(join(OUT, `tray-${name}.png`), drawTray(32, color))
}
writeFileSync(join(OUT, 'icon.png'), drawApp(256))

console.log('resources/: tray-{ok,warn,fail,offline}.png + icon.png')
