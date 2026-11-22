// Fork: an item's card (editor/index.ts): a military item's choices, one dropdown
// row each (identity, status, condition, how a graphic is drawn, echelon, mobility)
// and the marks a unit can carry as tick boxes. They're all part of its code
// (sidc.ts).
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import {
  MOBILITIES,
  identity,
  mobility,
  status,
  unitModifiers,
  withIdentity,
  withMobility,
  withStatus,
  withUnitModifiers
} from '../../model/sidc.ts'
import { controlPoints } from '../../map/geometry.ts'
import { variantsOf, withKey } from '../../graphics/variants.ts'
import { axisWidth } from '../../graphics/graphics.ts'
import { Card } from './types.ts'
import { CONDITIONS, ECHELON_MARKS } from './constants.ts'
import { identityOptions } from '../../model/labels.ts'
import { checkbox, formRow, select } from './controls.ts'

/** The rows of a military item's choices (nothing for other items). */
export function choiceRows(c: Card): HTMLElement[] {
  const { military, sidc, kind, update } = c
  if (!military || !kind) return []
  const setSidc = (next: string) => update({ sidc: next })
  const rows = [identityRow(sidc, setSidc), statusRow(sidc, setSidc)]
  if (kind !== 'graphic') rows.push(conditionRow(sidc, setSidc))
  const drawnAs = kind === 'graphic' ? drawnAsRow(c) : null
  if (drawnAs) rows.push(drawnAs)
  if (kind === 'unit') rows.push(echelonRow(sidc, setSidc), marksRow(sidc, setSidc))
  if (kind === 'equipment' && sidc[2] === 'G') rows.push(mobilityRow(sidc, setSidc))
  return rows
}

function identityRow(sidc: string, setSidc: (next: string) => void): HTMLElement {
  return formRow(
    t('userlayers.identity', 'Identity'),
    select(identityOptions(), identity(sidc), (v) => setSidc(withIdentity(sidc, v)), 'identity'),
    undefined,
    t(
      'userlayers.identity-help',
      'Whose it is: the frame’s shape and colour (friend blue rectangle, hostile red diamond, neutral green square, unknown yellow)'
    )
  )
}

/** Present or planned (the code's status; a condition is a kind of present). */
export function statusOptions(): [string, string][] {
  return [
    ['P', t('userlayers.status.P', 'Present')],
    ['A', t('userlayers.status.A', 'Planned')]
  ]
}

function statusRow(sidc: string, setSidc: (next: string) => void): HTMLElement {
  const planned = status(sidc) === 'A'
  return formRow(
    t('userlayers.status-label', 'Status'),
    select(statusOptions(), planned ? 'A' : 'P', (v) => setSidc(withStatus(sidc, v)), 'status'),
    undefined,
    t(
      'userlayers.status-help',
      'Present: there now (solid outline). Planned: expected or intended (dashed outline)'
    )
  )
}

/** How it is, if present: fully capable, damaged, destroyed, full to capacity
 * (stored in the status's place: only for what's present). */
function conditionRow(sidc: string, setSidc: (next: string) => void): HTMLElement {
  const st = status(sidc)
  const options: [string, string][] = [
    ['', '—'],
    ...CONDITIONS.map(([code, label]): [string, string] => [code, t(`userlayers.condition.${code}`, label)])
  ]
  const current = CONDITIONS.some(([code]) => code === st) ? st : ''
  const control = select(options, current, (v) => setSidc(withStatus(sidc, v || 'P')), 'condition')
  if (st === 'A') {
    control.disabled = true
    control.title = t('userlayers.condition-planned', 'Only for what is present')
  }
  return formRow(
    t('userlayers.condition-label', 'Condition'),
    control,
    undefined,
    t(
      'userlayers.condition-help',
      'How it is, if present: fully capable, damaged, destroyed or full to capacity (a bar under the symbol)'
    )
  )
}

/** A graphic's two versions (graphic-variants.ts): a task or an obstacle, an axis of
 * advance or a direction of attack. Same points: the drawing stays. */
function drawnAsRow(c: Card): HTMLElement | null {
  const { feature, sidc, update } = c
  const versions = variantsOf(sidc)
  if (!versions) return null
  const labels = versions.variants.labels()
  const switchTo = (index: 0 | 1) => {
    if (index === versions.index) return
    const next = withKey(sidc, versions.variants.keys[index])
    if (!versions.variants.arrow) return update({ sidc: next })
    // An axis has a width (its size handle); a direction of attack doesn't.
    const path = controlPoints(feature.geometry)
    update(
      index === 0
        ? { sidc: next, axis: true, axisWidth: axisWidth(path) }
        : { sidc: next, axis: undefined, axisWidth: undefined }
    )
  }
  return formRow(
    t('userlayers.drawn-as', 'Drawn as'),
    select(
      [
        ['0', labels[0]],
        ['1', labels[1]]
      ],
      String(versions.index),
      (v) => switchTo(v === '1' ? 1 : 0),
      'drawn-as'
    ),
    undefined,
    t('userlayers.drawn-as-help', 'The graphic’s other version, on the same points')
  )
}

function echelonRow(sidc: string, setSidc: (next: string) => void): HTMLElement {
  const m = unitModifiers(sidc)
  const options = ECHELON_MARKS.map(([code, mark, label]): [string, string] => {
    const name = t(`userlayers.echelon.${code}`, label)
    return [code, code === '-' ? name : `${mark}  ${name}`]
  })
  return formRow(
    t('userlayers.echelon-label', 'Echelon'),
    select(options, m.echelon, (v) => setSidc(withUnitModifiers(sidc, { ...m, echelon: v })), 'echelon'),
    undefined,
    t('userlayers.echelon-help', 'Its size, from a team to an army: the marks above the frame')
  )
}

/** Headquarters, task force, dummy: each on or off. */
function marksRow(sidc: string, setSidc: (next: string) => void): HTMLElement {
  const m = unitModifiers(sidc)
  return formRow(
    t('userlayers.marked-as', 'Marked as'),
    el(
      'span.oim-ul-control.oim-ul-checks',
      checkbox(
        t('userlayers.f.hq', 'HQ'),
        m.hq,
        (on) => setSidc(withUnitModifiers(sidc, { ...m, hq: on })),
        t('userlayers.f.hq-title', 'Headquarters')
      ),
      checkbox(t('userlayers.f.task-force', 'Task force'), m.taskForce, (on) =>
        setSidc(withUnitModifiers(sidc, { ...m, taskForce: on }))
      ),
      checkbox(
        t('userlayers.f.feint', 'Dummy'),
        m.feint,
        (on) => setSidc(withUnitModifiers(sidc, { ...m, feint: on })),
        t('userlayers.f.feint-title', 'Feint / dummy')
      )
    ),
    undefined,
    t(
      'userlayers.marked-as-help',
      'Headquarters (a staff under the frame), task force (a bracket above), dummy (a dashed outline)'
    )
  )
}

function mobilityRow(sidc: string, setSidc: (next: string) => void): HTMLElement {
  return formRow(
    t('userlayers.f.mobility', 'Mobility'),
    select(MOBILITIES, mobility(sidc), (v) => setSidc(withMobility(sidc, v)), 'mobility'),
    undefined,
    t('userlayers.mobility-help', 'How it moves: the mark under the frame')
  )
}
