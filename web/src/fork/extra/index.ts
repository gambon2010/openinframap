// Fork: data from outside OpenStreetMap (scripts/extra_data.py, schema/extra.sql,
// Tegola's "extra" map): French distribution networks, biomethane injection
// points, classified installations (ICPE). One fork module.
import { t } from 'i18next'
import { el } from 'redom'
import { MapGeoJSONFeature } from 'maplibre-gl'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { ForkModule } from '../types.ts'
import { OIM_TILES } from '../config.ts'
import { keySprite } from '../key/toggles.ts'
import layers, { icpe_colours, icpe_category_label } from './style.ts'
import './extra.css'

// The sources extra_data.py can import, for the popup's attribution.
const extra_sources: { [id: string]: { name: string; url: string; licence: string } } = {
  'fr-agence-ore': {
    name: 'Agence ORE',
    url: 'https://opendata.agenceore.fr',
    licence: 'Licence Ouverte 2.0'
  },
  'fr-georisques-icpe': {
    name: 'Géorisques',
    url: 'https://www.georisques.gouv.fr',
    licence: 'Licence Ouverte 2.0'
  }
}

const extra: ForkModule = {
  sources: () => ({
    // Its licence (Licence Ouverte for the French networks) requires naming the source.
    extra: {
      type: 'vector',
      tiles: [`${OIM_TILES}/extra/{z}/{x}/{y}.pbf`],
      // Sites (e.g. biomethane injection points) from zoom 5; lines start later (layers.yml).
      minzoom: 5,
      maxzoom: 17,
      attribution:
        'Electricity and gas networks: <a href="https://opendata.agenceore.fr">Agence ORE</a> and network operators; classified installations: <a href="https://www.georisques.gouv.fr">Géorisques</a> (Licence Ouverte)'
    }
  }),

  layers,

  switcherGroups: () => [
    new LayerGroup(t('layers.extra-data', 'Not from OpenStreetMap'), [
      new Layer('X', t('layers.extra-distribution', 'Power distribution (open data)'), 'extra_power', false),
      new Layer('Y', t('layers.extra-gas', 'Gas distribution (open data)'), 'extra_gas', false),
      new Layer('Z', t('layers.extra-icpe', 'Classified installations (ICPE)'), 'extra_icpe', false)
    ])
  ],

  key: async () => [
    // Shown with the gas network.
    {
      title: t('key.gas', 'Gas'),
      appendTo: t('key.gas', 'Gas'),
      rows: [
        [
          t('extra.biomethane', 'Biomethane injection point'),
          keySprite('biomethane_injection'),
          { icon: 'biomethane_injection' }
        ]
      ]
    },
    {
      title: t('layers.extra-icpe', 'Classified installations (ICPE)'),
      rows: Object.entries(icpe_colours).map(([category, colour]) => [
        icpe_category_label(category),
        el('span.oim-key-dot', {
          style: `background: ${colour}; border: 1px solid ${category.startsWith('seveso') ? '#3E2723' : '#fff'}`
        }),
        { colour, types: ['circle'] }
      ])
    }
  ],

  popup: {
    html: (feature) => (feature.layer.id.startsWith('extra_') ? popupHtml(feature) : undefined)
  }
}

/** A feature from outside OpenStreetMap (the extra_* layers). */
function popupHtml(feature: MapGeoJSONFeature): HTMLElement {
  const p = feature.properties
  const id = feature.layer.id
  const icpe = id.startsWith('extra_icpe')
  const biomethane = id.startsWith('extra_gas_biomethane')
  let title
  if (icpe) {
    title = p.name || icpe_category_label(p.category)
  } else if (biomethane) {
    title = p.name || t('extra.biomethane', 'Biomethane injection point')
  } else if (id.startsWith('extra_gas_pipeline')) {
    title = t('extra.gas-pipe', 'Gas distribution pipe')
  } else if (id.startsWith('extra_power_substation')) {
    title = t('extra.substation', 'Distribution substation')
  } else if (p.voltage_class === 'BT') {
    title = t('extra.line-bt', 'Low-voltage line')
  } else if (p.voltage_class === 'HTA') {
    title = t('extra.line-hta', 'Medium-voltage line')
  } else {
    title = t('extra.line', 'Distribution line')
  }
  const facility = icpe || biomethane
  const rows: [string, any][] = [
    // Sites have their name as the title; their kind is shown as Type below.
    [t('info.name'), facility ? null : p.name],
    [
      t('extra.voltage-class', 'Voltage class'),
      p.voltage_class === 'HTA'
        ? t('extra.hta', 'HTA (medium voltage, usually 20 kV)')
        : p.voltage_class === 'BT'
          ? t('extra.bt', 'BT (low voltage, 230/400 V)')
          : p.voltage_class
    ],
    [t('extra.kind', 'Kind'), facility ? null : p.kind]
  ]
  if (id.startsWith('extra_gas_pipeline')) {
    rows.push([
      t('extra.pressure', 'Pressure'),
      p.pressure_published || t('extra.pressure-unknown', 'Not published')
    ])
  }
  if (biomethane) {
    rows.push(
      [t('info.type'), t('extra.biomethane', 'Biomethane injection point')],
      [t('extra.capacity', 'Capacity'), p.capacity && `${Math.round(p.capacity)} ${p.capacity_unit}`],
      [t('extra.feedstock', 'Feedstock'), p.feedstock],
      [t('extra.process', 'Process'), p.process],
      [t('extra.network', 'Gas network'), [p.network, p.network_operator].filter((x) => x).join(', ')],
      [t('extra.opened', 'In service since'), p.opened]
    )
  }
  if (icpe) {
    rows.push(
      [t('info.type'), icpe_category_label(p.category)],
      [t('extra.icpe.seveso', 'Seveso'), p.seveso !== 'Non Seveso' ? p.seveso : null],
      [t('extra.icpe.regime', 'Regime'), p.regime],
      [t('extra.icpe.status', 'Status'), p.status],
      [
        t('extra.icpe.activities', 'Activities'),
        p.activities &&
          el(
            'div',
            ...String(p.activities)
              .split('; ')
              .map((a: string) => el('div', a))
          )
      ],
      [
        t('extra.icpe.inspections', 'Inspections'),
        p.inspections &&
          `${p.inspections}${p.last_inspection ? ', ' + t('extra.icpe.last', 'last') + ' ' + p.last_inspection : ''}`
      ],
      [t('extra.icpe.commune', 'Commune'), p.commune],
      [
        t('extra.icpe.details', 'Details'),
        p.aiot &&
          el('a', 'Géorisques', {
            href: `https://www.georisques.gouv.fr/risques/installations/donnees/details/${p.aiot}`,
            target: '_blank'
          })
      ]
    )
  }
  rows.push(
    [t('info.operator'), p.operator],
    [t('info.location'), p.location && t('location.' + p.location, p.location)],
    [t('extra.updated', 'Source updated'), p.updated]
  )
  const source = extra_sources[p.source]
  return el(
    'div.oim-popup-content',
    el('div.oim-popup-header', el('h3', title)),
    el(
      'table.item_info',
      rows.filter(([, value]) => value).map(([key, value]) => el('tr', el('th', key), el('td', value)))
    ),
    el(
      'p.oim-extra-notice',
      t('extra.notice', 'Not from OpenStreetMap: open data from'),
      ' ',
      source ? el('a', source.name, { href: source.url, target: '_blank' }) : p.source,
      source ? ` (${source.licence})` : ''
    )
  )
}

export default extra
