// Fork: My layers on the server: loading the saved layers and sending the unsaved
// changes (Save) with the versions they started from (docs/plans/sync.md); live
// updates pushed by the server will come here, behind the same calls.
import { Change, UserLayer } from '../model/model.ts'
import { loadAll, saveChanges } from './api.ts'
import { Bases, changeKey } from './reconcile.ts'

/** The layers as saved on the server. */
export async function loadSaved(): Promise<Map<string, UserLayer>> {
  const data = await loadAll()
  return new Map(
    data.layers.map((layer) => [
      layer.id,
      {
        id: layer.id,
        name: layer.name,
        style: layer.style,
        access: layer.access,
        owner: layer.owner,
        version: layer.version,
        updated_by: layer.updated_by,
        updated_at: layer.updated_at,
        features: new Map(layer.features.map((f) => [f.id, f]))
      }
    ])
  )
}

/**
 * Send changes, in order, with the versions they started from; the server applies
 * all of them or none (StaleError: someone else saved some of them meanwhile).
 */
export async function send(changes: Change[], bases: Bases, author: string): Promise<void> {
  const keys = new Set(changes.map(changeKey))
  const versions = Object.fromEntries(
    Object.entries(bases)
      .filter(([key]) => keys.has(key))
      .map(([key, b]) => [key, b.version])
  )
  await saveChanges(changes, versions, author)
}
