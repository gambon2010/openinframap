// Fork: pieces of MapLibre styles shared by modules (no UI).
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  LineLayerSpecification
} from 'maplibre-gl'

/** A filter: features of these geometry types ('Point', 'LineString', 'Polygon'...). */
export function geometryIs(...types: string[]): ExpressionSpecification {
  return ['in', ['geometry-type'], ['literal', types]] as ExpressionSpecification
}

/** Where an area's or a line's features come from (a vector source's layer). */
export interface FeatureSource {
  source: string
  sourceLayer: string
  filter?: FilterSpecification
  minzoom?: number
  maxzoom?: number
}

type Layer<T> = T & { zorder: number }

/**
 * An area drawn as its outline, clickable anywhere inside: an invisible fill
 * (`<id>_hit`, what clicks and the copy tool find) and the outline (`<id>`). For
 * buildings, sites without a fill of their own, anything whose inside should
 * count as a click. Name the layers so a layer-switcher prefix covers both.
 */
export function clickableArea(
  id: string,
  from: FeatureSource,
  zorder: number,
  outline: LineLayerSpecification['paint']
): [Layer<FillLayerSpecification>, Layer<LineLayerSpecification>] {
  const common = {
    source: from.source,
    'source-layer': from.sourceLayer,
    ...(from.filter ? { filter: from.filter } : {}),
    ...(from.minzoom !== undefined ? { minzoom: from.minzoom } : {}),
    ...(from.maxzoom !== undefined ? { maxzoom: from.maxzoom } : {})
  }
  return [
    // Not drawn (opacity 0), still found by clicks.
    {
      id: `${id}_hit`,
      type: 'fill',
      zorder,
      ...common,
      paint: { 'fill-color': '#000000', 'fill-opacity': 0 }
    },
    { id, type: 'line', zorder: zorder + 0.01, ...common, layout: { 'line-join': 'round' }, paint: outline }
  ]
}

/** A thin line made easy to click: an invisible wide line under it (`<id>_hit`). */
export function hitLine(
  id: string,
  from: FeatureSource,
  zorder: number,
  width = 12
): Layer<LineLayerSpecification> {
  return {
    id: `${id}_hit`,
    type: 'line',
    zorder,
    source: from.source,
    'source-layer': from.sourceLayer,
    ...(from.filter ? { filter: from.filter } : {}),
    ...(from.minzoom !== undefined ? { minzoom: from.minzoom } : {}),
    paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': width }
  }
}
