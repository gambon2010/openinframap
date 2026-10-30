// Fork: "My layers" data, as the backend stores it (web-backend/src/fork/userdata.py).

/** What a feature in a user layer is. Copies of map features keep their original
 * properties too, so they're drawn like the original. */
export interface FeatureProps {
  kind: 'symbol' | 'graphic' | 'image' | 'marker' | 'drawing' | 'copy'
  name?: string
  /** symbol, graphic: its MIL-STD-2525C code (symbols drawn by @syncpoint/signs,
   * graphics by the C5ISR renderer from the control points in the geometry). */
  sidc?: string
  /** symbol, graphic: descriptive fields, keyed by modifier letter (fields.ts). */
  modifiers?: Record<string, string>
  /** graphic: an arrow, drawn as a path from tail to tip (graphics.ts axisControlPoints). */
  axis?: boolean
  /** graphic, arrows: the width in metres (set by the size handle). */
  axisWidth?: number
  /** Free notes (not drawn). */
  notes?: string
  /** image: its id (GET /userdata/images/{id}). */
  image?: string
  /** symbol, image, marker: size factor (1 = normal). */
  size?: number
  /** drawing, marker: colour and line width. */
  color?: string
  width?: number
  /** copy: the map layer it was copied from. */
  copy?: { source: string; sourceLayer: string; layer: string }
  [key: string]: unknown
}

export interface UserFeature {
  type: 'Feature'
  id: string
  geometry: GeoJSON.Geometry
  properties: FeatureProps
}

export interface UserLayer {
  id: string
  name: string
  style: { color?: string }
  features: Map<string, UserFeature>
}

export type ChangeOp =
  'layer_create' | 'layer_update' | 'layer_delete' | 'feature_create' | 'feature_update' | 'feature_delete'

/** One change, as kept until saved and as sent with "Save". */
export interface Change {
  op: ChangeOp
  layer_id: string
  feature_id?: string
  /** layer: {name, style}; feature: {geometry, properties} (whole, not a diff). */
  data?: { name?: string; style?: UserLayer['style']; geometry?: GeoJSON.Geometry; properties?: FeatureProps }
  /** When it was done, in the browser (ISO 8601). */
  made_at: string
  /** Changes made by one action share it (e.g. moving an item: out of one layer,
   * into another), so undo takes them back together. Not used by the backend. */
  batch?: string
}

/** A saved change, as GET /userdata/history returns it (after = state after it). */
export interface SavedChange {
  id: number
  save_id: number
  saved_at: string
  author: string | null
  note: string | null
  op: ChangeOp
  layer_id: string
  feature_id: string | null
  after: any
  made_at: string
}

export function uuid(): string {
  return crypto.randomUUID()
}

export const DEFAULT_COLOR = '#d32f2f'
