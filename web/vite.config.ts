/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import { configDefaults } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'
import { renderSVG } from 'vite-plugin-render-svg'
import i18nextLoader from 'vite-plugin-i18next-loader'

// Fork: the dev server (http://localhost:5173, this computer only) passes on what the
// gate passes on (gate/nginx.conf; scripts/tests/test_one_source.py checks they
// agree): the page sends the local services to its own address (src/fork/config.ts).
// The Host is kept (no changeOrigin): the backend's login redirects come back here.
const env = loadEnv('development', process.cwd(), '')
const backendUrl = env.VITE_BACKEND_BASE_URL || 'http://localhost:8001'
const tegolaUrl = env.VITE_TEGOLA_URL || 'http://localhost:7800'
const BACKEND_PATHS =
  '^/(login|auth|userdata|api|grid|background|terrain|imagery|satellite|search|stats|about|copyright|static|local-images|wikidata|sitemap\\.xml|heatmap\\.json)(/|$|\\?)'

export default defineConfig({
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
      '/tegola/': { target: tegolaUrl, rewrite: (path) => path.replace(/^\/tegola/, '') },
      [BACKEND_PATHS]: { target: backendUrl }
    }
  },

  plugins: [
    renderSVG({
      pattern: 'src/icons/*.svg',
      urlPrefix: 'icons/',
      outputOriginal: true
    }),
    i18nextLoader({ paths: ['./locales'], namespaceResolution: 'relativePath' }),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Fork: My layers' symbol (3 MB) and graphics (7.4 MB) libraries are cached too, for offline use.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [
          /^\/stats/,
          /^\/map/,
          /^\/fonts/,
          /^\/static/,
          /^\/about/,
          /^\/copyright/,
          /^\/local-images/,
          /^\/wikidata/,
          /^\/search/,
          /^\/api/,
          /^\/userdata/
        ]
      },
      manifest: {
        name: 'Open Infrastructure Map',
        short_name: 'OpenInfraMap',
        description:
          "Open map of the world's electricity, telecoms, oil, and gas infrastructure, using data from OpenStreetMap.",
        theme_color: '#ffffff',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],

  test: {
    // Fork: the fork's unit tests run with vitest.fork.config.ts (npm run test:fork).
    exclude: [...configDefaults.exclude, 'src/fork/**'],
    environment: 'puppeteer',
    globalSetup: 'vitest-environment-puppeteer/global-init',
    globals: true
  }
})
