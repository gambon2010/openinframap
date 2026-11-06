// Fork: My layers' list (outliner/index.ts): its filters, what it asks the workspace
// to do, and a name being typed in place.
import type { UserFeature, UserLayer } from '../../model/model.ts'
import type { Format } from '../../io/formats.ts'

export type Filter = 'hostile' | 'friend' | 'planned' | 'units' | 'graphics' | 'pictures'

export interface OutlinerActions {
  update: () => void
  select: (feature: UserFeature, add: boolean) => void
  isSelected: (id: string) => boolean
  newLayer: (folder?: string) => void
  /** Download layers as a file (io/files.ts). */
  exportLayers: (layers: UserLayer[], format: Format) => void
  /** Choose a file: a new layer with its items. */
  importFile: () => void
  /** Move the map to show all of a layer's items. */
  zoomToLayer: (layer: UserLayer) => void
  /** The layers' order changed: the map draws them again. */
  reordered: () => void
}

/** A name being typed in place. */
export interface Editing {
  kind: 'layer' | 'folder'
  /** The layer's id, or the folder's name. */
  id: string
  value: string
  /** The text is selected the first time (typing replaces it). */
  fresh: boolean
}
