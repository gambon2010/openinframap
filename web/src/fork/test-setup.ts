// Fork: unit test setup (vitest.fork.config.ts). Translations return their English
// defaults, as when no other language is loaded.
import i18next from 'i18next'

await i18next.init({ lng: 'en', resources: {}, showSupportNotice: false } as Parameters<
  typeof i18next.init
>[0])

// No network in tests: a test that needs an answer stubs fetch itself
// (vi.stubGlobal('fetch', ...)). Otherwise the simulated browser really connects
// (to localhost:3000, its address) and the test depends on what's there.
globalThis.fetch = (input: RequestInfo | URL) =>
  Promise.reject(new Error(`No network in tests: stub fetch for ${String(input)}`))
