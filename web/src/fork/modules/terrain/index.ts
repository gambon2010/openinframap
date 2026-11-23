// Fork: the terrain (docs/plans/terrain.md): the elevations of every area downloaded
// (the backend's /terrain tiles) as map sources, for the hill shading and contour
// lines drawn here (Data layers → Terrain: Hill shading, on at first, and Contour
// lines, made by the backend; their looks: docs/STYLE.md), the 3D view's relief
// (modules/view3d), and a clicked thing's height in its details (details.ts).
import type { Map, RasterDEMSourceSpecification } from 'maplibre-gl'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { CONTOURS_URL, TERRAIN_URL } from '../../config.ts'
import {
  HILLSHADE_SWITCHER_ID,
  RELIEF_SOURCE,
  RELIEF_SWITCHER_ID,
  TERRAIN_SOURCE
} from '../../core/terrain.ts'
import { background, followBackground } from '../../services/background.ts'
import { addDetailsExtra } from '../../ui/details.ts'
import { ForkModule } from '../../types.ts'
import { CONTOUR_LAYERS, CONTOUR_LINE_LAYERS, LABEL_LAYER, contourLayers } from './contours.ts'
import { heightRow } from './details.ts'
import { contoursKey } from './key.ts'
import { shadingBefore } from './placement.ts'
import {
  CONTOURS_MAX_ZOOM,
  CONTOURS_MIN_ZOOM,
  CONTOURS_PREFIX,
  CONTOURS_SOURCE,
  CONTOURS_SWITCHER_ID,
  CONTOUR_COLOUR,
  HIGHLIGHT_COLOUR,
  HILLSHADE_LAYER,
  LIGHT_DIRECTIONS,
  SHADOW_COLOUR,
  STRENGTH,
  TERRAIN_MAX_ZOOM,
  TERRAIN_TILE_SIZE
} from './terrain.constants.ts'

const CREDIT =
  'Terrain: <a href="https://mapterhorn.com">Mapterhorn</a>, IGN (RGE ALTI, LiDAR HD), Copernicus DEM'

/** The Contour lines entry's name (its key section takes it, to unfold under it). */
const contoursName = () => t('layers.contours', 'Contour lines')

/** A source of the terrain's elevations (Mapterhorn's tiles: Terrarium, 512 pixels). */
const elevations: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: [TERRAIN_URL],
  encoding: 'terrarium',
  tileSize: TERRAIN_TILE_SIZE,
  maxzoom: TERRAIN_MAX_ZOOM,
  attribution: CREDIT
}

/** Moves the terrain's layers to their places: the hill shading on the ground for the
 * background shown (placement.ts); the contour lines on top of everything (the
 * owner's choice: under the background map's buildings, every line in a town was
 * cut into pieces), one after the other so they keep their order. */
function place(map: Map) {
  const ids = (map.getStyle().layers ?? []).map((layer) => layer.id)
  if (map.getLayer(HILLSHADE_LAYER))
    map.moveLayer(HILLSHADE_LAYER, shadingBefore(ids, background.mode() !== 'map'))
  for (const id of CONTOUR_LAYERS) if (map.getLayer(id)) map.moveLayer(id)
}

/** One colour per light direction, over the map and over imagery. */
const perDirection = (colour: { map: string; imagery: string }) => ({
  map: LIGHT_DIRECTIONS.map.map(() => colour.map),
  imagery: LIGHT_DIRECTIONS.imagery.map(() => colour.imagery)
})
const SHADING_COLOURS = { shadows: perDirection(SHADOW_COLOUR), highlights: perDirection(HIGHLIGHT_COLOUR) }

const hillshade = {
  id: HILLSHADE_LAYER,
  type: 'hillshade' as const,
  source: TERRAIN_SOURCE,
  paint: {
    'hillshade-method': 'multidirectional' as const,
    'hillshade-illumination-direction': LIGHT_DIRECTIONS.map,
    'hillshade-illumination-anchor': 'map' as const,
    'hillshade-exaggeration': STRENGTH.map,
    'hillshade-shadow-color': SHADING_COLOURS.shadows.map,
    'hillshade-highlight-color': SHADING_COLOURS.highlights.map
  }
}

const terrain: ForkModule = {
  sources: () => ({
    [TERRAIN_SOURCE]: elevations,
    [RELIEF_SOURCE]: elevations,
    [CONTOURS_SOURCE]: {
      type: 'vector',
      tiles: [CONTOURS_URL],
      minzoom: CONTOURS_MIN_ZOOM,
      maxzoom: CONTOURS_MAX_ZOOM
    }
  }),

  // Low among the data layers; place() moves them (the shading down, the lines up).
  layers: () => [hillshade, ...contourLayers()].map((layer) => ({ ...layer, zorder: 1 })),
  // A click on a height opens its contour line.
  labelLayers: () => [LABEL_LAYER],

  switcherGroups: () => [
    new LayerGroup(t('layers.terrain', 'Terrain'), [
      new Layer(HILLSHADE_SWITCHER_ID, t('layers.hillshade', 'Hill shading'), HILLSHADE_LAYER, true),
      new Layer(CONTOURS_SWITCHER_ID, contoursName(), CONTOURS_PREFIX, false),
      new Layer(RELIEF_SWITCHER_ID, t('layers.relief', 'Relief in 3D'), RELIEF_SWITCHER_ID, true)
    ])
  ],

  // Under Contour lines, a tick box for each part of them.
  key: async () => [contoursKey(contoursName())],

  init: ({ map }) => {
    const apply = () => place(map)
    map.on('style.load', apply)
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
    background.onChange(apply)
    followBackground(map, HILLSHADE_LAYER, 'hillshade-exaggeration', STRENGTH)
    followBackground(map, HILLSHADE_LAYER, 'hillshade-illumination-direction', LIGHT_DIRECTIONS)
    followBackground(map, HILLSHADE_LAYER, 'hillshade-shadow-color', SHADING_COLOURS.shadows)
    followBackground(map, HILLSHADE_LAYER, 'hillshade-highlight-color', SHADING_COLOURS.highlights)
    for (const id of CONTOUR_LINE_LAYERS) followBackground(map, id, 'line-color', CONTOUR_COLOUR)
    addDetailsExtra(heightRow)
  }
}

export default terrain
