import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { copyFileSync } from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isWeb = mode === 'web'

  return {
    plugins: [
      react(),
      !isWeb && electron([
        {
          entry: 'electron/main.ts',
        },
        {
          entry: 'electron/preload.cjs',
          onstart(options) {
            // Copy the CJS preload to dist-electron
            copyFileSync(
              path.resolve('electron/preload.cjs'),
              path.resolve('dist-electron/preload.cjs')
            )
            options.reload()
          },
        },
      ]),
    ].filter(Boolean),
  }
})


