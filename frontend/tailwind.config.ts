/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        'card-play': 'cardPlay 0.6s ease-out forwards',
        'card-draw': 'cardDraw 0.6s ease-out forwards',
        'deal-card': 'dealCard 0.8s ease-out forwards'
      },
      keyframes: {
        cardPlay: {
          '0%': { transform: 'translateY(0) scale(1)', opacity: '1' },
          '100%': { transform: 'translateY(-200px) scale(0.8)', opacity: '0' }
        },
        cardDraw: {
          '0%': { transform: 'translateY(-200px) scale(0.8)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' }
        },
        dealCard: {
          '0%': { transform: 'translateY(-100vh) rotate(180deg)', opacity: '0' },
          '100%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' }
        }
      }
    },
  },
  plugins: [],
}