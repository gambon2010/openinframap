// Fork: where the cursor is, at the bottom left: latitude, longitude and the
// military grid reference (MGRS, to the metre). A click copies the grid reference.
import { IControl, Map } from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { toMgrs } from './mgrs.ts'

/** "47.75000 N, 7.30000 E". */
export function formatLatLng(lng: number, lat: number): string {
  const ns = lat < 0 ? 'S' : 'N'
  const ew = lng < 0 ? 'W' : 'E'
  return `${Math.abs(lat).toFixed(5)} ${ns}, ${Math.abs(lng).toFixed(5)} ${ew}`
}

export class CoordinatesReadout implements IControl {
  private el = el('button.maplibregl-ctrl.oim-coords', {
    type: 'button',
    title: t('measure.copy-mgrs', 'Click to copy the grid reference')
  }) as HTMLButtonElement
  private latLng = el('span.oim-coords-latlng')
  private mgrs = el('span.oim-coords-mgrs')

  onAdd(map: Map): HTMLElement {
    this.el.append(this.latLng, this.mgrs)
    const show = (lng: number, lat: number) => {
      this.latLng.textContent = formatLatLng(lng, lat)
      this.mgrs.textContent = toMgrs(lng, lat) ?? '—'
    }
    let pending = false
    map.on('mousemove', (e) => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        show(e.lngLat.lng, e.lngLat.lat)
      })
    })
    // Off the map (or on a touch screen): its centre.
    const centre = () => show(map.getCenter().lng, map.getCenter().lat)
    map.getCanvas().addEventListener('mouseleave', centre)
    map.on('moveend', () => {
      if (!map.getCanvas().matches(':hover')) centre()
    })
    centre()
    this.el.onclick = () => {
      const text = this.mgrs.textContent ?? ''
      void navigator.clipboard?.writeText(text).then(() => {
        this.el.classList.add('copied')
        setTimeout(() => this.el.classList.remove('copied'), 1200)
      })
    }
    return this.el
  }

  onRemove() {
    this.el.remove()
  }
}
