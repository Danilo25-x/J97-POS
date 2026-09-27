import { useId } from 'react'
export default function InputField({ label, error, hint, className = '', ...props }) {
  const id = useId()
  return (
    <div className="field">
      {label && <label htmlFor={id} className="field__label">{label}</label>}
      <input id={id} {...props} className={`input ${error ? 'input--error' : ''} ${className}`} aria-invalid={!!error} />
      {error && <p className="field__error">{error}</p>}
      {hint && !error && <p className="field__hint">{hint}</p>}
    </div>
  )
}
