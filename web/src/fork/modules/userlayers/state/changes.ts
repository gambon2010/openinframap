// Fork: My layers' changes, pure (no browser, no server): applying them to layers,
// grouping them in steps, and what undoing a saved step takes. Used by the store,
// the undo history and the history playback.
import { Change, UserFeature, UserLayer } from '../model.ts'

/** Apply a change to a set of layers (also used to replay the history). */
export function applyChange(layers: Map<string, UserLayer>, change: Change) {
  const data = change.data ?? {}
  switch (change.op) {
    case 'layer_create':
      layers.set(change.layer_id, {
        id: change.layer_id,
        name: data.name ?? 'Layer',
        style: data.style ?? {},
        features: new Map()
      })
      break
    case 'layer_update': {
      const layer = layers.get(change.layer_id)
      if (!layer) break
      if (data.name !== undefined) layer.name = data.name
      if (data.style !== undefined) layer.style = data.style
      break
    }
    case 'layer_delete':
      layers.delete(change.layer_id)
      break
    case 'feature_create':
    case 'feature_update': {
      const layer = layers.get(change.layer_id)
      if (!layer || !change.feature_id || !data.geometry || !data.properties) break
      layer.features.set(change.feature_id, {
        type: 'Feature',
        id: change.feature_id,
        geometry: data.geometry,
        properties: data.properties
      })
      break
    }
    case 'feature_delete':
      layers.get(change.layer_id)?.features.delete(change.feature_id ?? '')
      break
  }
}

type LayerState = { name: string; style: UserLayer['style'] } | null

/**
 * What a saved step touched, before and after it: layers (name, style) and items.
 * Undo puts back only what the step changed, so what others changed since stays.
 */
export interface SavedStep {
  layers: Map<string, { before: LayerState; after: LayerState }>
  features: Map<
    string,
    { layerId: string; featureId: string; before: UserFeature | null; after: UserFeature | null }
  >
}

/** The changes of `pending`, in steps: one change, or all of one batch. */
export function steps(changes: Change[]): Change[][] {
  const out: Change[][] = []
  for (const change of changes) {
    const last = out[out.length - 1]
    if (last && change.batch && last[0].batch === change.batch) last.push(change)
    else out.push([change])
  }
  return out
}

function featureKey(layerId: string, featureId: string) {
  return `${layerId}/${featureId}`
}

function layerState(layer: UserLayer | undefined): LayerState {
  return layer ? { name: layer.name, style: { ...layer.style } } : null
}

/** Apply a step's changes to `layers`, noting how what they touch was before and after. */
export function applyStep(layers: Map<string, UserLayer>, changes: Change[]): SavedStep {
  const step: SavedStep = { layers: new Map(), features: new Map() }
  const noteFeature = (layerId: string, featureId: string) => {
    const key = featureKey(layerId, featureId)
    if (!step.features.has(key))
      step.features.set(key, {
        layerId,
        featureId,
        before: layers.get(layerId)?.features.get(featureId) ?? null,
        after: null
      })
  }
  for (const change of changes) {
    const layer = layers.get(change.layer_id)
    if (change.op.startsWith('layer_')) {
      if (!step.layers.has(change.layer_id))
        step.layers.set(change.layer_id, { before: layerState(layer), after: null })
      if (change.op === 'layer_delete' && layer)
        for (const id of layer.features.keys()) noteFeature(layer.id, id)
    } else if (change.feature_id) noteFeature(change.layer_id, change.feature_id)
  }
  for (const change of changes) applyChange(layers, change)
  for (const [id, entry] of step.layers) entry.after = layerState(layers.get(id))
  for (const entry of step.features.values())
    entry.after = layers.get(entry.layerId)?.features.get(entry.featureId) ?? null
  return step
}

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * `now`, with the keys that went from `before` to `after` put back as they were
 * `before` (nested objects, such as the modifiers, key by key). Keys the change
 * didn't touch keep their value in `now`.
 */
export function revertFields<T extends object>(beforeValue: T, afterValue: T, nowValue: T): T {
  const before = beforeValue as Record<string, unknown>
  const after = afterValue as Record<string, unknown>
  const now = nowValue as Record<string, unknown>
  const out: Record<string, unknown> = { ...now }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[key]
    const a = after[key]
    if (same(b, a)) continue
    if (isObject(b) && isObject(a) && isObject(now[key])) {
      out[key] = revertFields(b, a, now[key] as object)
    } else if (b === undefined) delete out[key]
    else out[key] = b
  }
  return out as T
}

/** The changes that undo what a step changed, on top of the layers as they are now. */
export function restoring(layers: Map<string, UserLayer>, step: SavedStep, batch: string): Change[] {
  const made_at = new Date().toISOString()
  const created: Change[] = []
  const deleted: Change[] = []
  const gone = new Set<string>()
  for (const [id, { before, after }] of step.layers) {
    const now = layers.get(id)
    if (!before && after) {
      if (now) {
        deleted.push({ op: 'layer_delete', layer_id: id, made_at, batch })
        gone.add(id)
      }
    } else if (before && !after) {
      if (!now) created.push({ op: 'layer_create', layer_id: id, data: { ...before }, made_at, batch })
    } else if (before && after && now) {
      const name = before.name !== after.name ? before.name : now.name
      const style = revertFields(before.style, after.style, now.style)
      if (name !== now.name || !same(style, now.style))
        created.push({ op: 'layer_update', layer_id: id, data: { name, style }, made_at, batch })
    }
  }
  const items: Change[] = []
  for (const { layerId, featureId, before, after } of step.features.values()) {
    if (gone.has(layerId)) continue
    const now = layers.get(layerId)?.features.get(featureId)
    const change = (op: Change['op'], data?: Change['data']): Change => ({
      op,
      layer_id: layerId,
      feature_id: featureId,
      data,
      made_at,
      batch
    })
    if (!before && after) {
      if (now) items.push(change('feature_delete'))
    } else if (before && !after) {
      if (!now)
        items.push(change('feature_create', { geometry: before.geometry, properties: before.properties }))
    } else if (before && after && now) {
      const geometry = same(before.geometry, after.geometry) ? now.geometry : before.geometry
      const properties = revertFields(before.properties, after.properties, now.properties)
      if (!same(geometry, now.geometry) || !same(properties, now.properties))
        items.push(change('feature_update', { geometry, properties }))
    }
  }
  return [...created, ...items, ...deleted]
}

export function cloneLayers(layers: Map<string, UserLayer>): Map<string, UserLayer> {
  return new Map(
    [...layers].map(([id, layer]) => [
      id,
      { ...layer, style: { ...layer.style }, features: new Map(layer.features) }
    ])
  )
}

/**
 * How many layers and items differ between two versions of the layers (what Save
 * would really change). Changes that cancel out (lock then unlock) count for nothing.
 */
export function differences(saved: Map<string, UserLayer>, layers: Map<string, UserLayer>): number {
  let count = 0
  for (const id of new Set([...saved.keys(), ...layers.keys()])) {
    const before = saved.get(id)
    const after = layers.get(id)
    if (!before || !after) {
      count += 1 + (before?.features.size ?? after?.features.size ?? 0)
      continue
    }
    if (before.name !== after.name || !same(before.style, after.style)) count++
    for (const f of new Set([...before.features.keys(), ...after.features.keys()])) {
      const a = before.features.get(f)
      const b = after.features.get(f)
      if (!a || !b || !same(a.geometry, b.geometry) || !same(a.properties, b.properties)) count++
    }
  }
  return count
}
