// Fork: a debug box for checking how the map behaves, switched on in Settings
// ("Show debug info", kept in this browser): the zoom, the centre, the scale and
// metres per pixel, whether tiles are loading, the screen, how many style layers
// are drawn, and under the pointer its position and the features there (style
// layer, tile layer, id). Bottom right above the credits, a fixed size (what changes
// doesn't move it); updated as the map moves. While on, a clicked feature's details
// end with a "Debug info" section: its layer, source, every property, its page on
// OpenStreetMap and where its data comes from.
import type { Map, MapGeoJSONFeature } from 'maplibre-gl'
import { el, mount } from 'redom'
import { t } from '../../core/i18n.ts'
import { debugMode } from '../../services/debug-mode.ts'
import { ForkModule } from '../../types.ts'
import { SOURCE_NOTE, addDetailsExtra } from '../../ui/details.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import { debugInfo, featureRows, osmUrl } from './info.ts'
import './debug.css'

// Rows kept for the features under the pointer (describeFeatures lists 6 and "… more").
const UNDER_ROWS = 7

function debugBox(map: Map) {
  const box = el('.oim-debug', { 'aria-live': 'off' })
  map.getContainer().append(box)
  let pointer: { lng: number; lat: number; x: number; y: number } | null = null
  let pending = false
  const draw = () => {
    if (pending || !box.classList.contains('visible')) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      const info = debugInfo(map, pointer)
      const row = (label: string, value: string) => el('div', el('b', `${label} `), value)
      box.replaceChildren(
        row(t('debug.zoom', 'Zoom'), info.zoom),
        row(t('debug.centre', 'Centre'), info.centre),
        row(t('debug.scale', 'Scale'), `${info.scale} · ${info.metresPerPixel} m/px`),
        row(t('debug.tiles', 'Tiles'), info.tiles),
        row(t('debug.layers', 'Style layers'), info.layers),
        row(t('debug.screen', 'Screen'), info.screen),
        row(t('debug.pointer', 'Pointer'), info.pointer),
        // Always the same rows, so the box keeps its size as the pointer moves.
        el('b', t('debug.under', 'Under the pointer')),
        ...Array.from({ length: UNDER_ROWS }, (_, i) => el('div.oim-debug-feature', info.under[i] ?? ''))
      )
    })
  }
  for (const event of ['move', 'zoom', 'data', 'idle', 'styledata'] as const) map.on(event, draw)
  map.on('mousemove', (e) => {
    pointer = { lng: e.lngLat.lng, lat: e.lngLat.lat, x: e.point.x, y: e.point.y }
    draw()
  })
  map.getCanvas().addEventListener('mouseleave', () => {
    pointer = null
    draw()
  })
  return {
    show(on: boolean) {
      box.classList.toggle('visible', on)
      draw()
    }
  }
}

/** A feature's details while debugging: marked as such, then its rows, its page on
 * OpenStreetMap and where its data comes from (the panel shows neither:
 * ui/details.css). `sourceNote`: the panel's own note of it (modules/extra). */
function debugDetails(feature: MapGeoJSONFeature, sourceNote: Element | null): HTMLElement {
  const url = osmUrl(feature.properties)
  return el(
    'section.oim-debug-details',
    el('h4', t('debug.details', 'Debug info')),
    el(
      'table.item_info',
      featureRows(feature).map(([key, value]) => el('tr', el('th', key), el('td', value)))
    ),
    ...(url
      ? [el('a', t('debug.openstreetmap', 'View on OpenStreetMap'), { href: url, target: '_blank' })]
      : []),
    ...(sourceNote ? [sourceNote] : [])
  )
}

const debug: ForkModule = {
  init: ({ map }) => {
    const box = debugBox(map)
    const on = el('input', { type: 'checkbox' }) as HTMLInputElement
    const apply = (value: boolean) => {
      on.checked = value
      box.show(value)
    }
    addDetailsExtra((feature, content) => {
      if (on.checked) mount(content, debugDetails(feature, content.querySelector(`.${SOURCE_NOTE}`)))
    })
    on.onchange = () => debugMode.set(on.checked)
    debugMode.onChange(apply)
    apply(debugMode.on)
    addSettingsSection({
      el: el(
        'section.oim-debug-settings',
        el('h3', t('debug.title', 'Debug')),
        el(
          'label',
          on,
          ` ${t('debug.show', 'Show debug info on the map (zoom, scale, tiles, what is under the pointer)')}`
        )
      ),
      order: 200
    })
  }
}

export default debug
