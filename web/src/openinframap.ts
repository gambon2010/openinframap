import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { t } from 'i18next'
import { mount } from 'redom'

import { URLHash, Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import OIMLayerSwitcher, { imageLoads } from './layer-switcher.ts'
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
import { BACKEND_BASE_URL, TILE_BASE_URL } from './config.js'

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

  // The night-lights background only exists online: grey it out when its tiles
  // can't be fetched, and check again when the browser goes online/offline.
  checkNightLights(layer_switcher: OIMLayerSwitcher) {
    const check = async () => {
      const online = navigator.onLine && (await imageLoads(`${TILE_BASE_URL}/black-marble-2024/0/0/0.webp`))
      layer_switcher.setUnavailable('N', online ? null : t('layers.needs-internet', 'needs internet'))
    }
    check()
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
  }

  init() {
    const layer_switcher = new OIMLayerSwitcher(
      [
        new LayerGroup(t('layers.background'), [
          new Layer('A', t('openstreetmap'), 'osm_', 'background', true),
          // Online only (tiles from openinframap.org): greyed out when unreachable, below.
          new Layer('N', t('layers.nighttime-lights'), 'black_marble', 'background', false)
        ]),
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
    this.checkNightLights(layer_switcher)
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
