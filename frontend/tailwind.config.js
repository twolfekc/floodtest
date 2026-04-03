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
    },
  },
  plugins: [],
}
