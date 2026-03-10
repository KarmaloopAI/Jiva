import { clsx } from 'clsx'
import { forwardRef } from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  children: React.ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex items-center justify-center font-medium transition-all duration-150 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 disabled:opacity-50 disabled:cursor-not-allowed no-drag',
          {
            // Primary
            'bg-gradient-to-r from-jivam-purple to-jivam-blue text-white hover:opacity-90 shadow-sm':
              variant === 'primary',
            // Secondary
            'glass-card text-[var(--text)] hover:border-purple-300 dark:hover:border-purple-600':
              variant === 'secondary',
            // Ghost
            'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-purple-50 dark:hover:bg-purple-900/20':
              variant === 'ghost',
            // Icon
            'text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-full':
              variant === 'icon',
            // Sizes
            'px-2 py-1 text-xs gap-1': size === 'sm',
            'px-4 py-2 text-sm gap-1.5': size === 'md',
            'px-5 py-2.5 text-base gap-2': size === 'lg',
            'p-2': variant === 'icon' && size === 'md',
            'p-1.5': variant === 'icon' && size === 'sm',
          },
          className
        )}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
