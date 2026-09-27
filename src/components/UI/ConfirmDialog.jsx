import Modal from './Modal'
import PrimaryButton from './PrimaryButton'
// Reemplaza window.confirm (que en Electron puede dejar los inputs sin foco)
export default function ConfirmDialog({ isOpen, title, text, confirmLabel = 'Confirmar', danger, onConfirm, onCancel }) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} width={440}>
      <p style={{ color: 'var(--ink-2)', marginBottom: 22 }}>{text}</p>
      <div className="modal__foot">
        <PrimaryButton variant="ghost" onClick={onCancel}>Cancelar</PrimaryButton>
        <PrimaryButton variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</PrimaryButton>
      </div>
    </Modal>
  )
}
