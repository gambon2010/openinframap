// Fork: bringing your unsaved changes up to date with what's saved on the server
// (docs/plans/sync.md): for every item and layer you changed, merge (merge.ts)
// how it was when you started (its base), yours, and the server's now. The result:
// the server's layers as the new saved ones, your changes rewritten on top of them,
// new bases (the server's versions), and the conflicts left to resolve. Pure.
import { Change, UserFeature, UserLayer } from '../model/model.ts'
import { FeatureState, LayerState, mergeFeature, mergeLayer } from './merge.ts'

/** How an item or layer was when your changes to it started: its version and state. */
export interface Base {
  version: number
  state: FeatureState | LayerState | null
}

export type Bases = Record<string, Base>

export interface Conflict {
  /** "feature:<id>" or "layer:<id>". */
  key: string
  /** The fields both changed differently ("deleted": one side deleted it). */
  fields: string[]
  mine: FeatureState | LayerState | null
  theirs: FeatureState | LayerState | null
  /** Who saved theirs, and when (from the server). */
  by: string | null
  at: string | null
}

export function featureKey(id: string) {
  return `feature:${id}`
}
export function layerKey(id: string) {
  return `layer:${id}`
}

/** The key of what a change touches. */
export function changeKey(change: Change): string {
  return change.op.startsWith('layer_') ? layerKey(change.layer_id) : featureKey(change.feature_id ?? '')
}

export function findFeature(layers: Map<string, UserLayer>, id: string): FeatureState | null {
  for (const layer of layers.values()) {
    const feature = layer.features.get(id)
    if (feature) return { layerId: layer.id, feature }
  }
  return null
}

export function layerState(layers: Map<string, UserLayer>, id: string): LayerState | null {
  const layer = layers.get(id)
  return layer ? { name: layer.name, style: { ...layer.style } } : null
}

/** The state and version of something in a set of layers (saved ones carry versions). */
export function baseOf(layers: Map<string, UserLayer>, key: string): Base {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (kind === 'layer') {
    const layer = layers.get(id)
    return { version: layer?.version ?? 0, state: layerState(layers, id) }
  }
  const found = findFeature(layers, id)
  return { version: (found?.feature as Versioned | undefined)?.version ?? 0, state: found }
}

type Versioned = UserFeature & { version?: number; updated_by?: string | null; updated_at?: string }

/** Plain feature (what changes carry), without the server's version fields. */
function plain(f: UserFeature): UserFeature {
  return { type: 'Feature', id: f.id, geometry: f.geometry, properties: f.properties }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The changes that turn `from` into `to` for one item or layer. */
function changesFor(key: string, from: Base['state'], to: Base['state'], made_at: string): Change[] {
  const id = key.slice(key.indexOf(':') + 1)
  if (key.startsWith('layer:')) {
    const a = from as LayerState | null
    const b = to as LayerState | null
    if (same(a, b)) return []
    if (!b) return [{ op: 'layer_delete', layer_id: id, made_at }]
    if (!a) return [{ op: 'layer_create', layer_id: id, data: { name: b.name, style: b.style }, made_at }]
    return [{ op: 'layer_update', layer_id: id, data: { name: b.name, style: b.style }, made_at }]
  }
  const a = from as FeatureState | null
  const b = to as FeatureState | null
  if (a && b && a.layerId === b.layerId && same(plain(a.feature), plain(b.feature))) return []
  if (!a && !b) return []
  const data = b ? { geometry: b.feature.geometry, properties: b.feature.properties } : undefined
  if (!b) return [{ op: 'feature_delete', layer_id: a!.layerId, feature_id: id, made_at }]
  if (!a) return [{ op: 'feature_create', layer_id: b.layerId, feature_id: id, data, made_at }]
  if (a.layerId !== b.layerId) {
    // Moved: out of one layer, into the other (as the store does).
    return [
      { op: 'feature_delete', layer_id: a.layerId, feature_id: id, made_at },
      { op: 'feature_create', layer_id: b.layerId, feature_id: id, data, made_at }
    ]
  }
  return [{ op: 'feature_update', layer_id: b.layerId, feature_id: id, data, made_at }]
}

/**
 * Your unsaved changes (pending, made on top of the bases) brought onto the
 * server's layers (fresh): the new pending changes, bases and conflicts.
 */
export function reconcile(
  bases: Bases,
  pending: Change[],
  current: Map<string, UserLayer>,
  fresh: Map<string, UserLayer>
): { pending: Change[]; bases: Bases; conflicts: Conflict[] } {
  const keys = [...new Set(pending.map(changeKey))]
  const made_at = new Date().toISOString()
  const merged = new Map<string, Base['state']>()
  const conflicts: Conflict[] = []
  const newBases: Bases = {}
  for (const key of keys) {
    const base = bases[key]?.state ?? null
    const id = key.slice(key.indexOf(':') + 1)
    const isLayer = key.startsWith('layer:')
    const mine = isLayer ? layerState(current, id) : findFeature(current, id)
    const theirs = isLayer ? layerState(fresh, id) : findFeature(fresh, id)
    const result = isLayer
      ? mergeLayer(base as LayerState | null, mine as LayerState | null, theirs as LayerState | null)
      : mergeFeature(
          id,
          base as FeatureState | null,
          mine as FeatureState | null,
          theirs as FeatureState | null
        )
    merged.set(key, result.merged)
    newBases[key] = baseOf(fresh, key)
    if (result.conflicts.length) {
      const server = isLayer
        ? fresh.get(id)
        : ((theirs as FeatureState | null)?.feature as Versioned | undefined)
      conflicts.push({
        key,
        fields: result.conflicts,
        mine,
        theirs,
        by: (server as { updated_by?: string | null } | undefined)?.updated_by ?? null,
        at: (server as { updated_at?: string } | undefined)?.updated_at ?? null
      })
    }
  }
  // Layers made first, items next, layers deleted last (their items go with them).
  const changes = keys.flatMap((key) =>
    changesFor(key, baseOf(fresh, key).state, merged.get(key) ?? null, made_at)
  )
  const rank = (c: Change) => (c.op === 'layer_create' ? 0 : c.op === 'layer_delete' ? 2 : 1)
  changes.sort((a, b) => rank(a) - rank(b))
  // An item's change in a layer gone on the server (and not made again) can't apply:
  // left out.
  const layers = new Set([
    ...fresh.keys(),
    ...changes.filter((c) => c.op === 'layer_create').map((c) => c.layer_id)
  ])
  const kept = changes.filter(
    (c) => !c.op.startsWith('feature_') || c.op === 'feature_delete' || layers.has(c.layer_id)
  )
  return { pending: kept, bases: newBases, conflicts }
}
