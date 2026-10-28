// Fork: critical sites from OSM (imposm/sites.py, schema/sites.sql, Tegola's
// "sites" map). Everything the map needs for them, as one fork module.
import { t } from 'i18next'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { ForkModule } from '../types.ts'
import { OIM_TILES } from '../config.ts'
import { keySprite } from '../key/toggles.ts'
import layers, { site_kinds, site_kind_label, site_category_label } from './style.ts'

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

  layers,

  switcherGroups: () => [
    new LayerGroup(t('layers.sites', 'Critical sites'), [
      new Layer('H', t('sites.category.health', 'Health and emergency'), 'sites_health', false),
      new Layer(
        'G',
        t('sites.category.government', 'Government and public services'),
        'sites_government',
        false
      ),
      new Layer('R', t('sites.category.religion', 'Places of worship'), 'sites_religion', false),
      new Layer('F', t('sites.category.fuel', 'Fuel and weapons'), 'sites_fuel', false),
      new Layer('V', t('sites.category.transport', 'Transport hubs'), 'sites_transport', false),
      new Layer('M', t('sites.category.military', 'Military'), 'sites_military', false),
      // Not sites_military_disused: the switcher matches prefixes, and M would cover it.
      new Layer(
        'D',
        t('sites.category.military-disused', 'Disused military (bunkers, trenches...)'),
        'sites_disused',
        false
      ),
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

  // One section per category, a row per kind.
  key: async () =>
    Object.keys(site_kinds).map((category) => ({
      title: site_category_label(category),
      rows: site_kinds[category].map((kind) => [
        site_kind_label(kind),
        keySprite(`site_${kind}`, 20),
        { icon: `site_${kind}` }
      ])
    })),

  popup: {
    // Shown as the title and "Type" instead; id is the tile's, count only on groups.
    hiddenKeys: ['id', 'category', 'importance', 'count', 'count_label'],
    renderKey: (key, value) =>
      key == 'kind' ? popupRow(t('info.type'), site_kind_label(String(value))) : undefined,
    title: (feature) =>
      feature.layer.id.startsWith('sites_') ? site_kind_label(feature.properties.kind) : undefined
  },

  searchDescription: (result) =>
    result.type === 'feature' && result.source === 'site' && result.kind
      ? site_kind_label(result.kind) + (result.town ? `, ${result.town}` : '')
      : undefined
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
