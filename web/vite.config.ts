/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import { renderSVG } from 'vite-plugin-render-svg'
import i18nextLoader from 'vite-plugin-i18next-loader'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

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
      // When VITE_TEGOLA_URL is set, proxy /map/* to local Tegola.
      // Tegola serves maps at /maps/* (plural), so the path is rewritten.
      ...(env.VITE_TEGOLA_URL
        ? {
            proxy: {
              '/map': {
                target: env.VITE_TEGOLA_URL,
                rewrite: (path: string) => path.replace(/^\/map\//, '/maps/'),
                changeOrigin: true
              }
            }
          }
        : {})
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
