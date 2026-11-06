// Fork: an item's card (editor/index.ts): what it asks the workspace to do, and what
// its parts work with.
import { FeatureProps, UserFeature, UserLayer } from '../../model/model.ts'
import { SymbolKind } from '../../model/sidc.ts'
import type { ItemKind } from '../../kinds/types.ts'

export interface EditorActions {
  update: (properties: FeatureProps) => void
  /** Change its shape (a measurement's leg lengths). */
  setGeometry: (geometry: GeoJSON.Geometry) => void
  moveTo: (layerId: string) => void
  duplicate: () => void
  remove: () => void
  done: () => void
  /** Whether a layer's items may be changed now (state/view.ts). */
  canEdit: (layer: UserLayer) => boolean
}

/** What every part of an item's card works with (buildEditor). */
export interface Card {
  feature: UserFeature
  layer: UserLayer
  layers: UserLayer[]
  actions: EditorActions
  p: FeatureProps
  update: (changes: Partial<FeatureProps>) => void
  itemKind: ItemKind
  military: boolean
  sidc: string
  kind: SymbolKind | null
  /** Its text fields (2525 letters), the old name as its designation. */
  modifiers: Record<string, string>
  setModifier: (key: string, value: string) => void
}

/** A piece of the card, in order. */
export type CardPart = HTMLElement | string

export interface BulkActions {
  /** Apply a change to the properties of each selected item (one undo step). */
  updateEach: (change: (properties: FeatureProps) => FeatureProps | null) => void
  moveTo: (layerId: string) => void
  remove: () => void
  clear: () => void
  /** Whether a layer's items may be changed now (state/view.ts). */
  canEdit: (layer: UserLayer) => boolean
}
