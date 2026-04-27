export const TILE_BASE_URL: string =
  import.meta.env.VITE_TILE_BASE_URL ?? 'https://openinframap.org'

export const BACKEND_BASE_URL: string =
  import.meta.env.VITE_BACKEND_BASE_URL ?? 'https://openinframap.org'

// When VITE_TEGOLA_URL is set the Vite dev server proxies /map/* requests
// to local Tegola (rewriting /map/ → /maps/ to match Tegola's URL scheme).
// Using an empty string makes tile URLs relative so they pass through that
// proxy. Basemap and blackmarble are NOT served by Tegola so they keep using
// TILE_BASE_URL regardless.
export const OIM_TILE_BASE_URL: string =
  import.meta.env.VITE_TEGOLA_URL ? '' : TILE_BASE_URL
