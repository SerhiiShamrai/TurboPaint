import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' — відносні шляхи до файлів, щоб сайт працював на GitHub Pages
// у підпапці (https://<користувач>.github.io/TurboPaint/), а не лише в корені.
export default defineConfig({
  plugins: [react()],
  base: './',
})
