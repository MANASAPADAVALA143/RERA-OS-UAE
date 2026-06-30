/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#161310',
        accent: {
          DEFAULT: '#D4AF37',
          light:   '#FAC775',
          dark:    '#B8962E',
        },
        surface: '#F7F5F0',
        cream:   '#ECE9E3',
        charcoal: '#44403C',
        // warm stone scale (sidebar tones)
        navy: {
          900: '#0C0A09',
          800: '#161310',
          700: '#1C1917',
          600: '#2A2520',
          500: '#44403C',
          400: '#57534E',
          300: '#78716C',
          200: '#A8A29E',
          100: '#D6D3D1',
        },
      },
    },
  },
  plugins: [],
};
