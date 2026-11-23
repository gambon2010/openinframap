// Fork: Oil & Natural Gas's facilities (upstream's petroleum sites, the pipelines'
// substations aside: depots, terminals, refineries) in the critical sites' look, with
// an icon of their own (no Critical sites key row hides it). Their areas in the fuel colour (upstream's grey
// recoloured on the map), and an icon at every zoom from the fork's tile layer
// petroleum_facility (tegola/layers.fork.yml). Their ids start with "petroleum_", so
// the Oil & Natural Gas entry switches them; the key's "Petroleum facility" row shows
// the icon and hides both. The storage tanks inside them aren't critical sites: drawn
// once (schema/fork/sites.sql).
import type { Map } from 'maplibre-gl'
import { t } from '../../core/i18n.ts'
import type { KeySection } from '../../types.ts'
import { keySprite } from '../../ui/key/toggles.ts'
import type { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { area_opacity, site_colours } from './style.ts'

/** Upstream's layer of the facilities' areas (style_oim_petroleum.ts). */
const AREA_LAYER = 'petroleum_site'
const ICON_LAYER = 'petroleum_facility_icon'
const ICON = 'site_oil_facility'

export function facilityLayers(): LayerSpecificationWithZIndex[] {
  return [
    {
      id: ICON_LAYER,
      zorder: 590,
      type: 'symbol',
      source: 'petroleum',
      'source-layer': 'petroleum_facility',
      layout: {
        'icon-image': ICON,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.45, 14, 0.85, 18, 0.9],
        'icon-allow-overlap': true
      }
    }
  ]
}

/** Upstream's facility areas in the fuel colour, now and with each new style. */
export function recolourFacilities(map: Map) {
  const apply = () => {
    if (!map.getLayer(AREA_LAYER)) return
    map.setPaintProperty(AREA_LAYER, 'fill-color', site_colours.fuel)
    map.setPaintProperty(AREA_LAYER, 'fill-outline-color', site_colours.fuel)
    map.setPaintProperty(AREA_LAYER, 'fill-opacity', area_opacity)
  }
  map.on('style.load', apply)
  if (map.isStyleLoaded()) apply()
  else map.once('load', apply)
}

/** Upstream's key row of the facilities (a grey square) as their icon, hiding the
 * areas and the icons. */
export function facilityKey(): KeySection {
  const label = t('names.petroleum.facility', 'Petroleum facility')
  return {
    title: t('key.petroleum', 'Petroleum'),
    appendTo: t('key.petroleum', 'Petroleum'),
    replaces: [label],
    rows: [[label, keySprite(ICON, 20), { layers: [AREA_LAYER, 'petroleum_facility'] }]]
  }
}
