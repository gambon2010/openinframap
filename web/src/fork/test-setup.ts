// Fork: unit test setup (vitest.fork.config.ts). Translations return their English
// defaults, as when no other language is loaded.
import i18next from 'i18next'

await i18next.init({ lng: 'en', resources: {}, showSupportNotice: false } as Parameters<
  typeof i18next.init
>[0])
