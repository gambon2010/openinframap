// Fork: the terrain (docs/plans/terrain.md): the elevations of every area downloaded
// (the backend's /terrain tiles) as map sources, for the hill shading and contour
// lines drawn here (Data layers → Terrain: Hill shading, on at first, and Contour
// lines, made by the backend; their looks: docs/STYLE.md), the 3D view's relief
// (modules/view3d), and a clicked thing's height in its details (details.ts).
import type { Map, RasterDEMSourceSpecification } from 'maplibre-gl'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { CONTOURS_URL, TERRAIN_URL } from '../../config.ts'
import { RELIEF_SOURCE, TERRAIN_SOURCE } from '../../core/terrain.ts'
import { background, followBackground } from '../../services/background.ts'
import { addDetailsExtra } from '../../ui/details.ts'
import { ForkModule } from '../../types.ts'
import { CONTOUR_LAYERS, CONTOUR_LINE_LAYERS, LABEL_LAYER, contourLayers } from './contours.ts'
import { heightRow } from './details.ts'
import { terrainBefore } from './placement.ts'
import {
  CONTOURS_MAX_ZOOM,
  CONTOURS_MIN_ZOOM,
  CONTOURS_PREFIX,
  CONTOURS_SOURCE,
  CONTOURS_SWITCHER_ID,
  CONTOUR_COLOUR,
  CONTOUR_LABEL_COLOUR,
  HIGHLIGHT_COLOUR,
  HILLSHADE_LAYER,
  HILLSHADE_SWITCHER_ID,
  LIGHT_DIRECTIONS,
  SHADOW_COLOUR,
  STRENGTH,
  TERRAIN_MAX_ZOOM,
  TERRAIN_TILE_SIZE
} from './terrain.constants.ts'

const CREDIT =
  'Terrain: <a href="https://mapterhorn.com">Mapterhorn</a>, IGN (RGE ALTI, LiDAR HD), Copernicus DEM'

/** The terrain's layers, in the order they're drawn: shading, lines, heights. */
const TERRAIN_LAYERS = [HILLSHADE_LAYER, ...CONTOUR_LAYERS]

/** A source of the terrain's elevations (Mapterhorn's tiles: Terrarium, 512 pixels). */
const elevations: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: [TERRAIN_URL],
  encoding: 'terrarium',
  tileSize: TERRAIN_TILE_SIZE,
  maxzoom: TERRAIN_MAX_ZOOM,
  attribution: CREDIT
}

/** Moves the terrain's layers to their place for the background shown (placement.ts),
 * one after the other, so they keep their order. */
function place(map: Map) {
  const ids = (map.getStyle().layers ?? []).map((layer) => layer.id)
  const before = terrainBefore(ids, background.mode() !== 'map')
  for (const id of TERRAIN_LAYERS) if (map.getLayer(id)) map.moveLayer(id, before)
}

const hillshade = {
  id: HILLSHADE_LAYER,
  type: 'hillshade' as const,
  source: TERRAIN_SOURCE,
  paint: {
    'hillshade-method': 'multidirectional' as const,
    'hillshade-illumination-direction': LIGHT_DIRECTIONS,
    'hillshade-illumination-anchor': 'map' as const,
    'hillshade-exaggeration': STRENGTH.map,
    // One colour per light direction.
    'hillshade-shadow-color': LIGHT_DIRECTIONS.map(() => SHADOW_COLOUR),
    'hillshade-highlight-color': LIGHT_DIRECTIONS.map(() => HIGHLIGHT_COLOUR)
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

  // Low among the data layers; place() puts them under the background map's roads.
  layers: () => [hillshade, ...contourLayers()].map((layer) => ({ ...layer, zorder: 1 })),

  switcherGroups: () => [
    new LayerGroup(t('layers.terrain', 'Terrain'), [
      new Layer(HILLSHADE_SWITCHER_ID, t('layers.hillshade', 'Hill shading'), HILLSHADE_LAYER, true),
      new Layer(CONTOURS_SWITCHER_ID, t('layers.contours', 'Contour lines'), CONTOURS_PREFIX, false)
    ])
  ],

  init: ({ map }) => {
    const apply = () => place(map)
    map.on('style.load', apply)
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
    background.onChange(apply)
    followBackground(map, HILLSHADE_LAYER, 'hillshade-exaggeration', STRENGTH)
    for (const id of CONTOUR_LINE_LAYERS) followBackground(map, id, 'line-color', CONTOUR_COLOUR)
    followBackground(map, LABEL_LAYER, 'text-color', CONTOUR_LABEL_COLOUR)
    addDetailsExtra(heightRow)
  }
}

export default terrain
