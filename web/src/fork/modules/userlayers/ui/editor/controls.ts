// Fork: an item's card (editor/index.ts): the controls its form is built from. Every
// row is a label and its control, the control filling the rest, a × at the end of
// the details that can be removed, a tooltip on each label saying what it is; a
// number outside what's allowed is outlined, says why and isn't kept
// (docs/plans/item-card-redesign.md).
import { openContextMenuFor } from '../../../../ui/context-menu.ts'
import { identityOptions } from '../../model/labels.ts'
import { identityIcon } from '../identity-icons.ts'
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { Field } from '../../model/fields.types.ts'
import { displayValue, fieldName, fromDtg, toDtg } from '../../model/fields.ts'
import { UNITS } from '../../model/units.constants.ts'
import {
  angleFrom,
  angleIn,
  joinValue,
  lastUnit,
  rangeProblem,
  rememberUnit,
  splitValue
} from '../../model/units.ts'
import type { AllowedRange, Quantity, RangeProblem, Unit } from '../../model/units.types.ts'

/** A plain number's "unit": the number itself. */
const PLAIN: Unit = { symbol: '', factor: 1 }

/** A row of the card's form: its label (`help`: its tooltip), its control, and a ×
 * when it can be removed. */
export function formRow(label: string, control: HTMLElement, remove?: () => void, help = ''): HTMLElement {
  const end = remove
    ? el('button.oim-ul-row-remove', '×', {
        type: 'button',
        title: t('userlayers.remove-detail', 'Remove'),
        'aria-label': t('userlayers.remove-detail', 'Remove')
      })
    : el('span')
  if (remove) (end as HTMLButtonElement).onclick = remove
  return el('.oim-ul-detail', el('span.oim-ul-detail-name', { title: help }, label), control, end)
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

/** An identity chosen as from a dropdown, each with its frame (a dropdown's lines
 * can't hold pictures): a button showing the one chosen ('' for several different:
 * `unchosen`), opening the list of them. */
export function identityChoice(
  value: string,
  onchange: (value: string) => void,
  field: string,
  unchosen = ''
): HTMLButtonElement {
  const options = identityOptions()
  const chosen = options.find(([code]) => code === value)
  const shown: Node[] = chosen ? [identityIcon(chosen[0], 16), el('span', chosen[1])] : [el('span', unchosen)]
  const button = el(
    'button.oim-ul-choice',
    { type: 'button', 'data-field': field, 'aria-haspopup': 'menu' },
    ...shown,
    el('span.oim-ul-choice-arrow', '▾')
  ) as HTMLButtonElement
  button.onclick = () =>
    openContextMenuFor(
      button,
      options.map(([code, label]) => ({
        label,
        icon: identityIcon(code, 16),
        disabled: code === value,
        run: () => onchange(code)
      }))
    )
  return button
}

/** A dropdown whose first line says what it's for and chooses nothing. */
export function promptSelect(
  prompt: string,
  options: [string, string][],
  onchange: (value: string) => void,
  field: string
): HTMLSelectElement {
  const s = select([['', prompt], ...options], '', (v) => v && onchange(v), field)
  return s
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
  const label = fieldName(field)
  const control = detailControl(field, value.trim(), set, `${field.key}:${field.label}`)
  return formRow(label, control, removable ? () => set('') : undefined, field.help ?? '')
}

function detailControl(field: Field, value: string, set: (value: string) => void, name: string): HTMLElement {
  if (field.input === 'datetime') return dateControl(value, set, name)
  if (field.input === 'rating') return ratingControl(value, set, name)
  if (field.quantity === 'angle') return angleControl(field, value, set, name)
  if (field.quantity) return amountControl(field, field.quantity, value, set, name)
  if (field.input === 'number') return numberControl(field, value, set, name)
  return textControl(value, set, name)
}

/** A plain number (a quantity): kept only within what's allowed. */
function numberControl(field: Field, value: string, set: (value: string) => void, name: string): HTMLElement {
  const input = el('input', { type: 'number', value, 'data-field': name }) as HTMLInputElement
  allowRange(input, field, PLAIN)
  input.onchange = () => keepIfAllowed(input, field, PLAIN, () => set(input.value.trim()))
  return input
}

function textControl(value: string, set: (value: string) => void, name: string): HTMLElement {
  const input = el('input', { type: 'text', value, 'data-field': name }) as HTMLInputElement
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
  allowRange(input, field, unit)
  const keep = () => keepIfAllowed(input, field, unit, () => set(joinValue(input.value, unit)))
  input.onchange = keep
  const units = unitSelect(quantity, unit, name, (chosen) => {
    unit = chosen
    rememberUnit(field.key, chosen)
    allowRange(input, field, unit)
    if (input.value.trim()) keep()
  })
  // The number stays as typed: a speed's unit is part of its label.
  units.title = t('userlayers.unit-no-conversion', "Changing the unit doesn't convert the number.")
  return el('span.oim-ul-control', input, units)
}

/** A direction: kept in degrees (it turns the symbol's arrow), shown in the unit
 * chosen beside it. */
function angleControl(field: Field, value: string, set: (value: string) => void, name: string): HTMLElement {
  const key = field.key
  let unit = lastUnit(key, 'angle')
  const degrees = value === '' ? null : Number(value)
  const input = el('input', { type: 'number', 'data-field': name }) as HTMLInputElement
  const show = () =>
    (input.value = degrees === null || Number.isNaN(degrees) ? '' : String(angleIn(degrees, unit)))
  show()
  allowRange(input, field, unit)
  input.onchange = () =>
    keepIfAllowed(input, field, unit, () =>
      set(input.value.trim() ? String(angleFrom(Number(input.value), unit)) : '')
    )
  const units = unitSelect('angle', unit, name, (chosen) => {
    unit = chosen
    rememberUnit(key, chosen)
    allowRange(input, field, unit)
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

/** The browser's own limits on a number input, in the unit shown (its arrows stop
 * there). */
function allowRange(input: HTMLInputElement, range: AllowedRange, unit: Unit) {
  input.min = range.min === undefined ? '' : String(range.min / unit.factor)
  input.max = range.max === undefined ? '' : String(range.max / unit.factor)
}

/** Keeps a typed value if it's allowed; otherwise outlines the input and says why in
 * its tooltip (nothing kept: the card shows the last value kept once rebuilt). */
function keepIfAllowed(input: HTMLInputElement, range: AllowedRange, unit: Unit, keep: () => void) {
  const problem = rangeProblem(input.value, unit, range)
  input.classList.toggle('oim-ul-invalid', problem !== null)
  input.title = problem ? problemText(problem, range, unit) : ''
  if (!problem) keep()
}

function problemText(problem: RangeProblem, range: AllowedRange, unit: Unit): string {
  const inUnit = (value: number) => `${Math.round((value / unit.factor) * 10) / 10} ${unit.symbol}`.trim()
  if (problem === 'not-a-number') return t('userlayers.not-a-number', 'Not a number')
  if (problem === 'too-low')
    return t('userlayers.too-low', 'At least {{min}}', { min: inUnit(range.min ?? 0) })
  return t('userlayers.too-high', 'At most {{max}}', { max: inUnit(range.max ?? 0) })
}
