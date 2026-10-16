import { IControl } from 'maplibre-gl'
import { t } from 'i18next'
import { el, mount, list, setStyle, RedomElement } from 'redom'
import { default as power_layers, voltage_scale, special_voltages } from '../style/style_oim_power.ts'
import comms_layers from '../style/style_oim_telecoms.js'
import {
  default as petroleum_layers,
  colour_oil,
  colour_gas_transmission_large,
  colour_gas_transmission_medium,
  colour_gas_transmission_other,
  colour_gas_pressure_high,
  colour_gas_pressure_intermediate,
  colour_gas_other,
  colour_fuel,
  colour_intermediate,
  colour_hydrogen
} from '../style/style_oim_petroleum.js'
import {
  colour_beer,
  colour_co2,
  colour_nitrogen,
  colour_other_pipeline_unknown,
  colour_oxygen
} from '../style/style_oim_other_pipelines.js'
import {
  colour_freshwater,
  colour_wastewater,
  colour_hotwater,
  colour_steam
} from '../style/style_oim_water.js'
import { svgLine, svgLineFromLayer, svgRectFromLayer } from './svg.js'
import './key.css'
import { FeatureHider, HideSpec } from './feature-hider.ts'
import { icpe_colours, icpe_category_label } from '../style/style_extra.ts'
import { site_kinds, site_kind_label, site_category_label } from '../style/style_sites.ts'
import { manifest } from 'virtual:render-svg'

const line_thickness = 6

class Td {
  el: HTMLTableCellElement
  constructor() {
    this.el = el('td')
  }
  update(data: string | RedomElement) {
    if (typeof data == 'string') {
      this.el.innerHTML = data
    } else if (!data) {
      return
    } else {
      mount(this.el, data)
    }
  }
}

const Tr = list.extend('tr', Td)

// A key row: label, swatch and, if it can be hidden, what hiding it hides.
type Row = [string, string | RedomElement | SVGElement | undefined, HideSpec?]

class KeyControl implements IControl {
  _map: maplibregl.Map | undefined
  _control!: HTMLButtonElement
  _container!: HTMLDivElement
  _pane: RedomElement | undefined
  hider!: FeatureHider
  onAdd(map: maplibregl.Map) {
    this._map = map
    this.hider = new FeatureHider(map)
    if (map.isStyleLoaded()) this.hider.apply()
    else map.once('load', () => this.hider.apply())

    this._control = el('button', {
      class: 'maplibregl-ctrl-icon oim-key-control',
      title: t('key.name'),
      ariaLabel: t('key.name')
    })

    this._container = el('div', { class: 'oim-key-panel' })

    this.populate()
    mount(document.body, this._container)

    this._control.onclick = () => {
      const button_position = this._control.getBoundingClientRect()
      this._container.style.top = button_position.top + 'px'
      this._container.style.right = document.documentElement.clientWidth - button_position.right + 'px'
      this._container.classList.add('visible')
    }

    return el('div', this._control, {
      class: 'maplibregl-ctrl maplibregl-ctrl-group'
    })
  }

  onRemove(): void {
    this._map = undefined
    this._container.remove()
    this._control.remove()
    this._pane = undefined
  }

  header() {
    const close_button = el('button.oim-key-close', '×')

    close_button.onclick = () => {
      this._container.classList.remove('visible')
    }
    const show_all = el('button.oim-key-show-all', t('key.show-all', 'Show all'), {
      title: t('key.show-all-title', 'Show everything hidden from the key')
    })
    show_all.onclick = () => {
      this.hider.showAll()
      this._container.querySelectorAll<HTMLInputElement>('input.oim-key-toggle').forEach((box) => {
        box.checked = true
        box.closest('tr')?.classList.remove('oim-key-row-hidden')
      })
    }
    return el('.oim-key-header', el('h2', t('key.name', 'Key')), show_all, close_button)
  }

  /** Fork: a key table whose rows can be unticked to hide those features from the map. */
  table(rows: Row[]) {
    const table = list('table', Tr)
    table.update(rows.map(([label, swatch, spec]) => [label, swatch, spec ? this.toggle(spec) : '']))
    rows.forEach(([, , spec], i) => {
      if (spec && this.hider.isHidden(spec)) table.el.children[i]?.classList.add('oim-key-row-hidden')
    })
    return table
  }

  toggle(spec: HideSpec) {
    const box = el('input.oim-key-toggle', {
      type: 'checkbox',
      checked: !this.hider.isHidden(spec),
      title: t('key.toggle', 'Show on the map')
    }) as HTMLInputElement
    box.onchange = () => {
      this.hider.setHidden(spec, !box.checked)
      box.closest('tr')?.classList.toggle('oim-key-row-hidden', !box.checked)
    }
    return box
  }

  async populate() {
    mount(this._container, this.header())

    const pane = el('.oim-key-body')
    pane.appendChild(el('h3', t('key.power-lines', 'Power Lines')))
    mount(pane, await this.voltageTable())
    pane.appendChild(el('h3', t('key.power-plants', 'Power Plants')))
    mount(pane, await this.plantTable())
    pane.appendChild(el('h3', t('key.power-generators', 'Power Generators')))
    mount(pane, await this.generatorTable())
    pane.appendChild(el('h3', t('key.power-line-supports', 'Power Line Supports')))
    mount(pane, await this.towerTable())
    pane.appendChild(el('h3', t('key.switchgear', 'Switchgear')))
    mount(pane, await this.switchgearTable())
    pane.appendChild(el('h3', t('key.telecoms', 'Telecoms')))
    mount(pane, await this.telecomTable())
    pane.appendChild(el('h3', t('key.gas', 'Gas')))
    mount(pane, await this.gasTable())
    pane.appendChild(el('h3', t('key.petroleum', 'Petroleum')))
    mount(pane, this.petroleumTable())
    pane.appendChild(el('h3', t('key.water', 'Water')))
    mount(pane, await this.waterTable())
    pane.appendChild(el('h3', t('layers.other-pipelines', 'Other Pipelines')))
    mount(pane, this.otherPipelineTable())
    // Fork: open data from Géorisques (layer switcher: Not from OpenStreetMap).
    // Fork: critical sites from OSM, one table per category.
    for (const category of Object.keys(site_kinds)) {
      pane.appendChild(el('h3', site_category_label(category)))
      mount(pane, await this.sitesTable(category))
    }
    pane.appendChild(el('h3', t('layers.extra-icpe', 'Classified installations (ICPE)')))
    mount(pane, this.icpeTable())
    this._pane = pane

    mount(this._container, pane)
  }

  async voltageTable() {
    const colours: [string, string][] = []
    for (const row of voltage_scale) {
      let label = row[0]?.toString()
      if (!label) {
        label = t('units.below_10kv', '< 10 kV')
      } else {
        label = t('units.ge_kv', '≥ {{voltage}} kV', { voltage: label })
      }

      colours.push([label, row[1]])
    }

    colours.push([t('names.power.hvdc', 'HVDC'), special_voltages.hvdc])
    colours.push([t('key.traction', 'Traction (< 50 Hz)'), special_voltages.traction])

    const rows: Row[] = colours.map(([label, colour]) => [label, svgLine(colour, line_thickness), { colour }])

    rows.push([
      t('location.underground', 'Underground'),
      svgLine('#7A7A85', line_thickness, '3 2'),
      // Fork: also the open-data underground lines (and their click area).
      { layers: ['power_line_underground', 'extra_power_line_underground'] }
    ])
    rows.push([
      t('names.power.line-reference', 'Line reference'),
      await this.sprite('line_ref'),
      { layers: ['power_line_ref'] }
    ])
    return this.table(rows)
  }

  async sprite(name: string, size = 25) {
    const spriteDiv = el('img.oim-key-symbol', {
      src: manifest['svg'][name],
      height: size
    })
    setStyle(spriteDiv, {
      'max-width': size + 'px'
    })
    return spriteDiv as unknown as SVGElement
  }

  async plantTable() {
    const plant_entries: { [name: string]: string } = {}
    plant_entries[t('power.source.coal')] = 'power_plant_coal'
    plant_entries[t('power.source.geothermal')] = 'power_plant_geothermal'
    plant_entries[t('power.source.hydro')] = 'power_plant_hydro'
    plant_entries[t('power.source.nuclear')] = 'power_plant_nuclear'
    plant_entries[t('power.source.oil-gas')] = 'power_plant_oilgas'
    plant_entries[t('power.source.solar')] = 'power_plant_solar'
    plant_entries[t('power.source.wind')] = 'power_plant_wind'
    plant_entries[t('power.source.biomass')] = 'power_plant_biomass'
    plant_entries[t('power.source.waste')] = 'power_plant_waste'
    plant_entries[t('power.source.battery')] = 'power_plant_battery'
    plant_entries[t('power.source.unknown')] = 'power_plant'

    const rows: Row[] = []
    for (const [key, value] of Object.entries(plant_entries)) {
      rows.push([key, await this.sprite(value), { icon: value }])
    }
    return this.table(rows)
  }

  async generatorTable() {
    const rows: Row[] = [
      [t('names.power.wind-turbine'), await this.sprite('power_wind', 14), { icon: 'power_wind' }],
      [
        t('names.power.solar-panel'),
        svgRectFromLayer(power_layers(), 'power_solar_panel'),
        { layers: ['power_solar_panel'] }
      ],
      [
        t('names.power.solar-panel-node', 'Solar panel (node)'),
        await this.sprite('power_generator_solar'),
        { icon: 'power_generator_solar' }
      ],
      [
        t('names.power.other-generator', 'Other generator'),
        await this.sprite('power_generator'),
        { icon: 'power_generator' }
      ]
    ]
    return this.table(rows)
  }

  async towerTable() {
    const rows: Row[] = [
      [
        t('names.power.tower-pylon', 'Tower/Pylon'),
        await this.sprite('power_tower', 10),
        { icon: 'power_tower' }
      ],
      [
        t('names.power.tower-transition', 'Transition tower'),
        await this.sprite('power_tower_transition', 10),
        { icon: 'power_tower_transition' }
      ],
      [t('names.power.pole'), await this.sprite('power_pole', 8), { icon: 'power_pole' }],
      [
        t('names.power.pole-transition', 'Transition pole'),
        await this.sprite('power_pole_transition', 8),
        { icon: 'power_pole_transition' }
      ]
    ]
    return this.table(rows)
  }

  async switchgearTable() {
    const rows: Row[] = [
      [t('names.power.transformer'), await this.sprite('power_transformer'), { icon: 'power_transformer' }],
      [
        t('names.power.transformer-3', 'Transformer (3 windings)'),
        await this.sprite('power_transformer_3_winding'),
        { icon: 'power_transformer_3_winding' }
      ],
      [
        t('names.power.current-transformer'),
        await this.sprite('power_transformer_current'),
        { icon: 'power_transformer_current' }
      ],
      [
        t('names.power.potential-transformer'),
        await this.sprite('power_transformer_potential'),
        { icon: 'power_transformer_potential' }
      ],
      [
        t('names.power.switch-disconnector', 'Disconnector'),
        await this.sprite('power_switch_disconnector'),
        { icon: 'power_switch_disconnector' }
      ],
      [
        t('names.power.switch-breaker', 'Circuit breaker'),
        await this.sprite('power_switch_circuit_breaker'),
        { icon: 'power_switch_circuit_breaker' }
      ],
      [
        t('names.power.switch-other', 'Other switch'),
        await this.sprite('power_switch'),
        { icon: 'power_switch' }
      ],
      [
        t('names.power.reactor-series', 'Series reactor'),
        await this.sprite('power_reactor'),
        { icon: 'power_reactor' }
      ],
      [
        t('names.power.reactor-shunt', 'Shunt reactor'),
        await this.sprite('power_reactor_shunt'),
        { icon: 'power_reactor_shunt' }
      ],
      [
        t('names.power.capacitor-series', 'Series capacitor'),
        await this.sprite('power_capacitor'),
        { icon: 'power_capacitor' }
      ],
      [
        t('names.power.capacitor-shunt', 'Shunt capacitor'),
        await this.sprite('power_capacitor_shunt'),
        { icon: 'power_capacitor_shunt' }
      ],
      [t('names.power.filter', 'Filter'), await this.sprite('power_filter'), { icon: 'power_filter' }],
      [
        t('names.power.compensator-other', 'Other compensator'),
        await this.sprite('power_compensator_frame'),
        { icon: 'power_compensator_frame' }
      ],
      [t('names.power.converter', 'DC converter'), await this.sprite('converter'), { icon: 'converter' }]
    ]
    return this.table(rows)
  }

  async telecomTable() {
    const rows: Row[] = [
      [
        t('names.cable', 'Cable'),
        svgLineFromLayer(comms_layers(), 'telecoms_line'),
        { layers: ['telecoms_line'] }
      ],
      [
        t('names.telecom.tower-mast', 'Tower/Mast'),
        await this.sprite('comms_tower'),
        { icon: 'comms_tower' }
      ],
      [
        t('names.telecom.datacenter', 'Datacenter'),
        await this.sprite('telecom_datacenter'),
        { icon: 'telecom_datacenter' }
      ],
      [
        t('names.telecoms.exchange', 'Exchange'),
        await this.sprite('telecom_exchange'),
        { icon: 'telecom_exchange' }
      ],
      [t('names.cabinet', 'Cabinet'), await this.sprite('cabinet'), { icon: 'cabinet' }]
    ]
    return this.table(rows)
  }

  async gasTable() {
    const rows: Row[] = [
      [
        `${t('names.gas.pipeline.transmission', 'Transmission')} >= DN 700`,
        svgLine(colour_gas_transmission_large, line_thickness),
        { colour: colour_gas_transmission_large }
      ],
      [
        `${t('names.gas.pipeline.transmission', 'Transmission')} >= DN 300`,
        svgLine(colour_gas_transmission_medium, line_thickness),
        { colour: colour_gas_transmission_medium }
      ],
      [
        `${t('names.gas.pipeline.transmission', 'Transmission')} < DN 300`,
        svgLine(colour_gas_transmission_other, line_thickness),
        { colour: colour_gas_transmission_other }
      ],
      [
        `${t('names.gas.pipeline.distribution', 'Distribution')} ${t('names.gas.pipeline.pressure.high', 'High Pressure')}`,
        svgLine(colour_gas_pressure_high, line_thickness),
        { colour: colour_gas_pressure_high }
      ],
      [
        `${t('names.gas.pipeline.distribution', 'Distribution')} ${t('names.gas.pipeline.pressure.intermediate', 'Intermediate Pressure')}`,
        svgLine(colour_gas_pressure_intermediate, line_thickness),
        { colour: colour_gas_pressure_intermediate }
      ],
      [
        `${t('names.gas.pipeline.distribution', 'Distribution')} ${t('names.gas.pipeline.pressure.low', 'Low Pressure')}`,
        svgLine(colour_gas_other, line_thickness),
        { colour: colour_gas_other }
      ]
    ]
    // Fork: open data (Agence ORE), shown with the gas network.
    rows.push([
      t('extra.biomethane', 'Biomethane injection point'),
      await this.sprite('biomethane_injection'),
      { icon: 'biomethane_injection' }
    ])
    return this.table(rows)
  }

  petroleumTable() {
    const rows: Row[] = [
      [t('names.substance.oil', 'Oil'), svgLine(colour_oil, line_thickness), { colour: colour_oil }],
      [
        t('names.substance.petroleum-intermediate', 'Petroleum intermediate'),
        svgLine(colour_intermediate, line_thickness),
        { colour: colour_intermediate }
      ],
      [t('names.substance.fuel', 'Fuel'), svgLine(colour_fuel, line_thickness), { colour: colour_fuel }],
      [
        t('names.substance.hydrogen', 'Hydrogen'),
        svgLine(colour_hydrogen, line_thickness),
        { colour: colour_hydrogen }
      ],
      [
        t('names.petroleum.facility', 'Petroleum facility'),
        svgRectFromLayer(petroleum_layers(), 'petroleum_site'),
        { layers: ['petroleum_site'] }
      ]
    ]
    return this.table(rows)
  }

  otherPipelineTable() {
    const rows: Row[] = [
      [
        t('names.substance.oxygen', 'Oxygen'),
        svgLine(colour_oxygen, line_thickness),
        { colour: colour_oxygen }
      ],
      [
        t('names.substance.co2', 'CO<sub>2</sub>'),
        svgLine(colour_co2, line_thickness),
        { colour: colour_co2 }
      ],
      [
        t('names.substance.nitrogen', 'Nitrogen'),
        svgLine(colour_nitrogen, line_thickness),
        { colour: colour_nitrogen }
      ],
      [t('names.substance.beer', 'Beer'), svgLine(colour_beer, line_thickness), { colour: colour_beer }],
      [
        t('other', 'Other'),
        svgLine(colour_other_pipeline_unknown, line_thickness),
        { colour: colour_other_pipeline_unknown }
      ]
    ]
    return this.table(rows)
  }

  async sitesTable(category: string) {
    const rows: Row[] = []
    for (const kind of site_kinds[category]) {
      rows.push([site_kind_label(kind), await this.sprite(`site_${kind}`, 20), { icon: `site_${kind}` }])
    }
    return this.table(rows)
  }

  icpeTable() {
    const rows: Row[] = Object.entries(icpe_colours).map(([category, colour]) => [
      icpe_category_label(category),
      el('span.oim-key-dot', {
        style: `background: ${colour}; border: 1px solid ${category.startsWith('seveso') ? '#3E2723' : '#fff'}`
      }) as RedomElement,
      { colour, types: ['circle'] }
    ])
    return this.table(rows)
  }

  async waterTable() {
    const rows: Row[] = [
      [
        t('names.substance.fresh-water', 'Fresh water'),
        svgLine(colour_freshwater, line_thickness),
        { colour: colour_freshwater }
      ],
      [
        t('names.substance.hot-water', 'Hot water'),
        svgLine(colour_hotwater, line_thickness),
        { colour: colour_hotwater }
      ],
      [t('names.substance.steam', 'Steam'), svgLine(colour_steam, line_thickness), { colour: colour_steam }],
      [
        t('names.substance.wastewater', 'Wastewater'),
        svgLine(colour_wastewater, line_thickness),
        { colour: colour_wastewater }
      ],
      [
        t('names.water.treatment-plant', 'Water treatment plant'),
        await this.sprite('water_treatment_plant'),
        { icon: 'water_treatment_plant' }
      ],
      [
        t('names.water.water-pumping-station', 'Water pumping station'),
        await this.sprite('water_pumping_station'),
        { icon: 'water_pumping_station' }
      ],
      [
        t('names.water.sewage-treatment-plant', 'Sewage treatment plant'),
        await this.sprite('sewage_treatment_plant'),
        { icon: 'sewage_treatment_plant' }
      ],
      [
        t('names.water.sewage-pumping-station', 'Sewage pumping station'),
        await this.sprite('sewage_pumping_station'),
        { icon: 'sewage_pumping_station' }
      ],
      [
        t('names.other-pumping-station', 'Other pumping station'),
        await this.sprite('pumping_station'),
        { icon: 'pumping_station' }
      ]
    ]
    return this.table(rows)
  }
}

export { KeyControl as default }
