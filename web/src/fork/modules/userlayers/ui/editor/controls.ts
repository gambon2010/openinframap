// Fork: an item's card (editor/index.ts): the controls its form is built from. Every
// row is a label and its control, the control filling the rest, a × at the end of
// the details that can be removed (docs/plans/item-card-redesign.md).
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { Field } from '../../model/fields.types.ts'
import { displayValue, fromDtg, toDtg } from '../../model/fields.ts'
import { UNITS } from '../../model/units.constants.ts'
import { angleFrom, angleIn, joinValue, lastUnit, rememberUnit, splitValue } from '../../model/units.ts'
import type { Quantity, Unit } from '../../model/units.types.ts'

/** A row of the card's form: its label, its control, and a × when it can be removed. */
export function formRow(label: string, control: HTMLElement, remove?: () => void, help = ''): HTMLElement {
  const end = remove
    ? el('button.oim-ul-row-remove', '×', {
        type: 'button',
        title: t('userlayers.remove-detail', 'Remove'),
        'aria-label': t('userlayers.remove-detail', 'Remove')
      })
    : el('span')
  if (remove) (end as HTMLButtonElement).onclick = remove
  return el('.oim-ul-detail', { title: help }, el('span.oim-ul-detail-name', label), control, end)
}

export function select(
  options: [string, string][],
  value: string,
  onchange: (value: string) => void,
  field: string
) {
  const s = el(
    'select',
    { 'data-field': field },
    options.map(([v, label]) => el('option', label, { value: v, selected: v === value }))
  ) as HTMLSelectElement
  s.onchange = () => onchange(s.value)
  return s
}

/** A dropdown of choices by group (the browser draws the groups); its first line
 * says what it's for and chooses nothing. */
export function groupedSelect(
  prompt: string,
  groups: [string, [string, string][]][],
  onchange: (value: string) => void,
  field: string
): HTMLSelectElement {
  const s = el(
    'select',
    { 'data-field': field },
    el('option', prompt, { value: '' }),
    groups.map(([label, options]) =>
      el(
        'optgroup',
        { label },
        options.map(([v, text]) => el('option', text, { value: v }))
      )
    )
  ) as HTMLSelectElement
  s.onchange = () => s.value && onchange(s.value)
  return s
}

/** A tick box with its label, for something on or off. */
export function checkbox(label: string, checked: boolean, onchange: (on: boolean) => void, title = '') {
  const box = el('input', { type: 'checkbox', checked }) as HTMLInputElement
  box.onchange = () => onchange(box.checked)
  return el('label.oim-ul-check', { title }, box, label)
}

/** A datetime-local input value (local time) for a DTG. */
export function dtgToInput(dtg: string | undefined): string {
  const date = dtg ? fromDtg(dtg) : null
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

/** One detail's row: its name, its control, a × when `removable`. */
export function detailRow(
  field: Field,
  value: string,
  set: (value: string) => void,
  removable: boolean
): HTMLElement {
  const label = t(`userlayers.f.${field.key}`, field.label)
  const control = detailControl(field, value.trim(), set, `${field.key}:${field.label}`)
  return formRow(label, control, removable ? () => set('') : undefined, field.help ?? '')
}

function detailControl(field: Field, value: string, set: (value: string) => void, name: string): HTMLElement {
  if (field.input === 'datetime') return dateControl(value, set, name)
  if (field.input === 'rating') return ratingControl(value, set, name)
  if (field.input === 'textarea') return textControl('textarea', value, set, name)
  if (field.quantity === 'angle') return angleControl(field.key, value, set, name)
  if (field.quantity) return amountControl(field, field.quantity, value, set, name)
  return textControl(field.input === 'number' ? 'number' : 'text', value, set, name)
}

function textControl(
  kind: 'text' | 'number' | 'textarea',
  value: string,
  set: (value: string) => void,
  name: string
): HTMLElement {
  const input =
    kind === 'textarea'
      ? (el('textarea', value, { rows: 2, 'data-field': name }) as HTMLTextAreaElement)
      : (el('input', { type: kind, value, 'data-field': name }) as HTMLInputElement)
  input.onchange = () => set(input.value.trim())
  return input
}

/** A date: in words ("30 Oct 12:00Z"), turned into its input when clicked and back
 * into words when left; "Now" beside it. */
function dateControl(value: string, set: (value: string) => void, name: string): HTMLElement {
  const words = el('button.oim-ul-detail-value', value ? displayValue('W', value) : '—', {
    type: 'button',
    title: t('userlayers.edit', 'Change'),
    'data-field': name
  }) as HTMLButtonElement
  const input = el('input', { type: 'datetime-local', value: dtgToInput(value) }) as HTMLInputElement
  input.onchange = () => set(input.value ? toDtg(new Date(input.value)) : '')
  input.onblur = () => input.replaceWith(words)
  words.onclick = () => {
    words.replaceWith(input)
    input.focus()
  }
  const now = el('button.oim-ul-button', t('userlayers.now', 'Now'), { type: 'button' }) as HTMLButtonElement
  now.onclick = () => set(toDtg(new Date()))
  return el('span.oim-ul-control', words, now)
}

/** A source's rating: its reliability (A–F) and the information's credibility (1–6). */
function ratingControl(value: string, set: (value: string) => void, name: string): HTMLElement {
  const letters: [string, string][] = [['', '–'], ...'ABCDEF'.split('').map((c): [string, string] => [c, c])]
  const digits: [string, string][] = [['', '–'], ...'123456'.split('').map((c): [string, string] => [c, c])]
  return el(
    'span.oim-ul-control',
    select(letters, value[0] ?? '', (v) => set(v ? v + (value[1] ?? '') : ''), name + ':r'),
    select(digits, value[1] ?? '', (v) => set((value[0] ?? 'F') + v), name + ':c')
  )
}

/** A speed, distance or altitude: the amount, and its unit beside it, kept together
 * as written ("30 kn"). */
function amountControl(
  field: Field,
  quantity: Quantity,
  value: string,
  set: (value: string) => void,
  name: string
): HTMLElement {
  const split = value ? splitValue(value, quantity) : { amount: '', unit: lastUnit(field.key, quantity) }
  let unit = split.unit
  const input = el('input', {
    type: field.input === 'number' ? 'number' : 'text',
    value: split.amount,
    'data-field': name
  }) as HTMLInputElement
  input.onchange = () => set(joinValue(input.value, unit))
  const units = unitSelect(quantity, unit, name, (chosen) => {
    unit = chosen
    rememberUnit(field.key, chosen)
    if (input.value.trim()) set(joinValue(input.value, unit))
  })
  return el('span.oim-ul-control', input, units)
}

/** A direction: kept in degrees (it turns the symbol's arrow), shown in the unit
 * chosen beside it. */
function angleControl(key: string, value: string, set: (value: string) => void, name: string): HTMLElement {
  let unit = lastUnit(key, 'angle')
  const degrees = value === '' ? null : Number(value)
  const input = el('input', { type: 'number', 'data-field': name }) as HTMLInputElement
  const show = () =>
    (input.value = degrees === null || Number.isNaN(degrees) ? '' : String(angleIn(degrees, unit)))
  show()
  input.onchange = () => set(input.value.trim() ? String(angleFrom(Number(input.value), unit)) : '')
  const units = unitSelect('angle', unit, name, (chosen) => {
    unit = chosen
    rememberUnit(key, chosen)
    show()
  })
  return el('span.oim-ul-control', input, units)
}

function unitSelect(quantity: Quantity, unit: Unit, name: string, chosen: (unit: Unit) => void) {
  const units = UNITS[quantity]
  return select(
    units.map((u): [string, string] => [u.symbol, u.symbol]),
    unit.symbol,
    (symbol) => chosen(units.find((u) => u.symbol === symbol) ?? units[0]),
    name + ':unit'
  )
}
