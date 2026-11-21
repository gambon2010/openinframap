// Fork: critical sites from OSM (imposm/sites.py, schema/fork/sites.sql, Tegola's
// "sites" map). Everything the map needs for them, as one fork module.
import { t } from '../../core/i18n.ts'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import type { MapGeoJSONFeature } from 'maplibre-gl'
import { ForkModule, KeyRow, KeySection } from '../../types.ts'
import { OIM_TILES } from '../../config.ts'
import { keySprite } from '../../ui/key/toggles.ts'
import layers, {
  AREA_OPACITY_OVER_IMAGERY,
  HIDDEN_AT_FIRST,
  area_layer_id,
  area_opacity,
  key_icons,
  key_kinds,
  site_colours,
  site_kinds,
  site_kind_label,
  site_category_label
} from './style.ts'
import { followBackground } from '../../services/background.ts'
import { facilityKey, facilityLayers, recolourFacilities } from './petroleum.ts'
import { PART_ROOF_LAYER, partLabel, partLayers, partsSummary } from './parts.ts'
import { PART_ROOF_OPACITY } from './parts.constants.ts'

const oim_attribution =
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://openinframap.org/copyright">Open Infrastructure Map</a>'

const sites: ForkModule = {
  sources: () => ({
    sites: {
      type: 'vector',
      tiles: [`${OIM_TILES}/sites/{z}/{x}/{y}.pbf`],
      minzoom: 4,
      maxzoom: 17,
      attribution: oim_attribution
    }
  }),

  layers: () => [...layers(), ...partLayers(), ...facilityLayers()],

  switcherGroups: () => [
    new LayerGroup(t('layers.sites', 'Critical sites'), [
      new Layer('H', t('sites.category.health', 'Health and emergency'), 'sites_health', false),
      new Layer('N', t('sites.category.police', 'Police, gendarmerie, customs'), 'sites_police', false),
      new Layer(
        'G',
        t('sites.category.government', 'Government and public services'),
        'sites_government',
        false
      ),
      new Layer('R', t('sites.category.religion', 'Places of worship'), 'sites_religion', false),
      new Layer('F', t('sites.category.fuel', 'Fuel'), 'sites_fuel', false),
      new Layer('V', t('sites.category.transport', 'Transport hubs'), 'sites_transport', false),
      new Layer('M', t('sites.category.military', 'Military'), 'sites_military', false),
      new Layer('U', t('sites.category.food', 'Food supply'), 'sites_food', false),
      new Layer(
        'Q',
        t('sites.category.water-waste', 'Dams, landfills, weather stations'),
        'sites_water_waste',
        false
      )
    ])
  ],

  init: ({ map, clickRouter, primaryLayers }) => {
    recolourFacilities(map)
    // The areas' fill a little stronger over imagery.
    const followImagery = () => {
      for (const category of Object.keys(site_colours))
        followBackground(map, area_layer_id(category), 'fill-opacity', {
          map: area_opacity,
          imagery: AREA_OPACITY_OVER_IMAGERY
        })
      followBackground(map, PART_ROOF_LAYER, 'fill-opacity', PART_ROOF_OPACITY)
    }
    if (map.isStyleLoaded()) followImagery()
    else map.once('load', followImagery)
    // Clicking a group of sites (a numbered disc) zooms in on it.
    clickRouter.registerHandler(
      primaryLayers()
        .map((layer) => layer.id)
        .filter((id) => id.startsWith('sites_') && id.endsWith('_group')),
      (feature) => {
        const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates
        map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 14) })
      }
    )
  },

  // One section per category, a row per kind; and Oil & Natural Gas's facilities.
  key: async () => [
    ...Object.keys(site_kinds).map((category): KeySection => ({
      title: site_category_label(category),
      rows: key_kinds(category).map((kind): KeyRow => {
        const label = site_kind_label(kind)
        const [icon, ...with_it] = key_icons(kind)
        const sprite = keySprite(icon, 20)
        // One icon: a plain string (the browser remembers rows by their spec).
        const hide = { icon: with_it.length ? [icon, ...with_it] : icon }
        return HIDDEN_AT_FIRST.includes(kind)
          ? [label, sprite, hide, { hiddenAtFirst: true }]
          : [label, sprite, hide]
      })
    })),
    facilityKey()
  ],

  popup: {
    // Shown as the title and "Type" instead; id is the tile's, count only on groups;
    // a part's what it is goes in its title.
    hiddenKeys: ['id', 'category', 'importance', 'count', 'count_label', 'kinds', 'part', 'part_what'],
    renderKey: (key, value) => {
      if (key == 'kind') return popupRow(t('info.type'), site_kind_label(String(value)))
      if (key == 'base_name') return popupRow(t('sites.part.of', 'Part of'), String(value))
      if (key == 'parts') return popupRow(t('sites.parts', 'Parts'), partsSummary(String(value)))
      return undefined
    },
    title: (feature) => siteTitle(feature)
  },

  searchDescription: (result) =>
    result.type === 'feature' && result.source === 'site' && result.kind
      ? site_kind_label(result.kind) + (result.town ? `, ${result.town}` : '')
      : undefined
}

/** An unnamed site's title: what a base's part is (a bunker), else its kind. */
function siteTitle(feature: MapGeoJSONFeature): string | undefined {
  if (!feature.layer.id.startsWith('sites_')) return undefined
  const { kind, part, part_what } = feature.properties
  if (part === 'building' || part === 'zone') return partLabel(String(part_what ?? kind), part)
  return site_kind_label(kind)
}

function popupRow(key: string, value: string): HTMLElement {
  const row = document.createElement('tr')
  const th = document.createElement('th')
  const td = document.createElement('td')
  th.textContent = key
  td.textContent = value
  row.append(th, td)
  return row
}

export default sites
