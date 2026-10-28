// Fork: "My layers" backend calls (web-backend/src/fork/userdata.py). Relative
// URLs: the dev server proxies /userdata to the backend (vite.config.ts), which
// keeps the requests same-origin (the backend only allows GET across origins).
import { Change, SavedChange, UserFeature } from './model.ts'

const BASE = '/userdata'

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    // The backend's errors are plain text ("That layer doesn't exist (any more)").
    const detail = (await response.text().catch(() => '')) || response.statusText
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export interface LoadedLayer {
  id: string
  name: string
  style: { color?: string }
  features: UserFeature[]
}

export async function loadAll(): Promise<{ last_save: number | null; layers: LoadedLayer[] }> {
  return json(await fetch(BASE))
}

export async function saveChanges(changes: Change[], author?: string): Promise<{ save_id: number }> {
  return json(
    await fetch(`${BASE}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes, author: author || null })
    })
  )
}

export async function loadHistory(): Promise<SavedChange[]> {
  return (await json<{ changes: SavedChange[] }>(await fetch(`${BASE}/history`))).changes
}

export async function uploadImage(name: string, mime: string, base64: string): Promise<string> {
  const result = await json<{ id: string }>(
    await fetch(`${BASE}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mime, data: base64 })
    })
  )
  return result.id
}

export function imageUrl(id: string): string {
  return `${BASE}/images/${id}`
}

/** The full geometry of a map feature (tiles have it cut and simplified). */
export async function sourceGeometry(layer: string, id: number): Promise<GeoJSON.Geometry | null> {
  const response = await fetch(`${BASE}/source-feature?${new URLSearchParams({ layer, id: String(id) })}`)
  if (!response.ok) return null
  return (await response.json()).geometry
}
