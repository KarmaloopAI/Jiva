import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Cloud, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { logoUrl } from '../../lib/logo'
import { useAuthStore } from '../../store/auth.store'

interface Props {
  onSuccess: () => void
  onBack: () => void
}

export function CloudSignIn({ onSuccess, onBack }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { isLoading, error, signIn, signUp, clearError } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        await signUp(email, password)
      }
      onSuccess()
    } catch {
      // error is set in the store
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="aurora-bg" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative z-10 w-full max-w-sm px-4"
      >
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-[var(--text-subtle)] hover:text-[var(--text-muted)] transition-colors mb-6"
        >
          <ArrowLeft size={13} />
          Back to local setup
        </button>

        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(59,130,246,0.12))' }}
          >
            <img src={logoUrl} alt="Jivam" className="w-9 h-9 object-contain" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold gradient-text">
              {mode === 'signin' ? 'Sign in to Jivam Cloud' : 'Create your account'}
            </h1>
            <p className="text-xs text-[var(--text-subtle)] mt-1 flex items-center justify-center gap-1.5">
              <Cloud size={11} />
              Powered by Jiva Cloud — no local install needed
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-muted)]">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[rgba(139,92,246,0.5)] focus:ring-1 focus:ring-[rgba(139,92,246,0.2)] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-muted)]">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[rgba(139,92,246,0.5)] focus:ring-1 focus:ring-[rgba(139,92,246,0.2)] transition-colors"
            />
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-400/8 px-3 py-2.5 text-xs text-red-400"
            >
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full mt-1"
            disabled={isLoading}
          >
            {isLoading
              ? <><Loader2 size={14} className="animate-spin" /> {mode === 'signin' ? 'Signing in…' : 'Creating account…'}</>
              : mode === 'signin' ? 'Sign In' : 'Create Account'
            }
          </Button>
        </form>

        {/* Toggle mode */}
        <p className="mt-5 text-center text-xs text-[var(--text-subtle)]">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); clearError() }}
            className="text-[var(--accent)] hover:underline font-medium"
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>

        {/* Limitations note */}
        <p className="mt-4 text-center text-[10px] text-[var(--text-subtle)] leading-relaxed">
          Cloud mode provides chat only. Code Agent requires a local install.
        </p>
      </motion.div>
    </div>
  )
}
