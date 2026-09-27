import { useId, useState } from 'react'
import { fmt, compact } from '../../utils/format'

const W = 640, H = 270, P = { l: 56, r: 18, t: 18, b: 34 }

function niceTop(v) {
  if (v <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(v)), n = v / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow
}

// Curva monótona (no se sale por debajo de cero)
function smooth(pts) {
  if (pts.length < 2) return ''
  const n = pts.length, dx = [], dy = [], m = []
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].x - pts[i].x; dy[i] = pts[i + 1].y - pts[i].y; m[i] = dy[i] / dx[i] }
  const t = [m[0]]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  t[n - 1] = m[n - 2]
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let d = `M${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${pts[i].x + h} ${pts[i].y + t[i] * h} ${pts[i + 1].x - h} ${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x} ${pts[i + 1].y}`
  }
  return d
}

export default function AreaChart({ data, label = 'Gráfica de ventas' }) {
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState(null)
  const max = Math.max(...data.map(d => d.value), 0)
  const top = niceTop(max)
  const ticks = [0, 1, 2, 3, 4].map(i => (top / 4) * i)
  const iw = W - P.l - P.r, ih = H - P.t - P.b
  const y = v => P.t + ih - (v / top) * ih
  const pts = data.map((d, i) => ({ x: data.length === 1 ? P.l + iw / 2 : P.l + 14 + (i * (iw - 28)) / (data.length - 1), y: y(d.value) }))
  const line = smooth(pts)
  const area = pts.length > 1 ? `${line} L${pts.at(-1).x} ${y(0)} L${pts[0].x} ${y(0)} Z` : ''
  const h = hover != null ? pts[hover] : null

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8248B0" stopOpacity=".32" /><stop offset="1" stopColor="#E27BE0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map(t => (
        <g key={t}>
          <line className="chart__grid" x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} />
          <text className="chart__tick" x={P.l - 10} y={y(t) + 4} textAnchor="end">{t === 0 ? '0' : compact(t)}</text>
        </g>
      ))}
      {area && <path d={area} fill={`url(#${gid})`} />}
      {line && <path className="chart__line" d={line} />}
      {pts.map((p, i) => (
        <g key={i}>
          <text className="chart__tick" x={p.x} y={H - 10} textAnchor="middle">{data[i].label}</text>
          {(pts.length === 1 || hover === i) && <circle className="chart__dot" cx={p.x} cy={p.y} r="5" />}
          <rect x={p.x - iw / data.length / 2} y={P.t} width={iw / data.length} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        </g>
      ))}
      {h && (
        <g className="chart__tip" pointerEvents="none">
          <line className="chart__guide" x1={h.x} x2={h.x} y1={P.t} y2={y(0)} />
          <rect x={Math.min(Math.max(h.x - 62, 4), W - 128)} y={Math.max(h.y - 46, 2)} width="124" height="30" rx="9" />
          <text x={Math.min(Math.max(h.x, 66), W - 66)} y={Math.max(h.y - 26, 22)} textAnchor="middle">{fmt(data[hover].value)}</text>
        </g>
      )}
    </svg>
  )
}
