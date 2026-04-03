/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        forge: {
          base: '#09090b',
          surface: '#18181b',
          raised: '#27272a',
          inset: '#0f0f11',
          border: '#27272a',
          'border-subtle': '#1e1e22',
          'border-strong': '#3f3f46',
        },
      },
      fontFamily: {
        sans: ['"Geist Variable"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"Geist Mono Variable"', '"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out both',
        'fade-in-up': 'fade-in-up 0.5s ease-out both',
        'slide-in-left': 'slide-in-left 0.3s ease-out both',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'breathe': 'breathe 3s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        'gradient-shift': 'gradient-shift 4s ease infinite',
      },
    },
  },
  plugins: [],
}
