import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'coming-soon' | 'tool' | 'success' | 'warning'
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        {
          'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300':
            variant === 'default',
          'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600':
            variant === 'coming-soon',
          'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-100 dark:border-blue-800':
            variant === 'tool',
          'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300':
            variant === 'success',
          'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300':
            variant === 'warning',
        },
        className
      )}
    >
      {children}
    </span>
  )
}
