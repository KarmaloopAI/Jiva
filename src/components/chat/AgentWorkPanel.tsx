import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Wrench, ListOrdered, Repeat } from 'lucide-react'
import { Badge } from '../ui/Badge'
import type { AgentWork } from '../../types/jiva'

interface AgentWorkPanelProps {
  work: AgentWork
  isExpanded: boolean
}

export function AgentWorkPanel({ work, isExpanded }: AgentWorkPanelProps) {
  const { plan, toolsUsed, iterations, durationMs } = work
  const uniqueTools = [...new Set(toolsUsed ?? [])]

  return (
    <AnimatePresence>
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="overflow-hidden"
        >
          <div
            className="mt-3 rounded-xl p-4 space-y-4 text-sm"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--card-border)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide">
                Jivam's Work
              </span>
              <div className="flex items-center gap-3 text-xs text-[var(--text-subtle)]">
                {iterations != null && (
                  <span className="flex items-center gap-1">
                    <Repeat size={11} />
                    {iterations} iteration{iterations !== 1 ? 's' : ''}
                  </span>
                )}
                {durationMs != null && (
                  <span>{(durationMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            </div>

            {/* Plan / Subtasks */}
            {plan?.subtasks && plan.subtasks.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-[var(--text-muted)]">
                  <ListOrdered size={13} />
                  <span>Plan</span>
                </div>
                <ol className="space-y-1.5">
                  {plan.subtasks.map((task, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium mt-0.5"
                        style={{
                          background: 'rgba(139, 92, 246, 0.12)',
                          color: 'var(--accent)',
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-[var(--text-muted)] leading-relaxed">{task}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Tools Used */}
            {uniqueTools.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-[var(--text-muted)]">
                  <Wrench size={13} />
                  <span>Tools Used</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {uniqueTools.map((tool) => (
                    <Badge key={tool} variant="tool">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Validation */}
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <CheckCircle size={13} />
              <span>Validated by Client Agent</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
