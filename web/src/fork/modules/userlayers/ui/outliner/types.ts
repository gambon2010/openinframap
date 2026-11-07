// Fork: My layers' list (outliner/index.ts): its filters, what it asks the workspace
// to do, and a name being typed in place.
import type { UserFeature, UserLayer } from '../../model/model.ts'
import type { Format } from '../../io/formats.ts'
import type { Store } from '../../state/store.ts'
import type { PersonalSettings } from '../../state/personal.ts'

export type Filter = 'hostile' | 'friend' | 'planned' | 'units' | 'graphics' | 'pictures'

export interface OutlinerActions {
  update: () => void
  /** One item (and the map goes to it), or added to / taken out of the selection. */
  select: (feature: UserFeature, add: boolean) => void
  /** Add these to the selection (Shift-click: a range of the list). */
  selectMore: (ids: string[]) => void
  isSelected: (id: string) => boolean
  /** Everything selected, the main one first. */
  selection: () => string[]
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

/** The groups a layer's items are shown in (groups.ts). */
export type ItemGroup =
  | 'friendly-units'
  | 'hostile-units'
  | 'other-units'
  | 'friendly-graphics'
  | 'hostile-graphics'
  | 'other-graphics'
  | 'measurements'
  | 'drawings'
  | 'pictures'
  | 'copies'

/** What the list's parts (rows/, menus.ts, editing.ts, drag.ts, footer.ts) share:
 * the Outliner is it. */
export interface OutlinerContext {
  readonly el: HTMLElement
  readonly store: Store
  readonly actions: OutlinerActions
  /** Folders, the order, open layers, folded folders and groups: yours. */
  readonly personal: PersonalSettings
  /** A situation's layers, shown read-only instead of the live ones (state/view.ts). */
  readonly past: Map<string, UserLayer> | null
  readonly filterButton: HTMLButtonElement
  query: string
  filters: Set<Filter>
  /** The filter chips are showing (Filter). */
  filtersOpen: boolean
  editing: Editing | null
  /** Layers showing all their items, not only the first ITEMS_SHOWN. */
  showAll: Set<string>
  /** The items in the list, in the order shown (for Shift-click ranges). */
  shownItems: string[]
  /** The item clicked last without Shift: where a Shift-click range starts. */
  anchor: string | null
  /** The row that had the keyboard focus, to give it back after drawing again. */
  focusKey: string | null
  /** The symbol library, once loaded (items' pictures). */
  render?: (sidc: string, size?: number) => string
  folderOf: (layer: UserLayer) => string | null
}
