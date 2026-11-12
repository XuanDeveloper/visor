import type { JSX } from 'react'

/**
 * Ícones desenhados à mão no mesmo traço: 16px, stroke 1.5, cantos redondos.
 * Nada de biblioteca — um conjunto fechado mantém o peso visual uniforme e
 * evita o ar de "kit genérico".
 */

interface IconProps {
  size?: number
}

const base = (size: number): Record<string, unknown> => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
})

export const IconPlay = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M5.5 3.4v9.2l7-4.6z" fill="currentColor" stroke="none" />
  </svg>
)

export const IconStop = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.4" fill="currentColor" stroke="none" />
  </svg>
)

export const IconRestart = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75" />
    <path d="M13.3 2.4v2.9h-2.9" />
  </svg>
)

export const IconLogs = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M2.8 4.3h10.4M2.8 8h7.4M2.8 11.7h5.2" />
  </svg>
)

export const IconChevron = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M6.2 3.6 10.6 8l-4.4 4.4" />
  </svg>
)

export const IconSearch = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <circle cx="7.2" cy="7.2" r="4.2" />
    <path d="m10.4 10.4 2.8 2.8" />
  </svg>
)

export const IconMinimize = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M3.5 8h9" />
  </svg>
)

export const IconMaximize = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.4" />
  </svg>
)

export const IconClose = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
  </svg>
)

export const IconSettings = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M2.6 4.6h4.1M9.3 4.6h4.1M2.6 11.4h2.1M7.3 11.4h6.1" />
    <circle cx="8" cy="4.6" r="1.8" />
    <circle cx="5.9" cy="11.4" r="1.8" />
  </svg>
)

export const IconPlug = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M6 1.9v3.4M10 1.9v3.4" />
    <path d="M4.2 5.3h7.6v3a3.8 3.8 0 0 1-7.6 0z" />
    <path d="M8 12.1v2" />
  </svg>
)

export const IconPause = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M6.1 3.8v8.4M9.9 3.8v8.4" />
  </svg>
)

export const IconCopy = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <rect x="5.6" y="5.6" width="7.6" height="7.6" rx="1.4" />
    <path d="M10.4 3.4a1.4 1.4 0 0 0-1.4-1.4H4.2a1.4 1.4 0 0 0-1.4 1.4v4.8a1.4 1.4 0 0 0 1.4 1.4" />
  </svg>
)

export const IconScrollDown = ({ size = 16 }: IconProps): JSX.Element => (
  <svg {...base(size)}>
    <path d="M8 3v9M4.4 8.6 8 12.2l3.6-3.6" />
  </svg>
)
