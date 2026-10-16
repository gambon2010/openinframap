import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { t } from 'i18next'
import { mount } from 'redom'

import { LayerSwitcher, URLHash, Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import '@russss/maplibregl-layer-switcher/maplibregl-layer-switcher.css'

import EditButton from './edit-control.js'
import InfoPopup from './popup/infopopup.js'
import KeyControl from './key/key.js'
import MapSourcesControl from './map-sources/map-sources.ts'
import WarningBox from './warning-box/warning-box.js'
import OIMSearch from './search/search.ts'

import { getStyle, getPrimaryLayers } from './style/style.js'

import { ValidationErrorPopup } from './popup/validation-error-popup.js'
import { SymbolLoader } from './symbol-loader.ts'
import { ClickRouter } from './click-router.js'
import { CircuitInspector } from './circuit/circuitinspector.ts'
import { OpenInfraMapAPI } from './api.ts'
import { BACKEND_BASE_URL } from './config.js'

export default class OpenInfraMap {
  map?: maplibregl.Map

  isWebglSupported() {
    if (window.WebGLRenderingContext) {
      const canvas = document.createElement('canvas')
      try {
        const context =
          canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
          canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true })
        if (context && typeof context.getParameter == 'function') {
          return true
        }
      } catch {
        // WebGL is supported, but disabled
      }
      return false
    }
    // WebGL not supported
    return false
  }

  constructor() {
    maplibregl.setWorkerUrl(workerUrl)
    if (!this.isWebglSupported()) {
      const infobox = new WarningBox(t('warning', 'Warning'))
      infobox.update(t('warnings.webgl'))
      mount(document.body, infobox)
    }
  }

  init() {
    const layer_switcher = new LayerSwitcher(
      [
        // Background switch hidden: night lights are online-only, and showing the
        // switch breaks saved map links without an "A" in their layer list (the
        // background then turns off). See docs/FORK_CHANGES.md.
        // new LayerGroup(t('layers.background'), [
        //   new Layer('A', t('openstreetmap'), 'osm_', 'background', true),
        //   new Layer('N', t('layers.nighttime-lights'), 'black_marble', 'background', false)
        // ]),
        new LayerGroup(t('layers.overlays'), [
          new Layer('L', t('layers.labels'), 'label_', true),
          new Layer('B', t('layers.borders'), 'boundaries_', true)
        ]),
        new LayerGroup(t('layers.heatmaps'), [
          new Layer('S', t('layers.solar-generation'), 'heatmap_', false)
        ]),
        new LayerGroup(t('layers.infrastructure'), [
          new Layer('P', t('layers.power'), 'power_', true),
          new Layer('T', t('layers.telecoms'), 'telecoms_', false),
          new Layer('O', t('layers.petroleum'), 'petroleum_', false),
          new Layer('I', t('layers.other-pipelines'), 'pipeline_', false),
          new Layer('W', t('layers.water'), 'water_', false)
        ]),
        // Fork: open data from network operators, not from OpenStreetMap.
        new LayerGroup(t('layers.extra-data', 'Not from OpenStreetMap'), [
          new Layer(
            'X',
            t('layers.extra-distribution', 'Power distribution (open data)'),
            'extra_power',
            false
          ),
          new Layer('Y', t('layers.extra-gas', 'Gas distribution (open data)'), 'extra_gas', false),
          new Layer('Z', t('layers.extra-icpe', 'Classified installations (ICPE)'), 'extra_icpe', false)
        ]),
        // Fork: critical sites from OSM (style/style_sites.ts).
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
        ]),
        new LayerGroup(t('layers.validation'), [
          new Layer('E', t('layers.osmose-power'), 'osmose_errors_power', false)
        ])
      ],
      t('layers.title', 'Layers')
    )
    const url_hash = new URLHash(layer_switcher)
    const map_style = getStyle()

    layer_switcher.setInitialVisibility(map_style)

    const api = new OpenInfraMapAPI(BACKEND_BASE_URL)

    const map = new maplibregl.Map(
      url_hash.init({
        container: 'map',
        style: map_style,
        maxZoom: 20,
        zoom: 2,
        center: [12, 26],
        localIdeographFontFamily: "'Apple LiSung', 'Noto Sans', 'Noto Sans CJK SC', sans-serif"
      })
    )

    const clickRouter = new ClickRouter(map, map_style.layers)
    new SymbolLoader(map)
    const circuit_inspector = new CircuitInspector(map, url_hash, api)

    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()

    url_hash.enable(map)
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true
        },
        trackUserLocation: true
      })
    )

    map.addControl(new maplibregl.ScaleControl({}), 'bottom-left')

    map.addControl(new KeyControl(), 'top-right')
    map.addControl(new MapSourcesControl(), 'top-right')
    map.addControl(layer_switcher, 'top-right')
    map.addControl(new EditButton(), 'bottom-right')
    map.addControl(new OIMSearch(), 'top-left')
    new InfoPopup({
      layers: getPrimaryLayers().map((layer: { [x: string]: any }) => layer['id']),
      min_zoom: 6,
      api,
      circuit_inspector
    }).add(map, clickRouter)
    new ValidationErrorPopup(map, clickRouter)

    clickRouter.register()
    this.map = map
  }
}
