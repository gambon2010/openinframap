// Fork: what a kind of My layers item is (kinds/index.ts lists them). Each kind
// says how it's named, drawn and edited; the rest of My layers asks it rather than
// testing `kind === ...`. To add a kind: a file here, a line in KINDS, its name in
// FeatureProps' `kind` (model/model.ts), and a way to make it (a tool in
// ui/toolbar.ts, or a file import: io/formats.ts reads the kind back by itself).
import type { FeatureProps, UserFeature } from '../model/model.ts'

/** The list's filter chips a kind can answer (the others are about symbol codes). */
export type KindFilter = 'units' | 'graphics' | 'pictures'

/** Draws a symbol code as SVG (map/symbols.ts symbolRenderer, once loaded). */
export type SymbolRender = (sidc: string, size?: number) => string

/** An image for the map, and its resolution. */
export interface IconImage {
  data: ImageData | HTMLImageElement
  pixelRatio: number
}

export type Item = Pick<UserFeature, 'geometry' | 'properties'>

export interface ItemKind {
  id: FeatureProps['kind']
  /** In messages and the history: "symbol", "line", "copy of Power lines". */
  noun(item: Item): string
  /** In the list and on the card: what it is ("Infantry", "Marker"). */
  what(item: Item): string
  /** Has a MIL-STD-2525C code (sidc): its fields, identity, echelon on the card. */
  military?: boolean
  /** How the map draws it: points as its icon and lines and areas in its colour
   * (standard), by the tactical graphics renderer (graphic), or as a clone of the
   * map's own layers (copy), or as a measurement with its labels and marks
   * (measure/features.ts). */
  drawn: 'standard' | 'graphic' | 'copy' | 'measure'
  /** Points: the name of the image they're drawn with ("<prefix>:<value>"). */
  icon?(p: FeatureProps, layerColour: string): string | null
  /** The images named by icon(): their prefix, and how one is drawn. */
  images?: { prefix: string; make(value: string): Promise<IconImage> }
  /** A small picture for the list: an element, text, or null while the symbol
   * library loads (render: given once it has). */
  thumbnail(item: Item, render?: SymbolRender): HTMLElement | string | null
  /** As a point: a size (the slider, the resize handle on the map). */
  sized?: boolean
  /** Its own colour can be set. */
  coloured?: boolean
  /** As a line or area: its line width can be set. */
  lineWidth?: boolean
  /** It can be dragged on the map (default yes). */
  movable?: boolean
  /** The card opens on its Appearance (pictures: their size matters first). */
  appearanceFirst?: boolean
  /** The filter chips it's under. */
  filters?(p: FeatureProps): KindFilter[]
  /** More on its card, after its name and before its appearance (ui/editor.ts):
   * update changes its properties (one change, undoable). */
  card?(item: Item, update: (changes: Partial<FeatureProps>) => void): HTMLElement[]
}
