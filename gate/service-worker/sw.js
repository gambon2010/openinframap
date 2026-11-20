// Fork: the gate's answer for /sw.js, in both of its ways (gate/nginx.conf). The
// page built by upstream's Vite config installs a service worker that answers every
// page visit from its own copy: it would skip the gate's login check (/login itself
// gets the map's page) and keep showing an old build after a switch back to Vite's
// dev server. A browser that has it fetches this file on its next visit (browsers
// check a worker's script for updates on every visit) and this worker removes
// itself: the copy deleted, the worker unregistered, open tabs loaded again from
// the gate. Only the worker's caches go (the app keeps nothing else there); the
// page's settings (localStorage) stay. Pattern: vite-plugin-pwa's `selfDestroying`.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(removeThisWorker())
})

async function removeThisWorker() {
  for (const name of await caches.keys()) {
    await caches.delete(name)
  }
  await self.registration.unregister()
  for (const tab of await self.clients.matchAll({ type: 'window' })) {
    tab.navigate(tab.url)
  }
}
