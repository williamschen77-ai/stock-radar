import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Capacitor loads bundled files from the app bundle, not from the web root.
  // Keep Vercel's root-absolute asset URLs in production but use relative
  // paths for the native build.
  base: process.env.CAPACITOR_BUILD ? './' : '/',
  plugins: [react()],
})
