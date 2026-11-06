// Fork: My layers' preferences, in the Settings window (fork/ui/settings.ts; the
// sidebar's ⚙ opens it there): the colour of new items, the labels of units and of
// tactical graphics, and which north measured bearings are from. Kept in this browser (bearings: your
// account, measure/prefs.ts).
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { SettingsSection } from '../../../ui/settings.ts'
import { getLabelLevel, setLabelLevel } from '../map/symbols.ts'
import { GraphicLabelChoice } from '../graphics/labels.types.ts'
import { graphicLabelChoice, setGraphicLabelChoice } from '../graphics/labels.ts'
import { LabelLevel } from '../model/fields.types.ts'
import { measurePrefs } from '../measure/prefs.ts'
import type { North } from '../measure/north.ts'
import { newItemColour, setNewItemColour } from '../map/new-colour.ts'

/** A dropdown of [value, label] choices. */
function choice<T extends string>(choices: [T, string][], current: () => T, set: (value: T) => void) {
  const select = el(
    'select',
    choices.map(([value, label]) => el('option', label, { value }))
  ) as HTMLSelectElement
  select.value = current()
  select.onchange = () => set(select.value as T)
  return select
}

/** The section; `redraw` draws the layers again with the new labels. */
export function preferencesSection(redraw: () => void): SettingsSection {
  const units = choice<LabelLevel>(
    [
      ['none', t('userlayers.labels.none', 'None')],
      ['name', t('userlayers.labels.name', 'Designation only')],
      ['all', t('userlayers.labels.all', 'All fields')]
    ],
    getLabelLevel,
    (level) => {
      setLabelLevel(level)
      redraw()
    }
  )
  // The labels on tactical graphics (graphics/labels.ts): ours in English or
  // French, or the standard's.
  const graphics = choice<GraphicLabelChoice>(
    [
      ['en', t('userlayers.graphic-labels-en', 'English')],
      ['fr', 'Français'],
      ['standard', t('userlayers.graphic-labels-standard', 'Standard (MIL-STD-2525)')]
    ],
    graphicLabelChoice,
    (value) => {
      setGraphicLabelChoice(value)
      redraw()
    }
  )
  // Bearings of measurements (measure/north.ts): true, magnetic (compass) or grid north.
  const north = choice<North>(
    [
      ['true', t('measure.north-true', 'True north')],
      ['magnetic', t('measure.north-magnetic', 'Magnetic north (compass)')],
      ['grid', t('measure.north-grid', 'Grid north (MGRS)')]
    ],
    () => measurePrefs.north,
    (value) => measurePrefs.set({ north: value })
  )
  // The colour new drawings, markers, measurements and graphics get.
  const colour = el('input', { type: 'color', value: newItemColour() }) as HTMLInputElement
  colour.onchange = () => setNewItemColour(colour.value)
  const field = (label: string, title: string, control: HTMLElement) =>
    el('label.oim-ul-field', { title }, el('span', label), control)
  const section = el(
    'section.oim-ul-preferences',
    el('h3', t('userlayers.title', 'My layers')),
    field(
      t('userlayers.new-colour', 'Colour of new items'),
      t(
        'userlayers.new-colour-title',
        'New drawings, markers, measurements and graphics get it (change one on its card)'
      ),
      colour
    ),
    field(
      t('userlayers.unit-labels', 'Unit labels'),
      t('userlayers.unit-labels-title', 'The text written around unit symbols'),
      units
    ),
    field(
      t('userlayers.graphic-labels', 'Graphic labels'),
      t('userlayers.graphic-labels-title', 'The text written on tactical graphics (CATK, WUP…)'),
      graphics
    ),
    field(
      t('userlayers.bearings-from', 'Measured bearings from'),
      t('userlayers.bearings-title', 'The north bearings of measurements are given from'),
      north
    )
  )
  return {
    el: section,
    order: 10,
    // Changed elsewhere meanwhile (bearings: loaded from your account).
    refresh: () => {
      units.value = getLabelLevel()
      graphics.value = graphicLabelChoice()
      north.value = measurePrefs.north
      colour.value = newItemColour()
    }
  }
}
