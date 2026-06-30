/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0A0F2C',
          light: '#151B3D',
          dark: '#060A1F',
        },
        accent: {
          DEFAULT: '#3B82F6',
          light: '#60A5FA',
          dark: '#1D4ED8',
        },
        surface: '#0B1437',
        charcoal: '#F1F5F9',
        navy: {
          900: '#060A1F',
          800: '#0A0F2C',
          700: '#0B1437',
          600: '#0F1830',
          500: '#151B3D',
          400: '#1A2456',
          300: '#2A3158',
          200: '#3A4170',
          100: '#4A5180',
        },
      },
    },
  },
  plugins: [],
};
