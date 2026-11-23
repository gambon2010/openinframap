// Fork: a unit's echelon and marks (headquarters, task force, dummy), chosen on its
// card (editor/choices.ts) or before placing it (palette.ts): the echelons as a
// dropdown's lines, the marks as chips (chip.ts).
import { toggleChip } from '../../../ui/chip.ts'
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
export function markChips(marks: UnitModifiers, onchange: (marks: UnitModifiers) => void): HTMLElement[] {
  return [
    toggleChip(
      t('userlayers.f.hq', 'HQ'),
      marks.hq,
      (hq) => onchange({ ...marks, hq }),
      t('userlayers.f.hq-title', 'Headquarters')
    ),
    toggleChip(
      t('userlayers.f.task-force', 'Task force'),
      marks.taskForce,
      (taskForce) => onchange({ ...marks, taskForce }),
      t('userlayers.f.task-force-title', 'Task force: a bracket above the frame')
    ),
    toggleChip(
      t('userlayers.f.feint', 'Dummy'),
      marks.feint,
      (feint) => onchange({ ...marks, feint }),
      t('userlayers.f.feint-title', 'Feint / dummy')
    )
  ]
}
