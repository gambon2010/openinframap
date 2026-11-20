// Fork: the terrain (docs/plans/terrain.md): the elevations of every area downloaded
// (the backend's /terrain tiles) as map sources, for the hill shading drawn here (an
// entry of Data layers: Terrain → Hill shading, on at first; its look: docs/STYLE.md,
// "Hill shading") and the 3D view's relief (modules/view3d). Contour lines later.
import type { Map, RasterDEMSourceSpecification } from 'maplibre-gl'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { TERRAIN_URL } from '../../config.ts'
import { RELIEF_SOURCE, TERRAIN_SOURCE } from '../../core/terrain.ts'
import { background, followBackground } from '../../services/background.ts'
import { ForkModule } from '../../types.ts'
import { hillshadeBefore } from './placement.ts'
import {
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

/** Moves the hill shading to its place for the background shown (placement.ts). */
/** A source of the terrain's elevations (Mapterhorn's tiles: Terrarium, 512 pixels). */
const elevations: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: [TERRAIN_URL],
  encoding: 'terrarium',
  tileSize: TERRAIN_TILE_SIZE,
  maxzoom: TERRAIN_MAX_ZOOM,
  attribution: CREDIT
}

function place(map: Map) {
  if (!map.getLayer(HILLSHADE_LAYER)) return
  const ids = (map.getStyle().layers ?? []).map((layer) => layer.id).filter((id) => id !== HILLSHADE_LAYER)
  const before = hillshadeBefore(ids, background.mode() !== 'map')
  map.moveLayer(HILLSHADE_LAYER, before)
}

const terrain: ForkModule = {
  sources: () => ({ [TERRAIN_SOURCE]: elevations, [RELIEF_SOURCE]: elevations }),

  // Low among the data layers; place() puts it under the background map's roads.
  layers: () => [
    {
      zorder: 1,
      id: HILLSHADE_LAYER,
      type: 'hillshade',
      source: TERRAIN_SOURCE,
      paint: {
        'hillshade-method': 'multidirectional',
        'hillshade-illumination-direction': LIGHT_DIRECTIONS,
        'hillshade-illumination-anchor': 'map',
        'hillshade-exaggeration': STRENGTH.map,
        // One colour per light direction.
        'hillshade-shadow-color': LIGHT_DIRECTIONS.map(() => SHADOW_COLOUR),
        'hillshade-highlight-color': LIGHT_DIRECTIONS.map(() => HIGHLIGHT_COLOUR)
      }
    }
  ],

  switcherGroups: () => [
    new LayerGroup(t('layers.terrain', 'Terrain'), [
      new Layer(HILLSHADE_SWITCHER_ID, t('layers.hillshade', 'Hill shading'), HILLSHADE_LAYER, true)
    ])
  ],

  init: ({ map }) => {
    const apply = () => place(map)
    map.on('style.load', apply)
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
    background.onChange(apply)
    followBackground(map, HILLSHADE_LAYER, 'hillshade-exaggeration', STRENGTH)
  }
}

export default terrain
