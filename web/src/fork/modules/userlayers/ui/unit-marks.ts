// Fork: a unit's echelon and marks (headquarters, task force, dummy), chosen on its
// card (editor/choices.ts) or before placing it (palette.ts): the echelons as a
// dropdown's lines, the marks as chips in one row, each lit when on (STYLE.md: oim-on).
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import type { UnitModifiers } from '../model/sidc.ts'
import { ECHELON_MARKS } from './editor/constants.ts'

/** Each echelon with its mark ("||  Battalion"), none first. */
export function echelonOptions(): [string, string][] {
  return ECHELON_MARKS.map(([code, mark, label]) => {
    const name = t(`userlayers.echelon.${code}`, label)
    return [code, code === '-' ? name : `${mark}  ${name}`]
  })
}

/** Headquarters, task force, dummy: a chip each, clicked on or off. */
export function markChips(marks: UnitModifiers, onchange: (marks: UnitModifiers) => void): HTMLElement {
  const chip = (label: string, title: string, on: boolean, toggled: (on: boolean) => UnitModifiers) => {
    const button = el(`button.oim-ul-chip${on ? '.oim-on' : ''}`, label, {
      type: 'button',
      title,
      'aria-pressed': String(on)
    }) as HTMLButtonElement
    button.onclick = () => onchange(toggled(!on))
    return button
  }
  return el(
    '.oim-ul-chips.oim-ul-marks',
    chip(t('userlayers.f.hq', 'HQ'), t('userlayers.f.hq-title', 'Headquarters'), marks.hq, (hq) => ({
      ...marks,
      hq
    })),
    chip(
      t('userlayers.f.task-force', 'Task force'),
      t('userlayers.f.task-force-title', 'Task force: a bracket above the frame'),
      marks.taskForce,
      (taskForce) => ({ ...marks, taskForce })
    ),
    chip(
      t('userlayers.f.feint', 'Dummy'),
      t('userlayers.f.feint-title', 'Feint / dummy'),
      marks.feint,
      (feint) => ({
        ...marks,
        feint
      })
    )
  )
}
