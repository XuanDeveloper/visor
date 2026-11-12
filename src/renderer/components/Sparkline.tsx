import { useMemo } from 'react'
import type { JSX } from 'react'

interface Props {
  values: number[]
  width?: number
  height?: number
  /**
   * Piso da escala vertical. Sem ele, uma série que oscila entre 0,1% e 0,3%
   * vira uma montanha-russa e mente sobre a carga real.
   */
  floor?: number
}

/**
 * Sparkline de área. Não tem eixo nem rótulo de propósito: o número exato
 * está ao lado, aqui só interessa a forma — estável, subindo ou serrilhada.
 */
export function Sparkline({ values, width = 58, height = 18, floor = 5 }: Props): JSX.Element {
  const { line, area } = useMemo(() => {
    if (values.length < 2) return { line: '', area: '' }

    // Série essencialmente ociosa: desenhar uma reta colorida sugeriria uma
    // medição que não existe. A linha de base é mais honesta.
    const span = Math.max(...values) - Math.min(...values)
    if (Math.max(...values) < 1 && span < 0.5) return { line: '', area: '' }

    const peak = Math.max(floor, ...values)
    const stepX = width / (values.length - 1)
    // 1px de folga em cima e embaixo para o stroke não ser cortado.
    const toY = (v: number): number => height - 1 - (v / peak) * (height - 2)

    const points = values.map((v, i) => `${(i * stepX).toFixed(2)},${toY(v).toFixed(2)}`)
    const linePath = `M${points.join(' L')}`
    const areaPath = `${linePath} L${width},${height} L0,${height} Z`
    return { line: linePath, area: areaPath }
  }, [values, width, height, floor])

  if (!line) {
    // Sem histórico suficiente: uma linha de base discreta mantém o ritmo da coluna.
    return (
      <svg className="spark" width={width} height={height} aria-hidden="true">
        <line
          x1="0"
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--line-strong)"
          strokeWidth="1"
        />
      </svg>
    )
  }

  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={area} fill="var(--state-soft)" />
      <path
        d={line}
        fill="none"
        stroke="var(--state)"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  )
}
