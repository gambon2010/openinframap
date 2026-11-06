// Fork: a debug box for checking how the map behaves, switched on in Settings
// ("Show debug info", kept in this browser): the zoom, the centre, the scale and
// metres per pixel, whether tiles are loading, the screen, how many style layers
// are drawn, and under the pointer its position and the features there (style
// layer, tile layer, id). Bottom right above the credits, a fixed size (what changes
// doesn't move it); updated as the map moves.
import type { Map } from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { readText, writeText } from '../../core/storage.ts'
import { ForkModule } from '../../types.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import { debugInfo } from './info.ts'
import './debug.css'

const KEY = 'oim-debug'

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

const debug: ForkModule = {
  init: ({ map }) => {
    const box = debugBox(map)
    const on = el('input', { type: 'checkbox' }) as HTMLInputElement
    const apply = (value: boolean) => {
      on.checked = value
      box.show(value)
    }
    on.onchange = () => {
      writeText(KEY, on.checked ? '1' : '0')
      apply(on.checked)
    }
    apply(readText(KEY) === '1')
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
