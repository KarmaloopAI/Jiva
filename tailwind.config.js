/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        jivam: {
          purple: '#8B5CF6',
          blue: '#3B82F6',
          indigo: '#6366F1',
          'purple-light': '#A78BFA',
          'purple-dark': '#7C3AED',
          // Light mode
          'bg-light': '#F5F3FF',
          'bg-light-secondary': '#EDE9FE',
          'card-light': '#FFFFFF',
          'border-light': '#DDD6FE',
          'text-light': '#1E1B4B',
          'text-muted-light': '#6B7280',
          // Dark mode
          'bg-dark': '#0A0A0B',
          'bg-dark-secondary': '#111113',
          'card-dark': '#1C1C21',
          'border-dark': '#2D2B4E',
          'text-dark': '#F5F3FF',
          'text-muted-dark': '#9CA3AF',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'aurora': 'aurora 20s ease-in-out infinite',
        'typing': 'typing 1.4s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        aurora: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(30px, -30px) scale(1.05)' },
          '66%': { transform: 'translate(-20px, 20px) scale(0.95)' },
        },
        typing: {
          '0%, 60%, 100%': { transform: 'translateY(0)' },
          '30%': { transform: 'translateY(-6px)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        }
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}
