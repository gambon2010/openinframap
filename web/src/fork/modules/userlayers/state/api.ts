// Fork: "My layers" backend calls (web-backend/src/fork/userdata/). Relative
// URLs: the dev server proxies /userdata to the backend (vite.config.ts), which
// keeps the requests same-origin (the backend only allows GET across origins).
import { Change, LayerAccess, SavedChange, UserFeature } from '../model/model.ts'

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
  access: LayerAccess
  owner: string | null
  version: number
  updated_by: string | null
  updated_at: string
  /** With their version, updated_by and updated_at too. */
  features: UserFeature[]
}

export async function loadAll(): Promise<{ last_save: number | null; layers: LoadedLayer[] }> {
  return json(await fetch(BASE))
}

/** Save was refused: someone else saved some of these items meanwhile. */
export class StaleError extends Error {
  constructor(readonly items: string[]) {
    super('Changed by someone else meanwhile')
  }
}

/** Send changes with the versions they started from (bases: "feature:<id>" -> version). */
export async function saveChanges(
  changes: Change[],
  bases: Record<string, number>,
  author?: string
): Promise<{ save_id: number }> {
  const response = await fetch(`${BASE}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes, bases, author: author || null })
  })
  if (response.status === 409) throw new StaleError((await response.json()).conflicts ?? [])
  return json(response)
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

/** A named moment: the layers as they were after a saved change (userdata.situation). */
export interface Situation {
  id: number
  name: string
  change_id: number
  author: string | null
  created_at: string
  /** When that change was made. */
  at: string | null
}

export async function listSituations(): Promise<Situation[]> {
  return (await json<{ situations: Situation[] }>(await fetch(`${BASE}/situations`))).situations
}

/** A situation covering these layers (only those who can see them all see it). */
export async function createSituation(name: string, layers: string[], author?: string): Promise<Situation> {
  return json(
    await fetch(`${BASE}/situations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, layers, author: author || null })
    })
  )
}

/** Who a layer is shared with (its owner only). */
export interface LayerSharing {
  owner: string | null
  /** From before accounts: everyone may change it. */
  open_to_all: boolean
  people: { id: number; name: string; level: 'view' | 'modify' | null }[]
}

export async function layerSharing(layerId: string): Promise<LayerSharing> {
  return json(await fetch(`${BASE}/layers/${layerId}/access`))
}

export async function shareLayer(
  layerId: string,
  userId: number,
  level: 'view' | 'modify' | null
): Promise<LayerSharing> {
  return json(
    await fetch(`${BASE}/layers/${layerId}/access`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, level })
    })
  )
}

export async function deleteSituation(id: number): Promise<void> {
  await json(await fetch(`${BASE}/situations/${id}`, { method: 'DELETE' }))
}
