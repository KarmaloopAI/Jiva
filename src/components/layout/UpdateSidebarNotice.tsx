import { ArrowRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUpdaterStore } from '../../store/updater.store'
import { logoUrl } from '../../lib/logo'

// Deliberately not dismissable — an update sitting available is something
// the user should always be able to see and act on, not something that can
// be swiped away and forgotten. Sits pinned to the bottom of the sidebar,
// overlaying the conversation list rather than pushing it up, so it stays
// out of the way of the actual list while never fully disappearing.
export function UpdateSidebarNotice() {
  const { phase, latestVersion, openModal } = useUpdaterStore()

  return (
    <AnimatePresence>
      {phase === 'available' && (
        <motion.button
          key="update-sidebar-notice"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          onClick={openModal}
          className="absolute left-2.5 right-2.5 bottom-2.5 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors hover:brightness-105"
          style={{
            background: 'var(--card)',
            border: '1px solid rgba(139,92,246,0.3)',
            boxShadow: 'var(--card-shadow)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.12))' }}
          >
            <img src={logoUrl} alt="" className="w-4 h-4 object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
              Relaunch to update
            </p>
            <p className="text-[10px] truncate" style={{ color: 'var(--text-subtle)' }}>
              v{latestVersion}
            </p>
          </div>
          <ArrowRight size={13} className="flex-shrink-0" style={{ color: 'var(--text-subtle)' }} />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
