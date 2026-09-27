import { Search } from 'lucide-react'
export default function SearchBar({ placeholder = 'Buscar...', value, onChange, onKeyDown, className = '' }) {
  return (
    <div className={`search ${className}`}>
      <Search size={18} aria-hidden="true" />
      <input className="input" type="search" aria-label={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} />
    </div>
  )
}
