// Fork: where the cursor is, at the bottom left next to the scale: latitude, longitude, the
// military grid reference (MGRS, to the metre), the ground's height and slope
// (ground.ts), the magnetic declination, and how far and which way it is from the
// last click (readings.ts; Escape forgets the click). G copies the grid reference
// under the cursor (the pointer stays where it is), which the readout's tooltip says.
import { IControl, Map } from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import type { LngLat } from '../../core/earth.ts'
import { formatLatLng, toMgrs } from '../../core/mgrs.ts'
import { formatHeight, formatSlope } from '../../services/elevation.ts'
import { measurePrefs } from '../../services/measure-prefs.ts'
import { groundFollower } from './ground.ts'
import { formatDeclination, fromPoint } from './readings.ts'

export class CoordinatesReadout implements IControl {
  private el = el('div.maplibregl-ctrl.oim-coords', {
    title: t('measure.copy-grid-tip', 'G: copy grid at pointer')
  })
  private latLng = el('span.oim-coords-latlng')
  private mgrs = el('span.oim-coords-mgrs')
  private height = el('span.oim-coords-height', { title: t('coordinates.height', 'Height of the ground') })
  private slope = el('span.oim-coords-slope', { title: t('coordinates.slope', 'Slope of the ground') })
  private declination = el('span.oim-coords-declination', {
    title: t('coordinates.declination', 'Magnetic declination: where a compass points, from true north')
  })
  private fromClick = el('span.oim-coords-from', {
    title: t('coordinates.from-click', 'From the last click: distance and bearing (Escape forgets it)')
  })
  /** The last click on the map, distances and bearings are from; none at first. */
  private lastClick: LngLat | null = null

  onAdd(map: Map): HTMLElement {
    this.el.append(this.latLng, this.mgrs, this.height, this.slope, this.declination, this.fromClick)
    const followGround = groundFollower((ground) => {
      this.height.textContent = `${t('coordinates.height-short', 'Alt')} ${formatHeight(ground.elevation)}`
      this.slope.textContent = `${t('coordinates.slope-short', 'Slope')} ${formatSlope(ground.slope)}`
    })
    const show = (lng: number, lat: number) => {
      this.latLng.textContent = formatLatLng(lng, lat)
      this.mgrs.textContent = toMgrs(lng, lat) ?? '—'
      this.declination.textContent = `${t('coordinates.declination-short', 'Decl')} ${formatDeclination(lng, lat)}`
      this.fromClick.textContent = this.lastClick
        ? `${t('coordinates.from-click-short', 'From click')} ${fromPoint(this.lastClick, [lng, lat], measurePrefs.north)}`
        : ''
      followGround(lng, lat)
    }
    map.on('click', (e) => {
      this.lastClick = [e.lngLat.lng, e.lngLat.lat]
      show(e.lngLat.lng, e.lngLat.lat)
    })
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
    // G: the grid reference under the cursor, which the readout shows; Escape: no
    // distance from the last click any more.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.lastClick) {
        this.lastClick = null
        this.fromClick.textContent = ''
        return
      }
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
