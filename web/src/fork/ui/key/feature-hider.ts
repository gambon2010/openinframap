// Fork: hide kinds of features from the map, from the key.
//
// A key row says what it shows by its colour, its icon or its layers. To hide
// it, every layer drawing that colour (or icon) gets a filter keeping only the
// features it would draw differently, and the other layers of the same data
// (casings, outlines, labels, click targets) get the same filter. Filters, not
// visibility, so this works alongside the layer switcher.
import { Map as MapLibreMap, FilterSpecification, ExpressionSpecification } from 'maplibre-gl'

export type HideSpec =
  | { colour: string; types?: string[] } // layers of these types (default: line) drawn in this colour
  | { icon: string } // symbol layers showing this sprite
  | { layers: string[] } // layers whose id starts with one of these

type StyleLayer = {
  id: string
  type: string
  source?: string
  'source-layer'?: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

const STORAGE_KEY = 'oim-key-hidden'

export function specKey(spec: HideSpec): string {
  return JSON.stringify(spec)
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
  // Rows that matched no layer, for debugging the key.
  unmatched = new Set<string>()

  constructor(map: MapLibreMap) {
    this.map = map
    this.hidden = new Set(this.load())
    // A new style (e.g. another background map) drops the filters: re-apply them.
    map.on('style.load', () => {
      this.originals.clear()
      this.apply()
    })
  }

  load(): string[] {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.hidden]))
    } catch {
      // Private window or blocked storage: the choice just isn't remembered.
    }
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

  showAll() {
    this.hidden.clear()
    this.save()
    this.apply()
  }

  /** The conditions a spec adds to each layer, as "keep the feature if…". */
  conditions(spec: HideSpec, layers: StyleLayer[]): Map<string, ExpressionSpecification | false> {
    const result = new Map<string, ExpressionSpecification | false>()
    if ('layers' in spec) {
      for (const layer of layers) {
        if (spec.layers.some((prefix) => layer.id.startsWith(prefix))) result.set(layer.id, false)
      }
      return result
    }

    const value = 'colour' in spec ? spec.colour : spec.icon
    const types = 'colour' in spec ? spec.types || ['line'] : ['symbol']
    const property = (layer: StyleLayer) =>
      'colour' in spec ? layer.paint?.[`${layer.type}-color`] : layer.layout?.['icon-image']

    // Layers drawing this colour/icon, and the expression choosing it for each feature.
    const primaries: { layer: StyleLayer; expr: unknown }[] = []
    for (const layer of layers) {
      if (!types.includes(layer.type)) continue
      const expr = withoutZoom(property(layer))
      if (expr !== undefined && JSON.stringify(expr).includes(JSON.stringify(value))) {
        primaries.push({ layer, expr })
      }
    }
    for (const { layer, expr } of primaries) {
      result.set(layer.id, expr === value ? false : (['!=', expr, value] as ExpressionSpecification))
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
        result.set(other.id, ['!=', expr, value] as ExpressionSpecification)
      }
    }
    return result
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
}
