const DEFAULT_BACKEND_URL = 'https://openinframap.org'
const DEFAULT_TILES_URL = 'https://openinframap.org'

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

function readEnvValue(envKey: string): string | undefined {
  if (typeof import.meta === 'undefined' || !import.meta.env) {
    return undefined
  }

  const candidate = import.meta.env[envKey]
  return candidate === undefined ? undefined : String(candidate)
}

function resolveEnvUrl(envKey: string, fallback: string): string {
  const candidate = readEnvValue(envKey)
  return candidate ?? fallback
}

function resolveEnvFlag(envKey: string, fallback: boolean): boolean {
  const rawValue = readEnvValue(envKey)
  if (rawValue === undefined) {
    return fallback
  }

  const normalized = rawValue.trim().toLowerCase()
  if (normalized === '') {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

const rawBackendUrl = resolveEnvUrl('VITE_BACKEND_URL', DEFAULT_BACKEND_URL)
const rawTilesUrl = resolveEnvUrl('VITE_TILES_URL', DEFAULT_TILES_URL)
const useLocalTileRouter = resolveEnvFlag('VITE_TILES_LOCAL_ROUTER', false)

export const backendBaseUrl = normalizeBaseUrl(rawBackendUrl)
export const tilesBaseUrl = normalizeBaseUrl(rawTilesUrl)

export function buildBackendUrl(path: string): string {
  if (!path.startsWith('/')) {
    return `${backendBaseUrl}/${path}`
  }
  return `${backendBaseUrl}${path}`
}

export function buildTilesUrl(path: string): string {
  let effectivePath = path

  if (useLocalTileRouter) {
    if (path.startsWith('/map/')) {
      effectivePath = `/maps${path.slice(4)}`
    } else {
      const versionMatch = path.match(/^\/(\d{8})(\/.*)$/)
      if (versionMatch) {
        effectivePath = `/maps/openinframap${versionMatch[2]}`
      }
    }
  }

  if (!effectivePath.startsWith('/')) {
    return `${tilesBaseUrl}/${effectivePath}`
  }

  return `${tilesBaseUrl}${effectivePath}`
}
