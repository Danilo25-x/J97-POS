import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, User, Lock } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import Sprig from '../../components/UI/Sprig'
import logo from '../../assets/logo.png'
import pkg from '../../../package.json'

export default function LoginPage() {
  const [form, setForm] = useState({ username: '', password: '' })
  const [show, setShow] = useState(false)
  const { login, loading, error, clearError } = useAuthStore()
  const navigate = useNavigate()

  const handleChange = e => { clearError(); setForm(f => ({ ...f, [e.target.name]: e.target.value })) }
  const handleSubmit = async e => {
    e.preventDefault()
    if (!form.username || !form.password) return
    const res = await login(form.username, form.password)
    if (res.ok) navigate('/')
  }
  const disabled = loading || !form.username || !form.password

  return (
    <div className="login">
      <section className="login__brand">
        <Sprig className="login__sprig login__sprig--l" />
        <Sprig className="login__sprig login__sprig--r" />
        <img className="login__logo" src={logo} alt="J'97 Tienda de ropa" />
        <p className="login__tag">Tu estilo, nuestra pasión</p>
      </section>

      <section className="login__side">
        <div className="login__card">
          <h1>Bienvenido</h1>
          <p>Inicia sesión para continuar</p>

          <form className="login__panel" onSubmit={handleSubmit}>
            {error && <div className="notice notice--bad" role="alert" style={{ marginBottom: 18 }}>{error}</div>}

            <div className="field">
              <label className="field__label" htmlFor="username">Usuario</label>
              <div className="search">
                <User size={18} aria-hidden="true" />
                <input id="username" className="input" name="username" value={form.username} onChange={handleChange}
                  placeholder="Ingresa tu usuario" autoComplete="username" autoFocus />
              </div>
            </div>

            <div className="field" style={{ marginBottom: 24 }}>
              <label className="field__label" htmlFor="password">Contraseña</label>
              <div className="search pw">
                <Lock size={18} aria-hidden="true" />
                <input id="password" className="input" name="password" type={show ? 'text' : 'password'} value={form.password}
                  onChange={handleChange} placeholder="••••••••" autoComplete="current-password" />
                <button type="button" className="icon-btn" onClick={() => setShow(s => !s)}
                  aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={disabled}>
              {loading ? 'Verificando...' : 'Iniciar sesión'}
            </button>
          </form>

          <p className="login__foot" style={{ margin: '22px 0 0' }}>J'97 Tienda de Ropa · v{pkg.version}</p>
        </div>
      </section>
    </div>
  )
}
