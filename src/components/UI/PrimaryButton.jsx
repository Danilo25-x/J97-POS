export default function PrimaryButton({ children, onClick, disabled = false, fullWidth = false, variant = 'primary', size = 'md', type = 'button', className = '', ...rest }) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, fullWidth && 'btn--block', className].filter(Boolean).join(' ')
  return <button type={type} onClick={onClick} disabled={disabled} className={cls} {...rest}>{children}</button>
}
