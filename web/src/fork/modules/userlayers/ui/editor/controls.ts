// Fork: an item's card (editor/index.ts): the small controls its parts are built
// from (chips, selects, a detail's row).
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { Field, displayValue, fromDtg, toDtg } from '../../model/fields.ts'

export function chip(label: string, active: boolean, onclick: () => void, title = '') {
  const b = el(`button.oim-ul-chip${active ? '.oim-on' : ''}`, label, {
    type: 'button',
    title,
    'aria-pressed': String(active)
  }) as HTMLButtonElement
  b.onclick = onclick
  return b
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

/** A datetime-local input value (local time) for a DTG. */
export function dtgToInput(dtg: string | undefined): string {
  const date = dtg ? fromDtg(dtg) : null
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

/** One detail: its name, and its value; text is edited in place, the rest is shown
 * in words and turns into its controls when clicked. */
export function detailRow(field: Field, value: string, set: (value: string) => void): HTMLElement {
  const name = `${field.key}:${field.label}`
  const label = t(`userlayers.f.${field.key}`, field.label)
  const trimmed = value.trim()
  let editor: HTMLElement
  if (field.input === 'datetime') {
    const input = el('input', {
      type: 'datetime-local',
      value: dtgToInput(trimmed),
      'data-field': name
    }) as HTMLInputElement
    input.onchange = () => set(input.value ? toDtg(new Date(input.value)) : '')
    const now = el('button.oim-ul-button', t('userlayers.now', 'Now'), { type: 'button' })
    now.onclick = () => set(toDtg(new Date()))
    editor = el('span.oim-ul-unit', input, now)
  } else if (field.input === 'rating') {
    const letters: [string, string][] = [
      ['', '–'],
      ...'ABCDEF'.split('').map((c): [string, string] => [c, c])
    ]
    const digits: [string, string][] = [['', '–'], ...'123456'.split('').map((c): [string, string] => [c, c])]
    editor = el(
      'span.oim-ul-rating',
      select(letters, trimmed[0] ?? '', (v) => set(v ? v + (trimmed[1] ?? '') : ''), name + ':r'),
      select(digits, trimmed[1] ?? '', (v) => set((trimmed[0] ?? 'F') + v), name + ':c')
    )
  } else if (field.input === 'textarea') {
    const area = el('textarea.oim-ul-inline-input', trimmed, {
      rows: 2,
      'data-field': name,
      placeholder: '—'
    }) as HTMLTextAreaElement
    area.onchange = () => set(area.value.trim())
    editor = area
  } else {
    const input = el('input.oim-ul-inline-input', {
      type: field.input === 'number' ? 'number' : 'text',
      value: trimmed,
      placeholder: '—',
      'data-field': name
    }) as HTMLInputElement
    input.onchange = () => set(input.value.trim())
    editor = field.unit ? el('span.oim-ul-unit', input, el('small', field.unit)) : input
  }
  const inPlace =
    field.input === 'text' ||
    field.input === 'textarea' ||
    (field.input === 'number' && field.key !== 'Q' && field.key !== 'Z')
  const row = el('.oim-ul-detail', { title: field.help ?? '' }, el('span.oim-ul-detail-name', label))
  if (inPlace || !trimmed) {
    row.append(editor)
    return row
  }
  const shown = el('button.oim-ul-detail-value', displayValue(field.key, trimmed), {
    type: 'button',
    title: t('userlayers.edit', 'Change')
  })
  shown.onclick = () => {
    shown.replaceWith(editor)
    editor.querySelector<HTMLElement>('input, select')?.focus()
  }
  row.append(shown)
  return row
}
