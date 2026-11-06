// Fork: My layers' Import and Export (formats.ts): choosing a file, downloading one.
import { Map as MapLibreMap } from 'maplibre-gl'
import { t } from '../../../core/i18n.ts'
import { UserLayer } from '../model/model.ts'
import type { Store } from '../state/store.ts'
import { EXTENSIONS, Format, MIME, exportLayers, readFile } from './formats.ts'
import { positionsOf } from '../model/shapes.ts'

// Above this, ask first: the list and the map get slow.
const MANY = 5000

/** Download layers as a file, named after the layer (or "My layers"). */
export function download(layers: UserLayer[], format: Format) {
  const title = layers.length === 1 ? layers[0].name : t('userlayers.title', 'My layers')
  const blob = new Blob([exportLayers(layers, format, title)], { type: MIME[format] })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_')}.${EXTENSIONS[format]}`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.geojson,.json,.kml,.gpx,application/geo+json,application/vnd.google-earth.kml+xml'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Choose a GeoJSON, KML or GPX file: a new layer with its items, the map moved to it. */
export async function importFile(store: Store, map: MapLibreMap) {
  const file = await pickFile()
  if (!file) return
  let items
  try {
    items = readFile(file.name, await file.text())
  } catch (e) {
    window.alert(
      t('userlayers.import-failed', "This file can't be read ({{error}}). GeoJSON, KML and GPX files can.", {
        error: (e as Error).message
      })
    )
    return
  }
  if (!items.length) {
    window.alert(t('userlayers.import-empty', 'There is nothing to put on the map in this file.'))
    return
  }
  if (
    items.length > MANY &&
    !window.confirm(
      t('userlayers.import-many', 'This file has {{count}} items: the map may get slow. Import them?', {
        count: items.length
      })
    )
  )
    return
  store.importLayer(file.name.replace(/\.[^.]+$/, ''), items)
  // Show what came in.
  let [west, south, east, north] = [180, 90, -180, -90]
  for (const [x, y] of items.flatMap((item) => positionsOf(item.geometry))) {
    west = Math.min(west, x)
    east = Math.max(east, x)
    south = Math.min(south, y)
    north = Math.max(north, y)
  }
  map.fitBounds(
    [
      [west, south],
      [east, north]
    ],
    { padding: 80, maxZoom: 15 }
  )
}
