// Fork: what a line of sight's split screen (sight-panel.ts) shows beside its chart:
// the line's four heights (changed there), the legend, the note on how the heights
// are made, what's under the chart's pointer, and with debug on the answer's numbers
// checked against themselves (sight-debug.ts).
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { formatDistance } from '../../../core/earth.ts'
import { checkSight, dropOf, ROUNDING } from './sight-debug.ts'
import { lineHeightAt, type ProfilePoint, type SightResult, type SightSettings } from './sight.ts'

/** The backend gives where the target is first hidden in whole metres. */
const BLOCKED_AT_ROUNDING = 1

/** The line's four heights as fields; a valid change goes to `changed` (saved on the
 * item: the panel follows it). `show` puts the item's values back in them. */
export function settingsForm(changed: (changes: Partial<SightSettings>) => void): {
  form: HTMLElement
  show: (settings: SightSettings) => void
} {
  const inputs: Partial<Record<keyof SightSettings, HTMLInputElement>> = {}
  const field = (label: string, name: keyof SightSettings) => {
    const input = el('input', { type: 'number', min: 0, step: 0.5, 'data-field': name }) as HTMLInputElement
    input.onchange = () => {
      const metres = Number(input.value)
      if (Number.isFinite(metres) && metres >= 0) changed({ [name]: metres })
    }
    inputs[name] = input
    return el('label.oim-ul-sight-setting', el('span', label), input)
  }
  const form = el(
    '.oim-ul-sight-settings',
    field(t('userlayers.sight-observer', 'Eyes above the ground (m)'), 'observer'),
    field(t('userlayers.sight-target', 'Target above the ground (m)'), 'target'),
    field(t('userlayers.sight-trees', 'Trees (m)'), 'trees'),
    field(t('userlayers.sight-buildings', 'Buildings without a height (m)'), 'buildings')
  )
  const show = (settings: SightSettings) => {
    for (const [name, input] of Object.entries(inputs)) {
      // Not while it's being typed in.
      if (input !== document.activeElement) input.value = String(settings[name as keyof SightSettings])
    }
  }
  return { form, show }
}

/** How the chart's heights are made, and what stands on the ground in them. */
export function sightNote(result: SightResult, settings: SightSettings): string {
  const curvature = t(
    'userlayers.sight-note-level',
    "Heights above or below the line of sight, as seen from the eyes: the far ground bends away for the Earth's curvature, less the light's bending."
  )
  const standing = result.obstacles_counted
    ? t(
        'userlayers.sight-note-counted',
        "Buildings stand as tall as OpenStreetMap says ({{buildings}} m when it doesn't), woods {{trees}} m: in France the terrain is bare ground.",
        { buildings: settings.buildings, trees: settings.trees }
      )
    : t(
        'userlayers.sight-note-in-terrain',
        'Outside France the terrain holds trees and buildings itself: none added.'
      )
  return `${curvature} ${standing}`
}

export function legend(): HTMLElement {
  const key = (className: string, label: string) => el('span.oim-ul-sight-key', el(`i.${className}`), label)
  return el(
    '.oim-ul-sight-legend',
    key('oim-ul-sight-key-clear', t('userlayers.sight-key-clear', 'line clear')),
    key('oim-ul-sight-key-through-trees', t('userlayers.sight-key-through-trees', 'through trees')),
    key('oim-ul-sight-key-blocked', t('userlayers.sight-key-blocked', 'line blocked')),
    key('oim-ul-sight-key-ground', t('userlayers.sight-key-ground', 'ground')),
    key('oim-ul-sight-key-building', t('userlayers.sight-key-building', 'buildings')),
    key('oim-ul-sight-key-trees', t('userlayers.sight-key-trees', 'trees'))
  )
}

/** What's under the pointer: how far, the ground's height, what stands there; with
 * debug on, the heights the answer used there too. */
export function describe(point: ProfilePoint, result: SightResult, debugging: boolean): string {
  const [distance, ground, seen, standing, kind, apparent] = point
  const parts = [formatDistance(distance)]
  if (ground !== null)
    parts.push(t('userlayers.sight-ground-at', 'ground {{height}} m', { height: Math.round(ground) }))
  if (kind === 'building')
    parts.push(t('userlayers.sight-building-at', 'building {{height}} m', { height: Math.round(standing) }))
  if (kind === 'trees')
    parts.push(t('userlayers.sight-trees-at', 'trees {{height}} m', { height: Math.round(standing) }))
  parts.push(seen ? t('userlayers.sight-seen-here', 'seen') : t('userlayers.sight-hidden-here', 'hidden'))
  if (debugging) {
    const line = lineHeightAt(result, distance)
    const drop = dropOf(point)
    parts.push(
      `top seen ${metres(apparent)} · lowered ${metres(drop)} · line ${metres(line)} · above the line ${metres(
        apparent !== null && line !== null ? apparent - line : null
      )}`
    )
  }
  return parts.join(' · ')
}

/** The answer's numbers and its checks (debug on): raw, in the backend's words. */
export function debugSection(result: SightResult, settings: SightSettings): HTMLElement[] {
  const check = checkSight(result)
  const flag = (ok: boolean) => (ok ? ' ✓' : ' ✗')
  const dropOk = check.worstDropError <= ROUNDING
  const marginOk =
    check.margin === null || result.margin === null || Math.abs(check.margin - result.margin) <= ROUNDING
  const blockOk =
    result.target_seen === true ||
    (check.firstHiding !== null &&
      result.blocked_at !== null &&
      Math.abs(check.firstHiding - result.blocked_at) <= BLOCKED_AT_ROUNDING)
  const rows: [string, string][] = [
    ['settings', JSON.stringify(settings)],
    ['eye, target_top', `${metres(result.eye)}, ${metres(result.target_top)}`],
    ['target_seen, blocked_by', `${result.target_seen}, ${result.blocked_by}`],
    [
      'blocked_at · from the profile',
      `${metres(result.blocked_at)} · ${metres(check.firstHiding)}${flag(blockOk)}`
    ],
    ['margin · from the profile', `${metres(result.margin)} · ${metres(check.margin)}${flag(marginOk)}`],
    [
      'curvature',
      `${result.curvature.coefficient.toFixed(5)} × d² / (2 × ${result.curvature.earth_radius} m)`
    ],
    ['lowered at the target · formula', `${metres(check.dropAtEnd)} · ${metres(check.dropAtEndExpected)}`],
    ['worst lowering error', `${check.worstDropError.toFixed(2)} m${flag(dropOk)}`],
    ['samples · spacing', `${check.samples} · ${check.spacing.toFixed(1)} m`],
    ['obstacles_counted, through_trees', `${result.obstacles_counted}, ${result.through_trees}`]
  ]
  const copy = el('button.oim-ul-button', t('userlayers.sight-copy', 'Copy the answer (JSON)'), {
    type: 'button'
  }) as HTMLButtonElement
  // The clipboard can be refused (not a secure page): the button says so.
  copy.onclick = () =>
    navigator.clipboard.writeText(JSON.stringify(result)).then(
      () => (copy.textContent = t('userlayers.sight-copied', 'Copied')),
      () => (copy.textContent = t('userlayers.sight-copy-failed', 'Copying refused by the browser'))
    )
  return [
    el('h4', t('debug.details', 'Debug info')),
    el(
      'table.item_info',
      rows.map(([key, value]) => el('tr', el('th', key), el('td', value)))
    ),
    copy
  ]
}

function metres(value: number | null): string {
  return value === null ? '–' : `${value.toFixed(1)} m`
}
