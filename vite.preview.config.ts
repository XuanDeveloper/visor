import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serve só o renderer no navegador, fora do Electron, para trabalhar no
 * visual com o harness de dados falsos (ver src/renderer/lib/mockApi.ts).
 *
 *   npx vite --config vite.preview.config.ts
 *
 * Não participa do build do app — `electron.vite.config.ts` é a fonte da verdade.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer')
    }
  },
  server: { port: 5188, strictPort: true }
})
