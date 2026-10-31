// Fork: merging what someone else saved with your unsaved changes, field by field
// (docs/plans/sync.md, "Merging what arrives with what you're doing"). Pure: the
// store gives, for each item you changed, how it was when you started (base),
// yours, and theirs (the server's now).
//
// | you changed the field? | they did? | result               |
// | no                     | yes       | theirs               |
// | yes                    | no        | yours                |
// | yes, to the same value | yes       | nothing to do        |
// | yes                    | yes, differently | conflict      |
//
// Fields: an item's position (geometry), its layer, each property, each detail
// (modifiers), and the parts of its symbol code (identity, status, echelon...); a
// layer's name and each of its style's keys. Deleting counts as changing every
// field: deleted on one side and changed on the other is a conflict.
import { FeatureProps, UserFeature, UserLayer } from '../model/model.ts'

/** An item as merged: the feature and the layer it's in. */
export interface FeatureState {
  layerId: string
  feature: UserFeature
}

export type LayerState = Pick<UserLayer, 'name' | 'style'>

export interface Merged<T> {
  /** The result: yours where there's a conflict (until it's resolved); null: deleted. */
  merged: T | null
  /** The fields both changed differently ("deleted" if one side deleted it); none: merged. */
  conflicts: string[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// The symbol code's parts (model/sidc.ts): each merged on its own.
const SIDC_PARTS: [string, number, number][] = [
  ['scheme', 0, 1],
  ['identity', 1, 2],
  ['dimension', 2, 3],
  ['status', 3, 4],
  ['function', 4, 10],
  ['echelon', 10, 12],
  ['country', 12, 14],
  ['order', 14, 15]
]

/** An item's fields, flat: "geometry", "layer", "properties.name", "modifiers.T", "sidc.status"... */
export function featureFields(state: FeatureState): Record<string, unknown> {
  const fields: Record<string, unknown> = { geometry: state.feature.geometry, layer: state.layerId }
  for (const [key, value] of Object.entries(state.feature.properties)) {
    if (key === 'modifiers' && value && typeof value === 'object') {
      for (const [m, v] of Object.entries(value)) fields[`modifiers.${m}`] = v
    } else if (key === 'sidc' && typeof value === 'string') {
      for (const [part, from, to] of SIDC_PARTS) fields[`sidc.${part}`] = value.slice(from, to)
    } else fields[`properties.${key}`] = value
  }
  return fields
}

/** An item from its flat fields (featureFields' opposite). */
export function featureFromFields(id: string, fields: Record<string, unknown>): FeatureState {
  const properties: Record<string, unknown> = {}
  const modifiers: Record<string, string> = {}
  const parts: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (key.startsWith('modifiers.')) modifiers[key.slice(10)] = value as string
    else if (key.startsWith('sidc.')) parts[key.slice(5)] = value as string
    else if (key.startsWith('properties.')) properties[key.slice(11)] = value
  }
  if (Object.keys(parts).length) {
    properties.sidc = SIDC_PARTS.map(([part, from, to]) => (parts[part] ?? '').padEnd(to - from, '-')).join(
      ''
    )
  }
  if (Object.keys(modifiers).length) properties.modifiers = modifiers
  return {
    layerId: fields.layer as string,
    feature: {
      type: 'Feature',
      id,
      geometry: fields.geometry as GeoJSON.Geometry,
      properties: properties as FeatureProps
    }
  }
}

export function layerFields(state: LayerState): Record<string, unknown> {
  const fields: Record<string, unknown> = { name: state.name }
  for (const [key, value] of Object.entries(state.style)) fields[`style.${key}`] = value
  return fields
}

export function layerFromFields(fields: Record<string, unknown>): LayerState {
  const style: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('style.') && value !== undefined) style[key.slice(6)] = value
  }
  return { name: fields.name as string, style: style as LayerState['style'] }
}

/** Merge the fields of base, yours and theirs (all present). */
export function mergeFields(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>
): { fields: Record<string, unknown>; conflicts: string[] } {
  const fields: Record<string, unknown> = {}
  const conflicts: string[] = []
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const b = base[key]
    const m = mine[key]
    const t = theirs[key]
    if (same(m, b)) fields[key] = t
    else if (same(t, b) || same(m, t)) fields[key] = m
    else {
      fields[key] = m
      conflicts.push(key)
    }
  }
  return { fields, conflicts }
}

/** Merge one thing (an item or a layer), any side null for "doesn't exist". */
function mergeStates<T>(
  base: T | null,
  mine: T | null,
  theirs: T | null,
  toFields: (s: T) => Record<string, unknown>,
  fromFields: (f: Record<string, unknown>) => T
): Merged<T> {
  if (same(mine, base)) return { merged: theirs, conflicts: [] }
  if (same(theirs, base) || same(mine, theirs)) return { merged: mine, conflicts: [] }
  // Both changed it. Deleted on one side (or made on both, from nothing): the whole of it.
  if (!base || !mine || !theirs) return { merged: mine, conflicts: ['deleted'] }
  const { fields, conflicts } = mergeFields(toFields(base), toFields(mine), toFields(theirs))
  return { merged: fromFields(fields), conflicts }
}

export function mergeFeature(
  id: string,
  base: FeatureState | null,
  mine: FeatureState | null,
  theirs: FeatureState | null
): Merged<FeatureState> {
  return mergeStates(base, mine, theirs, featureFields, (f) => featureFromFields(id, f))
}

export function mergeLayer(
  base: LayerState | null,
  mine: LayerState | null,
  theirs: LayerState | null
): Merged<LayerState> {
  return mergeStates(base, mine, theirs, layerFields, layerFromFields)
}
