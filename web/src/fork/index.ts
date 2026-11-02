// Fork: the hooks upstream files call. Each gathers what the fork modules add, so
// upstream files keep one-line changes and new layers only need a new module in
// MODULES. Upstream imports only this file, types.ts and config.ts. See
// docs/FORK_CHANGES.md ("Fork modules").
import i18next from 'i18next'
import { Map, MapGeoJSONFeature, SourceSpecification } from 'maplibre-gl'
import { LayerGroup } from '@russss/maplibregl-layer-switcher'
import { LayerSpecificationWithZIndex } from '../style/types.ts'
import type { SearchResult, ISearchProvider } from '../search/search.ts'
import { BackendSearchResult, ForkContext, ForkModule } from './types.ts'
import { extendKey } from './ui/key/toggles.ts'
import { leftColumn } from './ui/left-column.ts'
import { mapMode } from './ui/map-mode.ts'
import extra from './modules/extra/index.ts'
import sites from './modules/sites/index.ts'
import search from './modules/search/index.ts'
import layout from './modules/layout/index.ts'
import mapSources from './modules/map-sources/index.ts'
import userlayers from './modules/userlayers/index.ts'
import details from './modules/details/index.ts'
import grid from './modules/grid/index.ts'
import satellite from './modules/satellite/index.ts'
import status from './modules/status/index.ts'
import account from './modules/account/index.ts'
import coordinates from './modules/coordinates/index.ts'
import print from './modules/print/index.ts'
import translations from './locales/en.json'
import './fork.css'

const MODULES: ForkModule[] = [
  satellite,
  mapSources,
  extra,
  sites,
  // Before search: its search results' descriptions come first.
  status,
  search,
  details,
  grid,
  coordinates,
  layout,
  userlayers,
  // After layout: their header links go after Settings.
  print,
  account
]

let context: ForkContext | undefined

/** English strings for the fork, added to upstream's (index.ts, after i18next starts). */
export function addForkTranslations() {
  i18next.addResourceBundle('en', 'translation', translations, true, true)
}

/** style.ts: sources. */
export function forkSources(): Record<string, SourceSpecification> {
  return Object.assign({}, ...MODULES.map((m) => m.sources?.() ?? {}))
}

/** style.ts getPrimaryLayers: data layers. */
export function forkLayers(): LayerSpecificationWithZIndex[] {
  return MODULES.flatMap((m) => m.layers?.() ?? [])
}

/** openinframap.ts: layer switcher groups. */
export function forkSwitcherGroups(): LayerGroup[] {
  return MODULES.flatMap((m) => m.switcherGroups?.() ?? [])
}

/** openinframap.ts: once the map and its controls exist, before clicks are routed. */
export function forkInit(ctx: ForkContext) {
  context = ctx
  // The left column and its details panel, before the modules that use them.
  leftColumn.attach(ctx.map)
  // Who has the map (measuring, drawing), before the modules that take it.
  mapMode.install(ctx.map, ctx.clickRouter)
  for (const m of MODULES) m.init?.(ctx)
}

/** key/key.ts: once upstream's sections are in the pane. */
export async function forkKey(map: Map, container: HTMLElement, pane: HTMLElement) {
  const sections = (await Promise.all(MODULES.map((m) => m.key?.() ?? []))).flat()
  await extendKey(map, container, pane, sections)
}

function first<T>(fn: (m: ForkModule) => T | undefined): T | undefined {
  for (const m of MODULES) {
    const value = fn(m)
    if (value !== undefined) return value
  }
  return undefined
}

/** popup/infopopup.ts. */
export const forkPopup = {
  hiddenKeys: (): string[] => MODULES.flatMap((m) => m.popup?.hiddenKeys ?? []),
  renderKey: (key: string, value: unknown) => first((m) => m.popup?.renderKey?.(key, value)),
  title: (feature: MapGeoJSONFeature) => first((m) => m.popup?.title?.(feature)),
  html: (feature: MapGeoJSONFeature) => first((m) => m.popup?.html?.(feature)),
  open: (feature: MapGeoJSONFeature): boolean => first((m) => m.popup?.open?.(feature) || undefined) ?? false
}

/** search/openinframap.ts: the description of a backend result. */
export function forkSearchDescription(result: BackendSearchResult): string | undefined {
  return first((m) => m.searchDescription?.(result))
}

/** search/search.ts: a result was picked. */
export function forkSearchSelected(result: SearchResult) {
  if (!context) return
  for (const m of MODULES) m.searchSelected?.(result, context)
}

/** search/search.ts: the modules' search providers (Photon, grid references...). */
export function forkSearchProviders(language: string): ISearchProvider[] {
  return MODULES.flatMap((m) => m.searchProviders?.(language) ?? [])
}

/** search/search.ts: merging results found twice. */
export { dropDuplicates } from './modules/search/index.ts'
