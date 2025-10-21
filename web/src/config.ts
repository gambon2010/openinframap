const DEFAULT_BACKEND_URL = 'https://openinframap.org'

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

const rawBackendUrl = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL
  : DEFAULT_BACKEND_URL

export const backendBaseUrl = normalizeBaseUrl(rawBackendUrl)

export function buildBackendUrl(path: string): string {
  if (!path.startsWith('/')) {
    return `${backendBaseUrl}/${path}`
  }
  return `${backendBaseUrl}${path}`
}
