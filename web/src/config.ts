export const TILE_BASE_URL: string = import.meta.env.VITE_TILE_BASE_URL ?? 'https://openinframap.org'

// Basemap (roads, buildings, water, labels) vector tiles in the Protomaps
// schema. Defaults to openinframap.org; set VITE_BASEMAP_URL to use your own
// tile server, e.g. `pmtiles serve` or a Martin instance. The "Map sources"
// panel (src/map-sources/) can override it for the current browser tab.
export const DEFAULT_BASEMAP_URL = `${TILE_BASE_URL}/20250311/{z}/{x}/{y}.mvt`
export const CONFIGURED_BASEMAP_URL: string = import.meta.env.VITE_BASEMAP_URL || DEFAULT_BASEMAP_URL

export const BASEMAP_SESSION_KEY = 'oim-basemap-url'

// Optional Photon geocoder (https://github.com/komoot/photon) for searching
// addresses and places beyond the local database, e.g. http://localhost:2322.
// Empty = not used. Setting up Photon isn't handled by the scripts.
export const CONFIGURED_PHOTON_URL: string = import.meta.env.VITE_PHOTON_URL || ''
export const PHOTON_SESSION_KEY = 'oim-photon-url'

// Per-tab overrides from the Map sources panel. Session storage lasts until the
// tab is closed. It can be unavailable (privacy settings), so every access is
// guarded. A null value means "no override".
export function getSessionUrl(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

export function setSessionUrl(key: string, url: string | null) {
  try {
    if (url === null) {
      sessionStorage.removeItem(key)
    } else {
      sessionStorage.setItem(key, url)
    }
  } catch {
    // Not persisted; the change still applies until the page is reloaded.
  }
}

export const BASEMAP_URL: string = getSessionUrl(BASEMAP_SESSION_KEY) || CONFIGURED_BASEMAP_URL

/** The Photon URL in use right now ('' = none); read on every search so changes apply live. */
export function getPhotonUrl(): string {
  return getSessionUrl(PHOTON_SESSION_KEY) ?? CONFIGURED_PHOTON_URL
}

export const BACKEND_BASE_URL: string = import.meta.env.VITE_BACKEND_BASE_URL ?? 'https://openinframap.org'

// Full URL prefix for OIM infrastructure tile layers (power, petroleum, etc.).
// Production nginx serves these at /map/*; local Tegola serves them at /maps/*.
// When VITE_TEGOLA_URL is set we point directly at Tegola — Tegola returns
// Access-Control-Allow-Origin: * so cross-origin tile fetches work fine.
export const OIM_TILES: string = import.meta.env.VITE_TEGOLA_URL
  ? `${import.meta.env.VITE_TEGOLA_URL}/maps`
  : `${TILE_BASE_URL}/map`
