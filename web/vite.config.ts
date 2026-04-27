/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import { renderSVG } from 'vite-plugin-render-svg'
import i18nextLoader from 'vite-plugin-i18next-loader'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_BACKEND_BASE_URL || 'https://openinframap.org'

  return {
    build: {
      target: 'es2022',
      outDir: './dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules/maplibre-gl')) {
              return 'maplibre'
            }
          }
        }
      }
    },

    server: {
      fs: {
        // Allow serving files from one level up to the project root
        allow: ['..']
      },
      proxy: {
        '/stats': { target: backendUrl, changeOrigin: true },
        '/about': { target: backendUrl, changeOrigin: true },
        '/static': { target: backendUrl, changeOrigin: true },
        '/local-images': { target: backendUrl, changeOrigin: true }
      }
    },

    plugins: [
      renderSVG({
        pattern: 'src/icons/*.svg',
        urlPrefix: 'icons/',
        outputOriginal: true
      }),
      i18nextLoader({ paths: ['./locales'], namespaceResolution: 'relativePath' })
    ],

    test: {
      environment: 'puppeteer',
      globalSetup: 'vitest-environment-puppeteer/global-init',
      globals: true
    }
  }
})
