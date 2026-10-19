import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { getTheme, setTheme } from '../../utils/theme'

// Alterna entre tema oscuro (por defecto) y claro. El botón describe la acción que realiza.
export default function ThemeToggle({ className = '' }) {
  const [theme, setCurrent] = useState(getTheme)
  const toLight = theme === 'dark'
  const toggle = () => {
    const next = toLight ? 'light' : 'dark'
    setTheme(next)
    setCurrent(next)
  }
  const label = toLight ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'
  return (
    <button type="button" className={`icon-btn ${className}`.trim()} onClick={toggle} title={label} aria-label={label}>
      {toLight ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
