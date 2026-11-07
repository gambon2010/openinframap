// Fork: the types of My layers' map tools (tools.ts and the parts in tools/).
import type { Map, MapGeoJSONFeature, PointLike } from 'maplibre-gl'
import type { LayerSpecificationWithZIndex } from '../../../../style/types.ts'
import type { Store } from '../state/store.ts'
import type { Renderer } from './render.ts'
import type { FeatureProps, UserFeature } from '../model/model.ts'

export type Tool =
  | { mode: 'select' }
  | { mode: 'place'; properties: FeatureProps }
  | {
      mode: 'line' | 'area'
      points: [number, number][]
      /** What it makes (none: a drawing): a measurement, for the measuring tools. */
      properties?: FeatureProps
    }
  | { mode: 'copy' }
  | {
      mode: 'graphic'
      properties: FeatureProps
      points: [number, number][]
      min: number
      max: number
      /** An arrow: drawn as a path from tail to tip (its width follows). */
      axis?: boolean
      /** An arrow: its width against the automatic one (a fifth of its length):
       * Shift + scroll while drawing. */
      widthFactor?: number
    }

/** A tool that adds points one click at a time. */
export type DrawingTool = Extract<Tool, { points: [number, number][] }>

/** An item being dragged. index: the point of a line, area or graphic being moved
 * (none: a whole symbol); resize: the image being resized (its centre on screen,
 * and the handle's distance from it at size 1); move: the whole item, where it
 * was grabbed and its shape then. */
export interface Dragging {
  feature: UserFeature
  layerId: string
  index?: number
  resize?: { x: number; y: number; distanceAtSize1: number }
  move?: { from: [number, number]; geometry: GeoJSON.Geometry }
}

/** An item being resized with Shift + scroll: shown as it changes, kept as one
 * change once the scrolling stops. */
export interface Resizing {
  layerId: string
  feature: UserFeature
  timer: ReturnType<typeof setTimeout>
}

/** What the parts of the tools (tools/) share: Tools is it. */
export interface ToolsContext {
  readonly map: Map
  readonly store: Store
  readonly renderer: Renderer
  readonly primaryLayers: () => LayerSpecificationWithZIndex[]
  tool: Tool
  selected: string | null
  /** Items selected along with `selected` (Shift-click): changed together. */
  others: string[]
  message: string
  /** The tool's own hint (message shows a warning instead for a moment). */
  hint: string
  dragging: Dragging | null
  resizing: Resizing | null
  /** Where the pointer was last on the map (to draw previews again after a scroll). */
  cursor: [number, number] | null
  wheelTotal: number
  readonly enabled: boolean
  notify(): void
  setTool(tool: Tool, message?: string): void
  select(featureId: string | null): void
  selection(): string[]
  activeLayer(): string
  hit(point: PointLike): MapGeoJSONFeature | undefined
}
