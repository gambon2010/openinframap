// Fork: where the cursor is, at the bottom left next to the scale: latitude, longitude and the
// military grid reference (MGRS, to the metre). G copies the grid reference under the
// cursor (the pointer stays where it is), which the readout's tooltip says.
import { IControl, Map } from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { formatLatLng, toMgrs } from '../../core/mgrs.ts'

export class CoordinatesReadout implements IControl {
  // Its tooltip (coordinates.css, data-tip): shown at once on hover, unlike a title.
  private el = el('div.maplibregl-ctrl.oim-coords', {
    'data-tip': t('measure.copy-mgrs-key', 'G (with the pointer on the map): copy the grid reference there')
  })
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
    const copy = () => {
      const text = this.mgrs.textContent ?? ''
      if (!text || text === '—') return
      void navigator.clipboard?.writeText(text).then(() => {
        this.el.classList.add('copied')
        setTimeout(() => this.el.classList.remove('copied'), 1200)
      })
    }
    // G: the grid reference under the cursor, which the readout shows.
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() !== 'g' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (isTyping(e.target) || !map.getCanvas().matches(':hover')) return
      e.preventDefault()
      copy()
    })
    return this.el
  }

  onRemove() {
    this.el.remove()
  }
}

/** Whether a key goes into a text field (then it's typing, not a shortcut). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
