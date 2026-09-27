import { useId } from 'react'

// Ramita decorativa (motivo de hojas del logo J'97). Solo decoración.
const LEAVES = [
  { x: 77, y: 258, r: -38, s: 0.9, side: 1 }, { x: 75, y: 226, r: -32, s: 1, side: -1 },
  { x: 79, y: 190, r: -40, s: 1.05, side: 1 }, { x: 82, y: 156, r: -34, s: 1, side: -1 },
  { x: 87, y: 122, r: -40, s: 0.95, side: 1 }, { x: 89, y: 90, r: -32, s: 0.85, side: -1 },
  { x: 87, y: 60, r: -36, s: 0.7, side: 1 },
]

export default function Sprig({ className = '', style }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={className} style={style} viewBox="0 0 170 300" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C9B8F0" /><stop offset="1" stopColor="#F49AD0" />
        </linearGradient>
      </defs>
      <path d="M78 298 C 68 230, 96 160, 86 34" stroke={`url(#${id})`} strokeWidth="1.6" strokeLinecap="round" />
      {LEAVES.map((l, i) => (
        <g key={i} transform={`translate(${l.x} ${l.y}) scale(${l.side * l.s} ${l.s}) rotate(${l.r})`}>
          <path d="M0 0 C 12 -20, 40 -26, 62 -14 C 46 6, 18 12, 0 0 Z" fill={`url(#${id})`} fillOpacity=".22" stroke={`url(#${id})`} strokeWidth="1.3" />
          <path d="M2 -1 C 20 -8, 40 -12, 58 -13" stroke={`url(#${id})`} strokeWidth=".9" />
        </g>
      ))}
    </svg>
  )
}
