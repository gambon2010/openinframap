// Fork: the 3D view (the 3D button among the map's buttons, remembered in this
// browser, services/view3d.ts). On: the map tilts, can be tilted and turned (right
// or Ctrl drag; two fingers), the ground takes its relief (the terrain's elevations,
// true heights: modules/terrain adds the source) under a sky, and buildings rise
// (modules/buildings, whose entry in the layer switcher it switches on). Off: flat
// and facing north again, and locked flat (upstream turns turning off; tilting with
// two fingers it left on); buildings off again if 3D switched them on.
import type { Map } from 'maplibre-gl'
import type { LayerSwitcher } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { BUILDINGS_SWITCHER_ID } from '../../core/buildings.ts'
import { RELIEF_EXAGGERATION, RELIEF_SOURCE } from '../../core/terrain.ts'
import { view3d } from '../../services/view3d.ts'
import { ForkModule } from '../../types.ts'
import { addMapButton, showPressed } from '../../ui/map-button.ts'
import './view3d.css'

/** How far the map tilts when the 3D view is switched on (degrees from straight down). */
const TILT = 55
/** The most it can be tilted in 3D (enough to look along a valley; MapLibre allows
 * 85); flat, none at all, so no gesture (two fingers on a phone included) can tilt
 * it. */
const MAX_TILT = 75
/** The sky over the relief: pale blue, haze towards the horizon. */
const SKY = {
  'sky-color': '#9cc3e6',
  'horizon-color': '#e8eef3',
  'sky-horizon-blend': 0.6,
  'fog-color': '#e8eef3',
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.9
}

/** Whether 3D switched the buildings on (they were off): off again when it ends. */
let switchedBuildingsOn = false

/** The ground's relief and the sky, in 3D only (the relief costs the graphics card). */
function showRelief(map: Map) {
  if (!map.getSource(RELIEF_SOURCE)) return
  if (view3d.on()) {
    map.setTerrain({ source: RELIEF_SOURCE, exaggeration: RELIEF_EXAGGERATION })
    map.setSky(SKY)
  } else {
    map.setTerrain(null)
  }
}

function show(map: Map, layerSwitcher: LayerSwitcher, button: HTMLButtonElement, animate: boolean) {
  const on = view3d.on()
  showPressed(button, on)
  showRelief(map)
  if (on) {
    map.setMaxPitch(MAX_TILT)
    map.dragRotate.enable()
    map.touchZoomRotate.enableRotation()
    if (!layerSwitcher._visible.includes(BUILDINGS_SWITCHER_ID)) {
      switchedBuildingsOn = true
      layerSwitcher.setVisibility(BUILDINGS_SWITCHER_ID, true)
      layerSwitcher._updateList()
    }
    const view = { pitch: TILT }
    if (animate) map.easeTo(view)
    else map.jumpTo(view)
  } else {
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    if (switchedBuildingsOn) {
      switchedBuildingsOn = false
      layerSwitcher.setVisibility(BUILDINGS_SWITCHER_ID, false)
      layerSwitcher._updateList()
    }
    const view = { pitch: 0, bearing: 0 }
    // Unless switched on again meanwhile (the flattening still going).
    const lockFlat = () => {
      if (!view3d.on()) map.setMaxPitch(0)
    }
    if (animate) map.easeTo(view).once('moveend', lockFlat)
    else lockFlat()
  }
}

const view3dModule: ForkModule = {
  init: ({ map, layerSwitcher }) => {
    const button = addMapButton(map, {
      content: '3D',
      title: t('view3d.button', '3D view: tilt the map, buildings rise'),
      className: 'oim-3d-button',
      onclick: () => view3d.set(!view3d.on())
    })
    view3d.onChange(() => show(map, layerSwitcher, button, true))
    // A new style (another background map) drops the relief.
    map.on('style.load', () => showRelief(map))
    // As kept, once the style is there (the layer switcher needs it).
    if (map.isStyleLoaded()) show(map, layerSwitcher, button, false)
    else map.once('load', () => show(map, layerSwitcher, button, false))
  }
}

export default view3dModule
