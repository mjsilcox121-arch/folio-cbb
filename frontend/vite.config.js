import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// On GitHub Pages we live at https://<user>.github.io/<repo>/, so all asset
// URLs need to be prefixed with `/<repo>/`. The deploy workflow injects the
// repo name as VITE_BASE_PATH; locally `npm run dev` falls back to `/`.
const base = process.env.VITE_BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base,
})
