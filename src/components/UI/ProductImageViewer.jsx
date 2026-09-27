import Modal from './Modal'

export default function ProductImageViewer({ src, name = 'Producto', onClose }) {
  if (!src) return null

  return (
    <Modal isOpen onClose={onClose} title={name} width={920}>
      <div className="product-image-viewer">
        <img src={src} alt={`Imagen de ${name}`} />
      </div>
    </Modal>
  )
}
