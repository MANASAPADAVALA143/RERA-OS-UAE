/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1C1917',
          light: '#292524',
          dark: '#0C0A09',
        },
        accent: {
          DEFAULT: '#F59E0B',
          light: '#FCD34D',
          dark: '#D97706',
        },
        surface: '#292524',
        charcoal: '#F5F5F4',
        navy: {
          900: '#0C0A09',
          800: '#1C1917',
          700: '#292524',
          600: '#44403C',
          500: '#57534E',
          400: '#78716C',
          300: '#A8A29E',
          200: '#D6D3D1',
          100: '#F5F5F4',
        },
      },
    },
  },
  plugins: [],
};
