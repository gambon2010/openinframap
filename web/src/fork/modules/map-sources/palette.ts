// Fork: the background map's colours. Upstream's style (style/style_base.ts) draws
// most areas at the same lightness from zoom 6 on (93%), told apart only by a faint
// tint: fields, parks and grass are even one colour, and towns, industry and
// hospitals another. Here every kind of area has its own shade, still pale and
// washed out (low saturation, light), so where a town, a wood or a field stops
// shows: one palette, set on upstream's layers (a paint override; its file
// unchanged). Zoomed out (zoom 2 to 6) each is a little darker, as upstream's are.
// Buildings are darker than the towns around them; airports light, so their
// runways (drawn in the major roads' grey) stand out. It's the "high contrast"
// choice in Settings → Background (services/map-colours.ts); "original colours"
// puts upstream's back as they were.
import type { ExpressionSpecification, Map } from 'maplibre-gl'
import { MapColours, mapColours } from '../../services/map-colours.ts'

/** Each kind of area: [hue, saturation %, lightness % from zoom 6]. */
export const PALETTE = {
  land: [42, 12, 94], // nothing mapped
  fields: [55, 22, 91], // farmland: pale straw
  green: [95, 25, 88], // grass, meadows, parks, orchards, cemeteries
  wood: [110, 22, 84], // woods and forests
  housing: [240, 6, 89], // residential: cool grey
  industry: [260, 9, 87], // industrial, commercial: mauve-grey
  airport: [220, 8, 93], // airports: light, their runways grey on it
  care: [345, 14, 90], // hospitals, universities: pale rose
  farmyard: [35, 18, 88], // farm buildings: pale tan
  water: [207, 30, 82],
  sand: [48, 35, 88],
  ice: [190, 25, 94]
} as const satisfies Record<string, readonly [number, number, number]>

type Shade = keyof typeof PALETTE

/** How much darker zoomed right out (zoom 2), against zoom 6 and closer. */
const ZOOMED_OUT_DARKER = 8

function hsl(shade: Shade, darker = 0): string {
  const [h, s, l] = PALETTE[shade]
  return `hsl(${h}, ${s}%, ${l - darker}%)`
}

/** A colour by zoom: a little darker zoomed out. */
export function colour(shade: Shade): ExpressionSpecification {
  return ['interpolate-lab', ['linear'], ['zoom'], 2, hsl(shade, ZOOMED_OUT_DARKER), 6, hsl(shade)]
}

/** A colour by the feature's kind (others: `fallback`), by zoom. */
export function colourByKind(kinds: Record<string, Shade>, fallback: Shade): ExpressionSpecification {
  const at = (darker: number): ExpressionSpecification =>
    [
      'match',
      ['get', 'kind'],
      ...Object.entries(kinds).flatMap(([kind, shade]) => [kind, hsl(shade, darker)]),
      hsl(fallback, darker)
    ] as unknown as ExpressionSpecification
  return ['interpolate-lab', ['linear'], ['zoom'], 2, at(ZOOMED_OUT_DARKER), 6, at(0)]
}

/** Upstream's layers and the colour each gets: [layer, paint property, colour]. */
export function paletteLayers(): [
  string,
  'fill-color' | 'line-color' | 'background-color',
  ExpressionSpecification
][] {
  const green = colourByKind({ farmland: 'fields' }, 'green')
  const builtUp = colourByKind(
    {
      residential: 'housing',
      commercial: 'industry',
      industrial: 'industry',
      aerodrome: 'airport',
      hospital: 'care',
      university: 'care',
      farmyard: 'farmyard',
      urban_area: 'housing'
    },
    'housing'
  )
  return [
    ['osm_background', 'background-color', colour('land')],
    ['osm_landuse_ice', 'fill-color', colour('ice')],
    ['osm_landcover_ice', 'fill-color', colour('ice')],
    ['osm_landuse_sand', 'fill-color', colour('sand')],
    ['osm_landcover_sand', 'fill-color', colour('sand')],
    ['osm_landuse_green', 'fill-color', green],
    ['osm_landcover_green', 'fill-color', green],
    ['osm_landuse_wood', 'fill-color', colour('wood')],
    ['osm_landcover_wood', 'fill-color', colour('wood')],
    ['osm_landuse_urban', 'fill-color', builtUp],
    ['osm_landcover_urban', 'fill-color', builtUp],
    ['osm_water', 'fill-color', colour('water')],
    ['osm_water_stream', 'line-color', colour('water')],
    ['osm_water_river', 'line-color', colour('water')],
    ['osm_buildings', 'fill-color', BUILDINGS]
  ]
}

/** Buildings: upstream's warm pinkish beige, a little darker than upstream's so they
 * stand out of the towns they're in (housing 89%), more so closer in. */
export const BUILDINGS: ExpressionSpecification = [
  'interpolate-lab',
  ['linear'],
  ['zoom'],
  12,
  'hsl(32, 14%, 87%)',
  16,
  'hsl(32, 15%, 81%)'
]

export function backgroundPalette(map: Map) {
  // Upstream's values, kept when the palette replaces them (each style load).
  let original: [string, 'fill-color' | 'line-color' | 'background-color', ExpressionSpecification][] = []
  const apply = (colours: MapColours) => {
    if (colours === 'contrast') {
      original = []
      for (const [id, property, value] of paletteLayers()) {
        if (!map.getLayer(id)) continue
        original.push([id, property, map.getPaintProperty(id, property) as ExpressionSpecification])
        map.setPaintProperty(id, property, value)
      }
    } else {
      for (const [id, property, value] of original)
        if (map.getLayer(id)) map.setPaintProperty(id, property, value)
      original = []
    }
  }
  // A new style has upstream's colours again.
  map.on('style.load', () => {
    original = []
    if (mapColours.get() === 'contrast') apply('contrast')
  })
  if (map.isStyleLoaded() && mapColours.get() === 'contrast') apply('contrast')
  mapColours.onChange(apply)
}
