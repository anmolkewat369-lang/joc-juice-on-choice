import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { jocApiDevServer } from './dev/jocApiDevServer.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), jocApiDevServer()],
})
