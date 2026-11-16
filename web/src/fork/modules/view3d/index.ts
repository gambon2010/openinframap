// Fork: the 3D view (the 3D button among the map's buttons, remembered in this
// browser, services/view3d.ts). On: the map tilts, can be tilted and turned (right
// or Ctrl drag; two fingers), and buildings rise (modules/buildings, whose entry in
// the layer switcher it switches on). Off: flat and facing north again, locked flat
// as upstream has it (it turns tilting and turning off).
import type { Map } from 'maplibre-gl'
import type { LayerSwitcher } from '@russss/maplibregl-layer-switcher'
import { t } from '../../core/i18n.ts'
import { BUILDINGS_SWITCHER_ID } from '../../core/buildings.ts'
import { view3d } from '../../services/view3d.ts'
import { ForkModule } from '../../types.ts'
import { addMapButton } from '../../ui/map-button.ts'
import './view3d.css'

/** How far the map tilts when the 3D view is switched on (degrees from straight down). */
const TILT = 55

function show(map: Map, layerSwitcher: LayerSwitcher, button: HTMLButtonElement, animate: boolean) {
  const on = view3d.on()
  button.classList.toggle('oim-on', on)
  button.setAttribute('aria-pressed', String(on))
  if (on) {
    map.dragRotate.enable()
    map.touchZoomRotate.enableRotation()
    layerSwitcher.setVisibility(BUILDINGS_SWITCHER_ID, true)
    layerSwitcher._updateList()
  } else {
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
  }
  const view = on ? { pitch: TILT } : { pitch: 0, bearing: 0 }
  if (animate) map.easeTo(view)
  else map.jumpTo(view)
}

const view3dModule: ForkModule = {
  init: ({ map, layerSwitcher }) => {
    const button = addMapButton(map, {
      content: '3D',
      title: t('view3d.button', '3D view: tilt the map, buildings rise'),
      className: 'oim-3d-button',
      onclick: () => view3d.set(!view3d.on())
    })
    show(map, layerSwitcher, button, false)
    view3d.onChange(() => show(map, layerSwitcher, button, true))
  }
}

export default view3dModule
