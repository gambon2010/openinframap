// Fork: My layers' map layers, as MapLibre style definitions (pure: render.ts adds
// them): each layer's own (fills, lines, icons, labels), the tactical graphics', the
// copies' (clones of upstream's layers), power supply colours, measurements, and the
// selection, draft and placing overlays.
import { FilterSpecification, LayerSpecification } from 'maplibre-gl'
import { LayerSpecificationWithZIndex } from '../../../../style/types.ts'
import { font, text_paint } from '../../../../style/common.ts'
import { DEFAULT_COLOR, UserLayer } from '../model/model.ts'
import { SUPPLY_COLOURS, supplyColours } from '../../../services/supply.ts'
import {
  DRAFT,
  GHOST,
  HANDLE,
  HIGHLIGHT,
  LINE_OR_POLYGON,
  MEASURE_LABEL_LAYOUT,
  OWN,
  POINT,
  POLYGON,
  SELECTION
} from './render.constants.ts'

export function sourceId(layerId: string) {
  return `user_${layerId}`
}

export function graphicsSourceId(layerId: string) {
  return `user_${layerId}_g`
}

export function measureSourceId(layerId: string) {
  return `user_${layerId}_m`
}

/** The pieces of the highlighted items a glow goes under: a graphic's lines and
 * outlines; a measurement's lines and rings, not its tick marks. */
export function highlightFilter(of: 'graphic' | 'measure', highlighted: string[]): FilterSpecification {
  const ids = ['in', ['get', 'fid'], ['literal', highlighted]]
  return (of === 'graphic'
    ? ['all', LINE_OR_POLYGON, ids]
    : [
        'all',
        ['==', ['geometry-type'], 'LineString'],
        ['!', ['has', 'tick']],
        ids
      ]) as unknown as FilterSpecification
}

export function ownLayers(layer: UserLayer): LayerSpecification[] {
  const source = sourceId(layer.id)
  const color = ['coalesce', ['get', 'color'], DEFAULT_COLOR]
  return [
    // Items in conflict: an orange dashed ring or outline, under the item.
    {
      id: `${source}_conflict_line`,
      type: 'line',
      source,
      filter: ['all', ['has', 'conflict'], LINE_OR_POLYGON],
      paint: { 'line-color': '#e8590c', 'line-width': 8, 'line-dasharray': [1, 1], 'line-opacity': 0.8 }
    },
    {
      id: `${source}_conflict_point`,
      type: 'circle',
      source,
      filter: ['all', ['has', 'conflict'], POINT],
      paint: {
        'circle-radius': 22,
        'circle-opacity': 0,
        'circle-stroke-color': '#e8590c',
        'circle-stroke-width': 3
      }
    },
    {
      id: `${source}_fill`,
      type: 'fill',
      source,
      filter: ['all', POLYGON, OWN],
      paint: { 'fill-color': color, 'fill-opacity': 0.2 }
    },
    {
      id: `${source}_line`,
      type: 'line',
      source,
      filter: ['all', LINE_OR_POLYGON, OWN],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': color, 'line-width': ['coalesce', ['get', 'width'], 3] }
    },
    {
      id: `${source}_symbol`,
      type: 'symbol',
      source,
      filter: ['all', POINT, OWN],
      layout: {
        'icon-image': ['coalesce', ['get', 'icon'], ''],
        'icon-size': ['coalesce', ['get', 'size'], 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-font': font,
        'text-size': 12,
        'text-offset': [0, 1.6],
        'text-anchor': 'top',
        'text-optional': true
      },
      paint: text_paint
    }
  ] as LayerSpecification[]
}

export function graphicLayers(layer: UserLayer, highlighted: string[]): LayerSpecification[] {
  return graphicSpecs(graphicsSourceId(layer.id), DEFAULT_COLOR, 1, highlighted)
}

/** The map layers a graphic's pieces are drawn with (graphics.ts renderGraphic):
 * fills, a casing, lines in their colour (else `colour`), labels; faint for a
 * preview (opacity). */
export function graphicSpecs(
  source: string,
  colour: string,
  opacity = 1,
  highlighted: string[] = []
): LayerSpecification[] {
  // The selected graphics glow under their own lines (not for a preview).
  const highlight: LayerSpecification[] =
    opacity === 1
      ? [
          {
            id: `${source}_highlight`,
            type: 'line',
            source,
            filter: highlightFilter('graphic', highlighted),
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': HIGHLIGHT,
              'line-width': ['+', ['coalesce', ['get', 'width'], 2], 10],
              'line-opacity': 0.6
            }
          } as LayerSpecification
        ]
      : []
  return [
    ...highlight,
    {
      id: `${source}_fill`,
      type: 'fill',
      source,
      filter: ['all', POLYGON, ['!=', ['get', 'fill'], null]],
      paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['*', ['get', 'fillOpacity'], opacity] }
    },
    {
      id: `${source}_casing`,
      type: 'line',
      source,
      filter: ['all', LINE_OR_POLYGON, ['!=', ['get', 'casing'], null]],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['get', 'casing'],
        'line-width': ['+', ['get', 'width'], 2],
        'line-opacity': 0.8 * opacity
      }
    },
    {
      id: `${source}_line`,
      type: 'line',
      source,
      filter: LINE_OR_POLYGON,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['coalesce', ['get', 'stroke'], colour],
        'line-width': ['get', 'width'],
        'line-opacity': opacity
      }
    },
    {
      id: `${source}_label`,
      type: 'symbol',
      source,
      filter: POINT,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': font,
        'text-size': 15,
        'text-rotate': ['get', 'angle'],
        'text-rotation-alignment': 'map',
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': ['coalesce', ['get', 'halo'], '#ffffff'],
        'text-halo-width': 2,
        'text-opacity': opacity
      }
    }
  ] as LayerSpecification[]
}

/** Power supply mode: copies of power lines, substations and plants in their
 * original's colour (ui/supply.ts), over their own look; nothing while it's off. */
export function supplyLayers(layer: UserLayer): LayerSpecification[] {
  if (!supplyColours.active) return []
  const source = sourceId(layer.id)
  const colour = [
    'match',
    ['get', 'supply'],
    'red',
    SUPPLY_COLOURS.red,
    'orange',
    SUPPLY_COLOURS.orange,
    'risk',
    SUPPLY_COLOURS.risk,
    SUPPLY_COLOURS.green
  ] as unknown as string
  return [
    {
      id: `${source}__supply_line`,
      type: 'line',
      source,
      filter: ['all', ['has', 'supply'], LINE_OR_POLYGON] as FilterSpecification,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colour, 'line-width': 5 }
    },
    {
      id: `${source}__supply_point`,
      type: 'circle',
      source,
      filter: ['all', ['has', 'supply'], POINT] as FilterSpecification,
      paint: {
        'circle-color': colour,
        'circle-radius': 9,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2
      }
    }
  ]
}

/** Upstream's layers for the data copies came from, drawing the copies instead. */
export function copyLayers(
  layer: UserLayer,
  primaryLayers: () => LayerSpecificationWithZIndex[]
): LayerSpecification[] {
  const keys = new Set<string>()
  for (const f of layer.features.values()) {
    const copy = f.properties.copy
    if (copy) keys.add(`${copy.source}/${copy.sourceLayer}`)
  }
  if (!keys.size) return []
  const source = sourceId(layer.id)
  const clones: LayerSpecification[] = []
  for (const original of primaryLayers()) {
    if (!('source-layer' in original) || original.id.startsWith('user_')) continue
    const key = `${original.source}/${original['source-layer']}`
    if (!keys.has(key)) continue
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { zorder, minzoom, maxzoom, 'source-layer': _sourceLayer, ...rest } = original
    // A copy stays at every zoom: the original's "only once zoomed in" conditions
    // (small plants, low voltages) are left out; its other ones (a point while
    // zoomed out, an area closer) are kept.
    const filter = (
      original.filter
        ? ['all', ['==', ['get', 'copy_key'], key], withoutMinZoom(original.filter)]
        : ['==', ['get', 'copy_key'], key]
    ) as FilterSpecification
    clones.push({
      ...rest,
      id: `${source}__${original.id}`,
      source,
      filter,
      layout: { ...(original.layout ?? {}), visibility: 'visible' }
    } as LayerSpecification)
  }
  return clones
}

export function measureLayers(layer: UserLayer, highlighted: string[]): LayerSpecification[] {
  const source = measureSourceId(layer.id)
  const color = ['get', 'color']
  return [
    {
      // A selected measurement glows under its lines and rings, like a line.
      id: `${source}_highlight`,
      type: 'line',
      source,
      filter: highlightFilter('measure', highlighted),
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': HIGHLIGHT, 'line-width': 12, 'line-opacity': 0.6 }
    },
    {
      id: `${source}_fill`,
      type: 'fill',
      source,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': color, 'fill-opacity': 0.12 }
    },
    // The lines and their marks (ticks: thinner) in one layer.
    {
      id: `${source}_line`,
      type: 'line',
      source,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': color,
        'line-width': ['match', ['coalesce', ['get', 'tick'], ''], 'major', 2, 'minor', 1.2, 2.5]
      }
    },
    {
      id: `${source}_vertex`,
      type: 'circle',
      source,
      filter: ['==', ['get', 'vertex'], true],
      paint: {
        'circle-radius': 4,
        'circle-color': '#fff',
        'circle-stroke-color': color,
        'circle-stroke-width': 2
      }
    },
    // Lengths and bearings (along their leg, above it), the total, the marks'
    // distances (under the line, smaller, in its colour): measure/features.ts.
    {
      id: `${source}_label`,
      type: 'symbol',
      source,
      filter: ['any', ['has', 'label'], ['has', 'tickLabel']],
      layout: MEASURE_LABEL_LAYOUT,
      paint: {
        'text-color': ['case', ['has', 'tickLabel'], color, '#222'],
        'text-halo-color': '#fff',
        'text-halo-width': 2
      }
    }
  ] as unknown as LayerSpecification[]
}

/** The selection, draft and placing overlays' map layers (Renderer.ensureOverlays). */
export function overlayLayers(): LayerSpecification[] {
  return [
    {
      id: `${SELECTION}_line`,
      type: 'line',
      source: SELECTION,
      paint: {
        'line-color': HIGHLIGHT,
        // A picture, symbol or marker: a thin box around it.
        'line-width': ['case', ['==', ['get', 'outline'], true], 3, 8],
        'line-opacity': ['case', ['==', ['get', 'outline'], true], 1, 0.6]
      }
    },
    {
      // The points of a selected line, area or graphic: drag one to move it.
      id: `${SELECTION}_vertex`,
      type: 'circle',
      source: SELECTION,
      filter: ['all', POINT, ['==', ['get', 'vertex'], true]] as FilterSpecification,
      paint: {
        'circle-radius': 6,
        'circle-color': '#fff',
        'circle-stroke-color': HANDLE,
        'circle-stroke-width': 2
      }
    },
    {
      // Drag it to resize a picture, symbol or marker.
      id: `${SELECTION}_resize`,
      type: 'circle',
      source: SELECTION,
      filter: ['==', ['get', 'resize'], true],
      paint: {
        'circle-radius': 6,
        'circle-color': '#fff',
        'circle-stroke-color': HANDLE,
        'circle-stroke-width': 2
      }
    },
    {
      id: `${SELECTION}_point`,
      type: 'circle',
      source: SELECTION,
      filter: [
        'all',
        POINT,
        ['!=', ['get', 'vertex'], true],
        ['!=', ['get', 'resize'], true]
      ] as FilterSpecification,
      paint: {
        'circle-radius': 22,
        'circle-color': 'rgba(255, 214, 0, 0.15)',
        'circle-stroke-color': HIGHLIGHT,
        'circle-stroke-width': 3
      }
    },
    {
      id: `${DRAFT}_line`,
      type: 'line',
      source: DRAFT,
      paint: { 'line-color': '#1565c0', 'line-width': 3, 'line-dasharray': [2, 1] }
    },
    {
      id: `${DRAFT}_point`,
      type: 'circle',
      source: DRAFT,
      filter: ['all', POINT, ['!', ['has', 'label']], ['!', ['has', 'tickLabel']]] as FilterSpecification,
      paint: {
        'circle-radius': 5,
        'circle-color': '#fff',
        'circle-stroke-color': '#1565c0',
        'circle-stroke-width': 2
      }
    },
    {
      // What a placing tool would put down, faint, under the cursor.
      id: GHOST,
      type: 'symbol',
      source: GHOST,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['coalesce', ['get', 'size'], 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      paint: { 'icon-opacity': 0.55 }
    },
    {
      // A measurement being drawn: its lengths and bearings so far.
      id: `${DRAFT}_label`,
      type: 'symbol',
      source: DRAFT,
      filter: ['has', 'label'],
      layout: MEASURE_LABEL_LAYOUT,
      paint: { 'text-color': '#1565c0', 'text-halo-color': '#fff', 'text-halo-width': 2 }
    }
  ]
}

const isZoom = (e: unknown) => Array.isArray(e) && e.length === 1 && e[0] === 'zoom'

/** A filter with its minimum-zoom conditions (zoom > n, zoom >= n, n < zoom,
 * n <= zoom) always true; the rest unchanged. */
export function withoutMinZoom<T>(filter: T): T {
  if (!Array.isArray(filter)) return filter
  const [op, a, b] = filter as unknown[]
  if (filter.length === 3) {
    if ((op === '>' || op === '>=') && isZoom(a) && typeof b === 'number') return true as T
    if ((op === '<' || op === '<=') && typeof a === 'number' && isZoom(b)) return true as T
  }
  return filter.map((part) => withoutMinZoom(part)) as T
}
