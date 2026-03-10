import { motion, AnimatePresence } from 'framer-motion'
import { X, ExternalLink } from 'lucide-react'
import { PersonaCard } from './PersonaCard'
import { usePersonaStore } from '../../store/persona.store'
import { useChatStore } from '../../store/chat.store'
import { Spinner } from '../ui/Spinner'

interface PersonaSidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function PersonaSidebar({ isOpen, onClose }: PersonaSidebarProps) {
  const { personas, activePersonaName, switchPersona, isSwitching, isLoading } = usePersonaStore()
  const { setActivePersona } = useChatStore()

  const handleSelect = async (name: string) => {
    if (name === activePersonaName) return
    await switchPersona(name)
    setActivePersona(name)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-black/20 dark:bg-black/40"
            onClick={onClose}
          />

          {/* Sidebar */}
          <motion.div
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute left-0 top-0 bottom-0 z-30 w-72 flex flex-col shadow-2xl"
            style={{
              background: 'var(--sidebar-bg)',
              borderRight: '1px solid var(--card-border)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-4 border-b"
              style={{ borderColor: 'var(--card-border)' }}
            >
              <h2 className="font-semibold text-[var(--text)] text-sm">Personas</h2>
              <button
                onClick={onClose}
                className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Personas List */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
              {isSwitching && (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-muted)]">
                  <Spinner size="sm" />
                  <span>Switching persona...</span>
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner />
                </div>
              ) : personas.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-[var(--text-muted)]">No personas found</p>
                  <p className="text-xs text-[var(--text-subtle)] mt-1">
                    Add personas to ~/.jiva/personas/
                  </p>
                </div>
              ) : (
                personas.map((persona) => (
                  <PersonaCard
                    key={persona.name}
                    persona={persona}
                    isActive={persona.name === activePersonaName}
                    onSelect={handleSelect}
                  />
                ))
              )}
            </div>

            {/* Footer */}
            <div
              className="px-4 py-3 border-t"
              style={{ borderColor: 'var(--card-border)' }}
            >
              <a
                href="https://github.com/KarmaloopAI/Jiva/blob/main/docs/personas.md"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
              >
                <ExternalLink size={12} />
                Build your own persona
              </a>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
