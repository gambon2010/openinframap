// Fork: My layers on the server: loading the saved layers and sending the unsaved
// changes (Save). Today Save sends them all at once; live sync (docs/plans/sync.md)
// will add versions and changes pushed by the server here, behind the same calls.
import { Change, UserLayer } from '../model.ts'
import { loadAll, saveChanges } from '../api.ts'

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
        features: new Map(layer.features.map((f) => [f.id, f]))
      }
    ])
  )
}

/** Send changes, in order; the server applies all of them or none. */
export async function send(changes: Change[], author: string): Promise<void> {
  await saveChanges(changes, author)
}
