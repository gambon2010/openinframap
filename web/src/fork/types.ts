// Fork: what a fork module can add to the map. Upstream files call the hooks in
// fork/index.ts, which gather these from every module, so adding a layer means
// adding a module here rather than editing upstream files. See docs/FORK_CHANGES.md.
import { Map, MapGeoJSONFeature, SourceSpecification } from 'maplibre-gl'
import { LayerSwitcher, LayerGroup, URLHash } from '@russss/maplibregl-layer-switcher'
import type InfoPopup from '../popup/infopopup.ts'
import type { CircuitInspector } from '../circuit/circuitinspector.ts'
import { ClickRouter } from '../click-router.ts'
import { LayerSpecificationWithZIndex } from '../style/types.ts'
import type { SearchResult } from '../search/search.ts'
import type { HideSpec } from './key/feature-hider.ts'

/** Handed to modules once the map and its controls exist (before clicks are routed). */
export interface ForkContext {
  map: Map
  layerSwitcher: LayerSwitcher
  clickRouter: ClickRouter
  /** All data layers of the style, upstream's and the fork's (style.ts getPrimaryLayers). */
  primaryLayers: () => LayerSpecificationWithZIndex[]
  /** The map link (extra parameters such as route=). */
  urlHash: URLHash
  /** Upstream's feature details (popupHtml builds them). */
  infoPopup: InfoPopup
  circuitInspector: CircuitInspector
}

/** A key row: label, swatch and what unticking it hides (none: no checkbox). */
export type KeyRow = [label: string, swatch: Element | string | undefined, hide?: HideSpec]

export interface KeySection {
  title: string
  rows: KeyRow[]
  /** Add the rows to the end of an existing section (its title) instead. */
  appendTo?: string
}

/** A search result from the backend, as search/openinframap.ts receives it. */
export interface BackendSearchResult {
  type: string
  id?: number
  place_type?: string
  kind?: string
  source?: string
  town?: string
  layer?: string
  country?: string
}

export interface ForkModule {
  /** Map sources, added to the style's (style.ts). */
  sources?: () => Record<string, SourceSpecification>
  /** Map layers, added to the data layers (style.ts getPrimaryLayers). */
  layers?: () => LayerSpecificationWithZIndex[]
  /** Layer switcher groups, before upstream's Validation group. */
  switcherGroups?: () => LayerGroup[]
  /** Runs once the map exists. */
  init?: (ctx: ForkContext) => void
  /** Key sections (key/key.ts). */
  key?: () => Promise<KeySection[]>
  popup?: {
    /** Properties never listed in the popup. */
    hiddenKeys?: string[]
    /** A table row for a property; undefined = upstream's rendering. */
    renderKey?: (key: string, value: unknown) => HTMLElement | null | undefined
    /** The title when the feature has no name; undefined = upstream's. */
    title?: (feature: MapGeoJSONFeature) => string | undefined
    /** The whole popup; undefined = upstream's. */
    html?: (feature: MapGeoJSONFeature) => HTMLElement | undefined
    /** Show a clicked feature's details instead of upstream's popup; true = shown. */
    open?: (feature: MapGeoJSONFeature) => boolean
  }
  /** The description under a search result's name; undefined = upstream's. */
  searchDescription?: (result: BackendSearchResult) => string | undefined
  /** A search result was picked. */
  searchSelected?: (result: SearchResult, ctx: ForkContext) => void
}
