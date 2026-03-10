import { clsx } from 'clsx'
import { Badge } from '../ui/Badge'
import type { ActiveTab } from '../../App'

interface NavTabProps {
  id: ActiveTab
  label: string
  isActive: boolean
  comingSoon?: boolean
  onClick: (id: ActiveTab) => void
}

export function NavTab({ id, label, isActive, comingSoon, onClick }: NavTabProps) {
  return (
    <button
      onClick={() => !comingSoon && onClick(id)}
      disabled={comingSoon}
      className={clsx(
        'no-drag relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200',
        {
          'text-[var(--accent)] bg-purple-100/60 dark:bg-purple-900/30': isActive,
          'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-purple-50/50 dark:hover:bg-purple-900/10':
            !isActive && !comingSoon,
          'text-[var(--text-subtle)] cursor-default': comingSoon,
        }
      )}
    >
      {label}
      {comingSoon && (
        <Badge variant="coming-soon" className="text-[10px] py-0 px-1.5">
          Soon
        </Badge>
      )}
      {isActive && (
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-[var(--accent)] rounded-full" />
      )}
    </button>
  )
}
