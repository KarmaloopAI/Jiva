import { useCallback } from 'react'

interface ResizeHandleProps {
  onResize: (delta: number) => void
  className?: string
}

/**
 * A thin vertical drag-to-resize handle.
 * Fires onResize(deltaPx) on each mousemove while dragging.
 */
export function ResizeHandle({ onResize, className = '' }: ResizeHandleProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX

      const onMouseMove = (ev: MouseEvent) => {
        onResize(ev.clientX - startX)
      }

      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [onResize]
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`flex-shrink-0 relative group cursor-col-resize ${className}`}
      style={{ width: '5px' }}
    >
      {/* Visible line — subtle, brightens on hover */}
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-opacity duration-150 group-hover:opacity-100"
        style={{
          width: '1px',
          background: 'var(--card-border)',
          opacity: 0.6,
        }}
      />
    </div>
  )
}
