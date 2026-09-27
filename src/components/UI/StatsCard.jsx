import { TrendingUp, TrendingDown } from 'lucide-react'
export default function StatsCard({ title, value, icon, trend, trendUp, accent, sub }) {
  return (
    <div className={`kpi ${accent ? 'kpi--accent' : ''}`}>
      <div>
        <div className="kpi__label">{title}</div>
        <div className="kpi__value">{value}</div>
        {sub && <div className="kpi__sub">{sub}</div>}
        {trend && (
          <div className={`trend ${trendUp ? 'trend--up' : 'trend--down'}`}>
            {trendUp ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {trend}
          </div>
        )}
      </div>
      {icon && <div className="kpi__icon" aria-hidden="true">{icon}</div>}
    </div>
  )
}
