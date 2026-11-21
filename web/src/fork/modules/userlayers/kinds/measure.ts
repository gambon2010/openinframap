// Fork: a measurement: a distance (each leg's length and bearing, marks along the
// way), an area (and its perimeter) or range rings round a point. Drawn by
// map/render.ts from measure/features.ts; its points are moved like a drawing's.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { formatDistance, formatLength, parseDistances, parseLength } from '../../../core/earth.ts'
import { Measurement } from '../measure/features.types.ts'
import { legBearing, legsOf, measurementOf, summary, withLegLength } from '../measure/features.ts'
import { measurePrefs } from '../../../services/measure-prefs.ts'
import { sightAnswer, sightSettingsOf, type SightSettings } from '../measure/sight.ts'
import { openSightPanel } from '../measure/sight-panel.ts'
import { sightVerdict } from '../measure/sight-verdict.ts'
import { FeatureProps } from '../model/model.ts'
import { areaCrossesItself } from '../model/shapes.ts'
import { ItemKind, Item } from './types.ts'

const ICONS = { distance: '📏', area: '⬠', rings: '◎', sight: '👁' }

// In sentences ("…a distance"), and as a label ("Distance: 3 km").
const NAMES = () => ({
  distance: t('userlayers.kind.measure-distance', 'distance'),
  area: t('userlayers.kind.measure-area', 'measured area'),
  rings: t('userlayers.kind.measure-rings', 'range rings'),
  sight: t('userlayers.kind.measure-sight', 'line of sight')
})
const LABELS = () => ({
  distance: t('userlayers.what.measure-distance', 'Distance'),
  area: t('userlayers.what.measure-area', 'Measured area'),
  rings: t('userlayers.what.measure-rings', 'Range rings'),
  sight: t('userlayers.what.measure-sight', 'Line of sight')
})

const typeOf = (item: Item) => item.properties.measure ?? 'distance'

export const measure: ItemKind = {
  id: 'measure',
  noun: (item) => NAMES()[typeOf(item)],
  what: (item) => {
    const m = measurementOf(item)
    return m ? `${LABELS()[m.type]}: ${summary(m, measurePrefs.north)}` : LABELS()[typeOf(item)]
  },
  drawn: 'measure',
  thumbnail: (item) => ICONS[typeOf(item)],
  coloured: true,
  filters: () => ['graphics'],
  card: (item, update, setGeometry) => {
    const m = measurementOf(item)
    if (!m) return []
    if (m.type === 'rings') return ringsCard(item, update)
    if (m.type === 'sight') return sightCard(m, item, update)
    return legsCard(m, setGeometry)
  }
}

/** A line of sight: the heights of the eyes and of what's looked at (typed), whether
 * it's seen and what hides it, once the backend answers (measure/sight.ts), and a
 * button opening its profile in a split screen (measure/sight-panel.ts). */
function sightCard(
  m: Measurement,
  item: Item,
  update: (changes: Partial<FeatureProps>) => void
): HTMLElement[] {
  const settings = sightSettingsOf(item.properties)
  const heightInput = (field: keyof SightSettings) => {
    const input = el('input', {
      type: 'number',
      min: 0,
      step: 0.5,
      value: settings[field],
      'data-field': field
    }) as HTMLInputElement
    input.onchange = () => {
      const metres = Number(input.value)
      if (Number.isFinite(metres) && metres >= 0) update({ [field]: metres })
    }
    return input
  }
  const row = (label: string, field: keyof SightSettings) =>
    el('.oim-ul-detail', el('span.oim-ul-detail-name', label), heightInput(field))
  const result = el('strong.oim-ul-sight-result', t('userlayers.sight-asking', 'Looking at the terrain…'))
  const [from, to] = [m.points[0], m.points[m.points.length - 1]]
  void sightAnswer(from, to, settings).then((sight) => {
    result.textContent =
      !sight || sight.target_seen === null
        ? t('userlayers.sight-unknown', 'No terrain here: no answer.')
        : sightVerdict(sight, settings)
  })
  const open = el('button.oim-ul-button', t('userlayers.sight-open', 'Open the profile'), {
    type: 'button'
  }) as HTMLButtonElement
  open.onclick = () =>
    void openSightPanel({
      title: String(item.properties.name || t('userlayers.what.measure-sight', 'Line of sight')),
      from,
      to,
      settings
    })
  return [
    result,
    row(t('userlayers.sight-observer', 'Eyes above the ground (m)'), 'observer'),
    row(t('userlayers.sight-target', 'Target above the ground (m)'), 'target'),
    row(t('userlayers.sight-trees', 'Trees (m)'), 'trees'),
    row(t('userlayers.sight-buildings', 'Buildings without a height (m)'), 'buildings'),
    el(
      '.oim-ul-detail',
      el('span.oim-ul-detail-name', t('userlayers.measure-total', 'In all')),
      el('strong', summary(m, measurePrefs.north))
    ),
    open
  ]
}

/** Range rings: their distances, typed ("1, 5, 10 km", "500 m", "3 nm"). */
function ringsCard(item: Item, update: (changes: Partial<FeatureProps>) => void): HTMLElement[] {
  const radii = (item.properties.radii as number[] | undefined) ?? measurePrefs.radii
  const input = el('input', {
    type: 'text',
    value: radii.map(formatDistance).join(', '),
    'data-field': 'radii'
  }) as HTMLInputElement
  input.onchange = () => {
    const value = parseDistances(input.value)
    if (!value.length) return
    update({ radii: value })
    // New rings get these too.
    measurePrefs.set({ radii: value })
  }
  return [
    el(
      '.oim-ul-detail',
      el('span.oim-ul-detail-name', t('userlayers.ring-distances', 'Ring distances')),
      input
    )
  ]
}

/** A distance's or an area's legs: each one's length (typed over: its end moves
 * along the same bearing, the legs after it follow) and bearing. */
function legsCard(m: Measurement, setGeometry: (g: GeoJSON.Geometry) => void): HTMLElement[] {
  const legs = legsOf(m)
  const rows = legs.map((leg, i) => {
    // An area's closing leg follows from the others.
    const editable = m.type === 'distance' || i < legs.length - 1
    const input = el('input.oim-ul-leg-length', {
      type: 'text',
      value: formatLength(leg.length),
      disabled: !editable,
      'data-field': `leg-${i}`,
      'aria-label': t('userlayers.leg-n', 'Leg {{n}}', { n: i + 1 })
    }) as HTMLInputElement
    input.oninput = () => input.setCustomValidity('')
    input.onchange = () => {
      const metres = parseLength(input.value)
      if (metres === null) {
        input.value = formatLength(leg.length)
        return
      }
      const points = withLegLength(m.points, i, metres)
      // An area that would cross itself: refused (model/shapes.ts).
      if (m.type === 'area' && areaCrossesItself(points)) {
        input.setCustomValidity(
          t('userlayers.area-crossing', "Not there: the area's outline would cross itself.")
        )
        input.reportValidity()
        input.value = formatLength(leg.length)
        return
      }
      setGeometry(
        m.type === 'area'
          ? { type: 'Polygon', coordinates: [[...points, points[0]]] }
          : { type: 'LineString', coordinates: points }
      )
    }
    return el(
      '.oim-ul-detail.oim-ul-leg',
      el('span.oim-ul-detail-name', t('userlayers.leg-n', 'Leg {{n}}', { n: i + 1 })),
      input,
      el('small', legBearing(leg.from, leg.to, measurePrefs.north))
    )
  })
  return [
    el('h4.oim-ul-legs-title', t('userlayers.legs', 'Legs (type a length to change it)')),
    ...rows,
    el(
      '.oim-ul-detail',
      el('span.oim-ul-detail-name', t('userlayers.measure-total', 'In all')),
      el('strong', summary(m, measurePrefs.north))
    )
  ]
}
