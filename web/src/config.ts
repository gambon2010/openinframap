const DEFAULT_BACKEND_URL = 'https://openinframap.org'
const DEFAULT_TILES_URL = 'https://openinframap.org'

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

function resolveEnvUrl(envKey: string, fallback: string): string {
  if (typeof import.meta === 'undefined' || !import.meta.env) {
    return fallback
  }

  const candidate = import.meta.env[envKey]
  return candidate ? String(candidate) : fallback
}

const rawBackendUrl = resolveEnvUrl('VITE_BACKEND_URL', DEFAULT_BACKEND_URL)
const rawTilesUrl = resolveEnvUrl('VITE_TILES_URL', DEFAULT_TILES_URL)

export const backendBaseUrl = normalizeBaseUrl(rawBackendUrl)
export const tilesBaseUrl = normalizeBaseUrl(rawTilesUrl)

export function buildBackendUrl(path: string): string {
  if (!path.startsWith('/')) {
    return `${backendBaseUrl}/${path}`
  }
  return `${backendBaseUrl}${path}`
}

export function buildTilesUrl(path: string): string {
  if (!path.startsWith('/')) {
    return `${tilesBaseUrl}/${path}`
  }
  return `${tilesBaseUrl}${path}`
}
