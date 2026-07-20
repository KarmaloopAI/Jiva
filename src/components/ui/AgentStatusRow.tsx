import { Zap } from 'lucide-react'

const MODEL_CHIP_MAX_LEN = 22

// Provider-qualified model names ("qwen/qwen3.6-27b") are too long for a
// status chip — show just the model itself, truncated if it's still long.
function shortModelName(model: string): string {
  const short = model.includes('/') ? (model.split('/').pop() || model) : model
  return short.length > MODEL_CHIP_MAX_LEN ? `${short.slice(0, MODEL_CHIP_MAX_LEN - 1)}…` : short
}

function maxIterationsLabel(n: number): string {
  return n === 10 ? 'Quick' : n === 100 ? 'Long' : 'Medium'
}

// The two halves of the model/iterations chip interlock along a diagonal
// seam via matching clip-paths (left cut short at the bottom, right cut
// short at the top) rather than a straight vertical divider, per design.
const CHIP_SLANT_PX = 7
const chipLeftClip = `polygon(0 0, 100% 0, calc(100% - ${CHIP_SLANT_PX}px) 100%, 0 100%)`
const chipRightClip = `polygon(${CHIP_SLANT_PX}px 0, 100% 0, 100% 100%, 0 100%)`
// Same purple as the Deep Run chip's text (var(--accent)) — used for the
// model/iterations chip's dark half and its border, in place of plain black.
const CHIP_DARK_PURPLE = 'var(--accent)'

interface AgentStatusRowProps {
  disclaimer: string
  deepRun: boolean
  model: string | null
  maxIterations: number
  onOpenSettings: () => void
}

// Shared by chat mode (ChatInput.tsx) and code mode (CodeChatView.tsx) —
// both surfaces show the same three things below their input (a disclaimer,
// whether Deep Run is on, and the active model/max-iterations), so this is
// one implementation rather than two copies that can drift apart.
export function AgentStatusRow({ disclaimer, deepRun, model, maxIterations, onOpenSettings }: AgentStatusRowProps) {
  return (
    <div className="status-row-shrink flex items-center justify-between gap-3 mt-2">
      <p className="status-row-disclaimer text-[10px] text-[var(--text-subtle)] flex-1 min-w-0 truncate">{disclaimer}</p>

      {(deepRun || model) && (
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 flex-shrink-0"
        >
          {deepRun && (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              <Zap size={9} />
              Deep Run
            </span>
          )}
          {model && (
            <div
              className="inline-flex items-stretch rounded-full overflow-hidden text-[10px] font-medium"
              style={{ border: `1px solid ${CHIP_DARK_PURPLE}` }}
            >
              <span
                title={model}
                className="flex items-center pl-2.5 pr-3.5 py-0.5"
                style={{ background: CHIP_DARK_PURPLE, color: 'rgba(255,255,255,0.92)', clipPath: chipLeftClip }}
              >
                {shortModelName(model)}
              </span>
              <span
                className="flex items-center pl-3.5 pr-2.5 py-0.5"
                style={{ background: '#f4f4f5', color: CHIP_DARK_PURPLE, marginLeft: `-${CHIP_SLANT_PX}px`, clipPath: chipRightClip }}
              >
                {maxIterationsLabel(maxIterations)}
              </span>
            </div>
          )}
        </button>
      )}
    </div>
  )
}
