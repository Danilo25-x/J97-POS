import Modal from './Modal'
import { useImageSrc } from '../../data/useImageUrl'

export default function ProductImageViewer({ src: rawSrc, name = 'Producto', onClose }) {
  const src = useImageSrc(rawSrc)
  if (!rawSrc) return null

  return (
    <Modal isOpen onClose={onClose} title={name} width={920}>
      <div className="product-image-viewer">
        {src ? <img src={src} alt={`Imagen de ${name}`} /> : null}
      </div>
    </Modal>
  )
}
