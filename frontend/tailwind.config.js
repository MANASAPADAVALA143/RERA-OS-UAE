/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0E3B36',
          light: '#1A5249',
          dark: '#082822',
        },
        accent: {
          DEFAULT: '#2F8F7A',
          light: '#4BA892',
          dark: '#1F6B5A',
        },
        surface: '#F4F7F6',
        charcoal: '#1C2422',
      },
    },
  },
  plugins: [],
};
