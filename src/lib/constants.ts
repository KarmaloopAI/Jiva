export const JIVA_DEFAULT_PORT = 8765
export const JIVA_WS_TOKEN = 'jivam-local-dev'

export const COLORS = {
  purple: '#8B5CF6',
  blue: '#3B82F6',
  indigo: '#6366F1',
  purpleLight: '#A78BFA',
  purpleDark: '#7C3AED',
}

export const THINKING_PHASES = [
  { maxMs: 3000, message: 'Starting up...' },
  { maxMs: 15000, message: 'Planning your request...' },
  { maxMs: 60000, message: 'Working on it...' },
  { maxMs: Infinity, message: 'Still working...' },
]

export const BUILT_IN_PERSONA_NAMES = ['chat', 'research']
