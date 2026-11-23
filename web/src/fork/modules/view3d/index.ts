// Fork: the 3D view (the 3D button among the map's buttons, remembered in this
// browser, services/view3d.ts). On: the map tilts, can be tilted and turned (right
// or Ctrl drag; two fingers), the ground takes its relief (the terrain's elevations,
// true heights: modules/terrain adds the source) under a sky, buildings rise
// (modules/buildings), and over the map the hill shading shows the relief (modules/
// terrain): 3D switches their entries in the layer switcher on. Off: flat and facing
// north again, and locked flat (upstream turns turning off; tilting with two fingers
// it left on); the entries 3D switched on off again.
import type { Map } from 'maplibre-gl'
import type { LayerSwitcher } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { readJson, writeJson } from '../../core/storage.ts'
import { BUILDINGS_SWITCHER_ID } from '../../core/buildings.ts'
import {
  HILLSHADE_SWITCHER_ID,
  RELIEF_EXAGGERATION,
  RELIEF_SOURCE,
  RELIEF_SWITCHER_ID
} from '../../core/terrain.ts'
import { onEntriesChange } from '../../services/layer-entries.ts'
import { background } from '../../services/background.ts'
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

/** The layer switcher's entries 3D switched on (they were off): off again when it
 * ends. Kept in this browser: the address keeps them on across a reload, and 3D
 * must still switch them off after it. */
const SWITCHED_ON_KEY = 'oim-3d-switched-on'
const switchedOn = new Set<string>(readJson<string[]>(SWITCHED_ON_KEY, []))
const keepSwitchedOn = () => writeJson(SWITCHED_ON_KEY, [...switchedOn])

/** Switches an entry on for 3D, if it's off. */
function switchOn(layerSwitcher: LayerSwitcher, id: string) {
  if (layerSwitcher._visible.includes(id)) return
  switchedOn.add(id)
  keepSwitchedOn()
  layerSwitcher.setVisibility(id, true)
  layerSwitcher._updateList()
}

/** Switches an entry off again, if 3D switched it on. */
function switchBackOff(layerSwitcher: LayerSwitcher, id: string) {
  if (!switchedOn.delete(id)) return
  keepSwitchedOn()
  layerSwitcher.setVisibility(id, false)
  layerSwitcher._updateList()
}

/** In 3D over the map, the hill shading on: the relief is hard to see on the map's
 * flat colours (imagery has its own shadows). */
function showShading(layerSwitcher: LayerSwitcher) {
  if (view3d.on() && background.mode() === 'map') switchOn(layerSwitcher, HILLSHADE_SWITCHER_ID)
  else switchBackOff(layerSwitcher, HILLSHADE_SWITCHER_ID)
}

/** The ground's relief and the sky, in 3D only (the relief costs the graphics card),
 * while the Terrain group's Relief in 3D is ticked. */
function showRelief(map: Map, layerSwitcher: LayerSwitcher) {
  if (!map.getSource(RELIEF_SOURCE)) return
  if (view3d.on() && layerSwitcher._visible.includes(RELIEF_SWITCHER_ID)) {
    map.setTerrain({ source: RELIEF_SOURCE, exaggeration: RELIEF_EXAGGERATION })
    map.setSky(SKY)
  } else {
    map.setTerrain(null)
  }
}

function show(map: Map, layerSwitcher: LayerSwitcher, button: HTMLButtonElement, animate: boolean) {
  const on = view3d.on()
  showPressed(button, on)
  showRelief(map, layerSwitcher)
  showShading(layerSwitcher)
  if (on) {
    map.setMaxPitch(MAX_TILT)
    map.dragRotate.enable()
    map.touchZoomRotate.enableRotation()
    switchOn(layerSwitcher, BUILDINGS_SWITCHER_ID)
    const view = { pitch: TILT }
    if (animate) map.easeTo(view)
    else map.jumpTo(view)
  } else {
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    switchBackOff(layerSwitcher, BUILDINGS_SWITCHER_ID)
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
    background.onChange(() => showShading(layerSwitcher))
    // A new style (another background map) drops the relief.
    map.on('style.load', () => showRelief(map, layerSwitcher))
    onEntriesChange(layerSwitcher, () => showRelief(map, layerSwitcher))
    // As kept, once the style is there (the layer switcher needs it).
    if (map.isStyleLoaded()) show(map, layerSwitcher, button, false)
    else map.once('load', () => show(map, layerSwitcher, button, false))
  }
}

export default view3dModule
