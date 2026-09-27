import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

const TITLES = {
  '/':          'Dashboard',
  '/inventory': 'Inventario',
  '/ventas':    'Ventas',
  '/reports':   'Reportes',
  '/settings':  'Configuración',
}

export default function Header() {
  const location = useLocation()
  const navigate  = useNavigate()
  const { logout } = useAuthStore()
  const title = TITLES[location.pathname] || "J'97"
  const now = new Date().toLocaleDateString('es-CO', {
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  })

  const handleLogout = async () => { await logout(); navigate('/login') }

  return (
    <header style={{
      height:56, background:'#FFFFFF',
      borderBottom:'1px solid #E9ECEF',
      display:'flex', alignItems:'center',
      justifyContent:'space-between', padding:'0 28px',
      flexShrink:0,
    }}>
      <div style={{ fontWeight:700, fontSize:'17px', color:'#212529' }}>{title}</div>
      <div style={{ display:'flex', alignItems:'center', gap:'20px' }}>
        <span style={{ fontSize:'12px', color:'#ADB5BD', textTransform:'capitalize' }}>{now}</span>
        <button onClick={handleLogout} style={{
          fontSize:'13px', color:'#B02A37',
          background:'#FFF5F5', border:'1px solid #F1AEB5',
          borderRadius:'8px', padding:'6px 14px',
          cursor:'pointer', fontWeight:600,
          fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",
        }}>
          Cerrar sesión
        </button>
      </div>
    </header>
  )
}
