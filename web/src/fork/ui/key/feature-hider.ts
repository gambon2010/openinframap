// Fork: hide kinds of features from the map, from the key.
//
// A key row says what it shows by its colour, its icon or its layers. To hide
// it, every layer drawing that colour (or icon) gets a filter keeping only the
// features it would draw differently, and the other layers of the same data
// (casings, outlines, labels, click targets) get the same filter. Filters, not
// visibility, so this works alongside the layer switcher. Layers of groups drawn
// with a count (counted-groups.ts) count only the kinds shown.
import { Map as MapLibreMap, FilterSpecification, ExpressionSpecification } from 'maplibre-gl'
import { readJson, writeJson } from '../../core/storage.ts'
import { countsHidden, countsOf, shownCount, withCount } from './counted-groups.ts'

export type HideSpec =
  | { colour: string; types?: string[] } // layers of these types (default: line) drawn in this colour
  | { icon: string | string[] } // symbol layers showing this sprite (or these)
  | { layers: string[] } // layers whose id starts with one of these

export type StyleLayer = {
  id: string
  type: string
  source?: string
  'source-layer'?: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
  metadata?: unknown
}

type LayoutProperty = Parameters<MapLibreMap['setLayoutProperty']>[1]
type LayoutValue = Parameters<MapLibreMap['setLayoutProperty']>[2]

const STORAGE_KEY = 'oim-key-hidden'
// The rows hidden at first already hidden once: after that, the user's choice stays.
const HIDDEN_ONCE_KEY = 'oim-key-hidden-once'

export function specKey(spec: HideSpec): string {
  return JSON.stringify(spec)
}

/** The colour or icons a row hides. */
function hiddenValues(spec: { colour: string } | { icon: string | string[] }): string[] {
  return 'colour' in spec ? [spec.colour] : [spec.icon].flat()
}

// The part of an expression that doesn't depend on zoom (filters can't use zoom):
// step(zoom, X, ...) shows X up to some zoom level, so X is what the layer draws.
function withoutZoom(expr: unknown): unknown {
  if (expr === undefined) return undefined
  if (Array.isArray(expr) && expr[0] === 'step' && JSON.stringify(expr[1]) === '["zoom"]') {
    return withoutZoom(expr[2])
  }
  return JSON.stringify(expr).includes('"zoom"') ? undefined : expr
}

export class FeatureHider {
  map: MapLibreMap
  hidden: Set<string>
  originals = new Map<string, FilterSpecification | undefined>()
  /** Group layers' layout values that read the count, as the style gave them. */
  originalLayouts = new Map<string, Record<string, unknown>>()
  // Rows that matched no layer, for debugging the key.
  unmatched = new Set<string>()

  constructor(map: MapLibreMap) {
    this.map = map
    this.hidden = new Set(this.load())
    // A new style (e.g. another background map) drops the filters: re-apply them.
    map.on('style.load', () => {
      this.originals.clear()
      this.originalLayouts.clear()
      this.apply()
    })
  }

  load(): string[] {
    const saved = readJson<unknown>(STORAGE_KEY, [])
    return Array.isArray(saved) ? saved : []
  }

  save() {
    writeJson(STORAGE_KEY, [...this.hidden])
  }

  isHidden(spec: HideSpec): boolean {
    return this.hidden.has(specKey(spec))
  }

  setHidden(spec: HideSpec, hidden: boolean) {
    if (hidden) this.hidden.add(specKey(spec))
    else this.hidden.delete(specKey(spec))
    this.save()
    this.apply()
  }

  /** A row hidden until the user shows it: hidden the first time it's met. */
  hideAtFirst(spec: HideSpec) {
    const once = new Set(readJson<string[]>(HIDDEN_ONCE_KEY, []))
    if (once.has(specKey(spec))) return
    once.add(specKey(spec))
    writeJson(HIDDEN_ONCE_KEY, [...once])
    this.setHidden(spec, true)
  }

  showAll() {
    this.hidden.clear()
    this.save()
    this.apply()
  }

  /** The conditions a spec adds to each layer, as "keep the feature if…". */
  conditions(spec: HideSpec, layers: StyleLayer[]): Map<string, ExpressionSpecification | false> {
    return specConditions(spec, layers)
  }

  apply() {
    const style = this.map.getStyle()
    if (!style?.layers) return
    // "My layers" (fork/userlayers, ids user_...) are never hidden from the key:
    // copies of map features stay visible when their kind is hidden.
    const layers = (style.layers as unknown as StyleLayer[]).filter((layer) => !layer.id.startsWith('user_'))
    for (const layer of layers) {
      if (!this.originals.has(layer.id))
        this.originals.set(layer.id, this.map.getFilter(layer.id) ?? undefined)
    }

    const added = new Map<string, (ExpressionSpecification | false)[]>()
    this.unmatched.clear()
    for (const key of this.hidden) {
      const conditions = this.conditions(JSON.parse(key), layers)
      if (conditions.size === 0) this.unmatched.add(key)
      for (const [id, condition] of conditions) {
        added.set(id, [...(added.get(id) || []), condition])
      }
    }

    for (const [id, condition] of this.countGroups(layers))
      added.set(id, [...(added.get(id) || []), condition])

    for (const layer of layers) {
      const original = this.originals.get(layer.id)
      const extra = added.get(layer.id)
      const filter = extra
        ? (['all', ...(original !== undefined ? [original] : []), ...extra] as unknown as FilterSpecification)
        : original
      if (JSON.stringify(filter) !== JSON.stringify(this.map.getFilter(layer.id) ?? undefined)) {
        this.map.setFilter(layer.id, filter ?? null)
      }
    }
    if (import.meta.env.DEV && this.unmatched.size) {
      console.warn('Key rows matching no map layer:', [...this.unmatched])
    }
  }

  /** Group layers counting a hidden kind: their count of the kinds shown (layout),
   * and the condition keeping groups with some; the others as the style gave them. */
  countGroups(layers: StyleLayer[]): Map<string, ExpressionSpecification> {
    const hiddenIcons = new Set<string>()
    for (const key of this.hidden) {
      const spec = JSON.parse(key) as HideSpec
      if ('icon' in spec) hiddenValues(spec).forEach((icon) => hiddenIcons.add(icon))
    }
    const conditions = new Map<string, ExpressionSpecification>()
    for (const layer of layers) {
      const counts = countsOf(layer)
      if (!counts) continue
      if (!this.originalLayouts.has(layer.id)) this.originalLayouts.set(layer.id, { ...layer.layout })
      const original = this.originalLayouts.get(layer.id) ?? {}
      const hiding = countsHidden(counts, hiddenIcons)
      const count = shownCount(counts, hiddenIcons)
      for (const [property, value] of Object.entries(original)) {
        if (!JSON.stringify(value).includes('"count')) continue
        const shown = hiding ? withCount(value, count) : value
        const name = property as LayoutProperty
        if (JSON.stringify(this.map.getLayoutProperty(layer.id, name)) !== JSON.stringify(shown))
          this.map.setLayoutProperty(layer.id, name, shown as LayoutValue)
      }
      if (hiding) conditions.set(layer.id, ['>', count, 0])
    }
    return conditions
  }
}

/** The conditions a spec adds to each layer, as "keep the feature if…" (false: the
 * whole layer goes). Also what a key row draws: ui/key/legend.ts. */
export function specConditions(
  spec: HideSpec,
  layers: StyleLayer[]
): Map<string, ExpressionSpecification | false> {
  const result = new Map<string, ExpressionSpecification | false>()
  if ('layers' in spec) {
    for (const layer of layers) {
      if (spec.layers.some((prefix) => layer.id.startsWith(prefix))) result.set(layer.id, false)
    }
    return result
  }

  const values = hiddenValues(spec)
  const keep = (expr: unknown): ExpressionSpecification =>
    values.length === 1
      ? (['!=', expr, values[0]] as ExpressionSpecification)
      : (['all', ...values.map((value) => ['!=', expr, value])] as ExpressionSpecification)
  const types = 'colour' in spec ? spec.types || ['line'] : ['symbol']
  const property = (layer: StyleLayer) =>
    'colour' in spec ? layer.paint?.[`${layer.type}-color`] : layer.layout?.['icon-image']

  // Layers drawing this colour/icon, and the expression choosing it for each feature.
  const primaries: { layer: StyleLayer; expr: unknown }[] = []
  for (const layer of layers) {
    if (!types.includes(layer.type)) continue
    const expr = withoutZoom(property(layer))
    const draws = (value: string) => JSON.stringify(expr).includes(JSON.stringify(value))
    if (expr !== undefined && values.some(draws)) primaries.push({ layer, expr })
  }
  for (const { layer, expr } of primaries) {
    const drawsOnlyHidden = typeof expr === 'string' && values.includes(expr)
    result.set(layer.id, drawsOnlyHidden ? false : keep(expr))
  }

  // The same data's other layers. Only where the colour/icon depends on the
  // feature: a layer that draws everything in one colour says nothing about
  // which of its source's features to hide.
  for (const { layer, expr } of primaries) {
    if (typeof expr === 'string') continue
    for (const other of layers) {
      if (
        result.has(other.id) ||
        other.source !== layer.source ||
        other['source-layer'] !== layer['source-layer'] ||
        // An icon row leaves other icon layers alone (towers vs poles share their data).
        ('icon' in spec && other.layout?.['icon-image'] !== undefined)
      ) {
        continue
      }
      result.set(other.id, keep(expr))
    }
  }
  return result
}
