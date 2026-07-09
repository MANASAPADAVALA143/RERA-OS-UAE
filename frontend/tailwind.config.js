/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1E1B4B',
        accent: {
          DEFAULT: '#6366F1',
          light:   '#818CF8',
          dark:    '#4F46E5',
        },
        surface: '#F8FAFC',
        cream:   '#EEF2FF',
        charcoal: '#334155',
        navy: {
          900: '#0F172A',
          800: '#1E1B4B',
          700: '#312E81',
          600: '#3730A3',
          500: '#4338CA',
          400: '#6366F1',
          300: '#818CF8',
          200: '#A5B4FC',
          100: '#C7D2FE',
        },
        demo: {
          purple: '#7C3AED',
          teal: '#14B8A6',
        },
      },
    },
  },
  plugins: [],
};
