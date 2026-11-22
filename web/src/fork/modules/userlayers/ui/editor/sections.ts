// Fork: an item's card (editor/index.ts): its parts, in order: the title bar, one
// form (its name, its choices, its details, "+ Add detail…", notes), what its kind
// adds, appearance, footer (docs/plans/item-card-redesign.md).
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { DEFAULT_COLOR } from '../../model/model.ts'
import { DEFAULT_FIELDS, GROUPS } from '../../model/fields.constants.ts'
import { addableFields, cardFields, toDtg } from '../../model/fields.ts'
import { MAX_SIZE, MIN_SIZE } from '../../map/render.constants.ts'
import { Card, CardPart } from './types.ts'
import { choiceRows } from './choices.ts'
import { detailRow, formRow, groupedSelect, select } from './controls.ts'

/** The title bar, as every details panel's: its name (or what it is, without one),
 * and what it is in which layer. */
export function headerSection(c: Card, parts: CardPart[]) {
  const { feature, layer, p, itemKind, military, modifiers } = c
  const what =
    itemKind.drawn === 'copy'
      ? t('userlayers.copy-of', 'Copy of a map feature ({{layer}})', { layer: p.copy?.layer })
      : itemKind.what(feature)
  const name = ((military ? modifiers['T'] : p.name) ?? '').trim()
  parts.push(
    el(
      'div.oim-popup-header.oim-ul-card-header',
      el('div.oim-ul-card-titles', el('h3', name || what), el('h4', `${what} · ${layer.name}`))
    )
  )
}

/** The form: its name, its choices, its details, "+ Add detail…" and notes, one row
 * each, every control the same width. */
export function formSection(c: Card, parts: CardPart[]) {
  parts.push(
    el('.oim-ul-form', nameRow(c), ...choiceRows(c), ...detailRows(c), ...addDetailRow(c), notesRow(c))
  )
}

function nameRow(c: Card): HTMLElement {
  const { p, update, military, modifiers, setModifier } = c
  const input = el('input', {
    type: 'text',
    value: ((military ? modifiers['T'] : p.name) ?? '').trim(),
    placeholder: military ? t('userlayers.f.T', 'Unique designation') : '',
    'data-field': 'title'
  }) as HTMLInputElement
  input.onchange = () =>
    military ? setModifier('T', input.value.trim()) : update({ name: input.value.trim() || undefined })
  return formRow(t('userlayers.name', 'Name'), input)
}

/** The details for its kind and any filled in (the name has its own row); the ones
 * added can be removed, the kind's own only emptied. */
function detailRows(c: Card): HTMLElement[] {
  const { military, kind, modifiers, setModifier } = c
  if (!military || !kind) return []
  const own = new Set(DEFAULT_FIELDS[kind])
  return cardFields(kind, modifiers)
    .filter((field) => field.key !== 'T')
    .map((field) => {
      const value = modifiers[field.key] ?? ''
      const removable = !own.has(field.key) || value.trim() !== ''
      return detailRow(field, value, (v) => setModifier(field.key, v), removable)
    })
}

/** "+ Add detail…": the details it doesn't show yet, by the question they answer;
 * the one chosen appears, ready to fill in. */
function addDetailRow(c: Card): HTMLElement[] {
  const { military, kind, modifiers, update } = c
  if (!military || !kind) return []
  const addable = addableFields(kind, modifiers)
  if (!addable.length) return []
  const groups = addable.map(([group, fields]): [string, [string, string][]] => [
    t(`userlayers.group.${group}`, GROUPS.find(([g]) => g === group)![1]),
    fields.map((field): [string, string] => [field.key, t(`userlayers.f.${field.key}`, field.label)])
  ])
  const fields = addable.flatMap(([, f]) => f)
  const add = groupedSelect(
    `+ ${t('userlayers.add-detail', 'Add detail')}…`,
    groups,
    (key) => {
      const field = fields.find((f) => f.key === key)
      // A blank value makes the row appear, ready to fill in.
      const blank = field?.input === 'datetime' ? toDtg(new Date()) : ' '
      update({ modifiers: { ...modifiers, [key]: blank }, name: undefined })
    },
    'add-detail'
  )
  add.classList.add('oim-ul-add-detail')
  return [formRow('', add)]
}

function notesRow(c: Card): HTMLElement {
  const { p, update } = c
  const notes = el('textarea', p.notes ?? '', { rows: 2, 'data-field': 'notes' }) as HTMLTextAreaElement
  notes.onchange = () => update({ notes: notes.value.trim() || undefined })
  return formRow(t('userlayers.notes', 'Notes'), notes)
}

/** What its kind adds (a line of sight's answer, range rings' distances...). */
export function kindSection(c: Card, parts: CardPart[]) {
  const { feature, actions, update, itemKind } = c
  parts.push(...(itemKind.card?.(feature, update, actions.setGeometry) ?? []))
}

/** Its appearance, folded: size (and a reset), colour, line width. */
export function appearanceSection(c: Card, parts: CardPart[]) {
  const { feature, p, update, itemKind } = c
  const look: HTMLElement[] = []
  if (itemKind.sized && feature.geometry.type === 'Point') look.push(sizeRow(p.size ?? 1, update))
  if (itemKind.coloured) {
    const color = el('input', {
      type: 'color',
      value: p.color ?? DEFAULT_COLOR,
      'data-field': 'color'
    }) as HTMLInputElement
    color.onchange = () => update({ color: color.value })
    look.push(formRow(t('userlayers.color', 'Colour'), color))
  }
  if (itemKind.lineWidth && feature.geometry.type !== 'Point') {
    const width = el('input', {
      type: 'range',
      min: '1',
      max: '12',
      step: '1',
      value: String(p.width ?? 3),
      'data-field': 'width'
    }) as HTMLInputElement
    width.onchange = () => update({ width: Number(width.value) })
    look.push(formRow(t('userlayers.width', 'Line width'), width))
  }
  if (!look.length) return
  parts.push(
    el(
      'details.oim-ul-editor-section',
      { open: Boolean(itemKind.appearanceFirst) },
      el('summary', t('userlayers.s.appearance', 'Appearance')),
      ...look
    )
  )
}

function sizeRow(value: number, update: Card['update']): HTMLElement {
  const size = el('input', {
    type: 'range',
    min: String(MIN_SIZE),
    max: String(MAX_SIZE),
    step: '0.05',
    value: String(value),
    'data-field': 'size',
    title: `${Math.round(value * 100)} %`
  }) as HTMLInputElement
  size.oninput = () => (size.title = `${Math.round(Number(size.value) * 100)} %`)
  size.onchange = () => update({ size: Number(size.value) })
  const reset = el('button.oim-ul-button', t('userlayers.reset', 'Reset'), {
    type: 'button',
    title: t('userlayers.size-reset', 'Normal size')
  }) as HTMLButtonElement
  reset.disabled = value === 1
  reset.onclick = () => update({ size: 1 })
  return formRow(t('userlayers.size', 'Size'), el('span.oim-ul-control', size, reset))
}

/** The footer: its layer, duplicate, delete, done. */
export function footerSection(c: Card, parts: CardPart[]) {
  const { layer, layers, actions } = c
  const layerSelect = select(
    layers.map((l): [string, string] => [l.id, l.name]),
    layer.id,
    (v) => v !== layer.id && actions.moveTo(v),
    'layer'
  )
  layerSelect.title = t('userlayers.f.layer', 'Layer')
  // Nothing goes into a layer that can't be changed (locked).
  for (const option of layerSelect.options) {
    const l = layers.find((x) => x.id === option.value)
    if (l && !actions.canEdit(l) && l.id !== layer.id) {
      option.disabled = true
      option.textContent = `🔒 ${l.name}`
    }
  }
  const button = (label: string, onclick: () => void, primary = false) => {
    const b = el(`button.oim-ul-button${primary ? '.primary' : ''}`, label, { type: 'button' })
    b.onclick = onclick
    return b
  }
  parts.push(
    el(
      '.oim-ul-card-footer',
      layerSelect,
      button(t('userlayers.duplicate', 'Duplicate'), actions.duplicate),
      button(t('userlayers.delete', 'Delete'), actions.remove),
      button(t('userlayers.deselect', 'Done'), actions.done, true)
    )
  )
}
