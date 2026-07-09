/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#0B1437',
        accent: {
          DEFAULT: '#5B5FEF',
          light:   '#EEF0FF',
          dark:    '#4F46E5',
        },
        surface: '#F7F8FA',
        cream:   '#F7F8FA',
        charcoal: '#1A1D29',
        navy: {
          900: '#0B1437',
          800: '#0F1A42',
          700: '#1A1D29',
          600: '#2D3142',
          500: '#5B5FEF',
          400: '#7C83F6',
          300: '#A5B4FC',
          200: '#C7D2FE',
          100: '#EEF0FF',
        },
        fcc: {
          page: '#F7F8FA',
          card: '#FFFFFF',
          border: '#E8E9ED',
          muted: '#8B8D98',
        },
      },
    },
  },
  plugins: [],
};
