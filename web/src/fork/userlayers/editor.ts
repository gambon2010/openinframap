// Fork: the card of a selected My layers item, in the left details panel (the
// sidebar's inspector, docs/plans/my-layers-v3.md). Read first, edit in place:
// - a header with the symbol (large, live) and its designation;
// - identity, status, echelon, HQ / task force / dummy as clickable shapes and marks
//   (they're part of the code: sidc.ts);
// - the details that matter for its kind, plus any filled in, in plain words
//   (fields.ts); "+ Add detail" for the rest, by question (who, what, when...);
// - notes, appearance, layer, duplicate / delete.
// Each change is a change of the feature (undoable, saved with Save, in the history).
import { tt } from './i18n.ts'
import { el } from 'redom'
import { FeatureProps, UserFeature, UserLayer, DEFAULT_COLOR } from './model.ts'
import { Field, GROUPS, addableFields, cardFields, displayValue, fromDtg, toDtg } from './fields.ts'
import {
  IDENTITIES,
  MOBILITIES,
  identity,
  mobility,
  status,
  symbolKind,
  unitModifiers,
  withIdentity,
  withMobility,
  withStatus,
  withUnitModifiers
} from './sidc.ts'
import { GEOMETRY_LABELS, entryOf, symbolName } from './palette.ts'
import { symbolSvg } from './symbols.ts'
import { MAX_SIZE, MIN_SIZE } from './render.ts'

export interface EditorActions {
  update: (properties: FeatureProps) => void
  moveTo: (layerId: string) => void
  duplicate: () => void
  remove: () => void
  done: () => void
}

// Echelons as their marks above the frame.
export const ECHELON_MARKS: [string, string, string][] = [
  ['-', '–', 'None'],
  ['A', 'ø', 'Team / crew'],
  ['B', '•', 'Squad'],
  ['C', '••', 'Section'],
  ['D', '•••', 'Platoon'],
  ['E', '|', 'Company'],
  ['F', '||', 'Battalion'],
  ['G', '|||', 'Regiment'],
  ['H', 'X', 'Brigade'],
  ['I', 'XX', 'Division'],
  ['J', 'XXX', 'Corps'],
  ['K', 'XXXX', 'Army']
]
const MAIN_IDENTITIES = ['F', 'H', 'N', 'U']
const CONDITIONS: [string, string][] = [
  ['C', 'Fully capable'],
  ['D', 'Damaged'],
  ['X', 'Destroyed'],
  ['F', 'Full to capacity']
]

function chip(label: string, active: boolean, onclick: () => void, title = '') {
  const b = el(`button.oim-ul-chip${active ? '.active' : ''}`, label, {
    type: 'button',
    title,
    'aria-pressed': String(active)
  }) as HTMLButtonElement
  b.onclick = onclick
  return b
}

function select(
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
function dtgToInput(dtg: string | undefined): string {
  const date = dtg ? fromDtg(dtg) : null
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

/** One detail: its name, and its value; text is edited in place, the rest is shown
 * in words and turns into its controls when clicked. */
function detailRow(field: Field, value: string, set: (value: string) => void): HTMLElement {
  const name = `${field.key}:${field.label}`
  const label = tt(`userlayers.f.${field.key}`, field.label)
  const trimmed = value.trim()
  let editor: HTMLElement
  if (field.input === 'datetime') {
    const input = el('input', {
      type: 'datetime-local',
      value: dtgToInput(trimmed),
      'data-field': name
    }) as HTMLInputElement
    input.onchange = () => set(input.value ? toDtg(new Date(input.value)) : '')
    const now = el('button.oim-ul-button', tt('userlayers.now', 'Now'), { type: 'button' })
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
    const t = el('textarea.oim-ul-inline-input', trimmed, {
      rows: 2,
      'data-field': name,
      placeholder: '—'
    }) as HTMLTextAreaElement
    t.onchange = () => set(t.value.trim())
    editor = t
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
    title: tt('userlayers.edit', 'Change')
  })
  shown.onclick = () => {
    shown.replaceWith(editor)
    editor.querySelector<HTMLElement>('input, select')?.focus()
  }
  row.append(shown)
  return row
}

/** The card for a feature. */
export async function buildEditor(
  feature: UserFeature,
  layer: UserLayer,
  layers: UserLayer[],
  actions: EditorActions
): Promise<HTMLElement> {
  const p = feature.properties
  const update = (changes: Partial<FeatureProps>) => actions.update({ ...p, ...changes })
  const military = (p.kind === 'symbol' || p.kind === 'graphic') && Boolean(p.sidc)
  const sidc = p.sidc ?? ''
  const kind = military ? symbolKind(sidc) : null
  const parts: (HTMLElement | string)[] = []

  // --- Header: the symbol, large, and the designation (rename in place) ---
  const preview = el('span.oim-ul-card-symbol')
  let what = tt(`userlayers.kind.${p.kind}`, p.kind)
  if (military) {
    what = symbolName(sidc) ?? sidc
    const geometry = entryOf(sidc)?.[3]
    if (p.kind === 'symbol') {
      try {
        preview.innerHTML = await symbolSvg(sidc, 36)
      } catch {
        // No preview.
      }
    } else if (geometry) {
      preview.textContent = GEOMETRY_LABELS[geometry][0]
    }
  } else if (p.kind === 'copy') {
    what = tt('userlayers.copy-of', 'Copy of a map feature ({{layer}})', { layer: p.copy?.layer })
  }
  const modifiers = { ...(p.modifiers ?? {}) }
  // Items made before the fields existed had a name: it's the designation.
  if (military && !modifiers['T'] && p.name) modifiers['T'] = p.name
  const title = el('input.oim-ul-card-title', {
    type: 'text',
    value: ((military ? modifiers['T'] : p.name) ?? '').trim(),
    placeholder: military ? tt('userlayers.f.T', 'Unique designation') : tt('userlayers.name', 'Name'),
    'data-field': 'title',
    'aria-label': tt('userlayers.name', 'Name')
  }) as HTMLInputElement
  const setModifier = (key: string, value: string) => {
    const next = { ...modifiers, [key]: value }
    if (!value) delete next[key]
    update({ modifiers: next, name: undefined })
  }
  title.onchange = () =>
    military ? setModifier('T', title.value.trim()) : update({ name: title.value.trim() || undefined })
  parts.push(
    el(
      'div.oim-popup-header.oim-ul-card-header',
      preview,
      el('div.oim-ul-card-titles', title, el('span.oim-ul-what', `${what} · ${layer.name}`))
    )
  )

  // --- Identity strip (military symbols and graphics) ---
  if (military && kind) {
    const setSidc = (next: string) => update({ sidc: next })
    const strip: HTMLElement[] = []
    const ids = el('.oim-ul-frames')
    for (const id of MAIN_IDENTITIES) {
      const label = IDENTITIES.find(([c]) => c === id)?.[1] ?? id
      const b = el(`button.oim-ul-frame${identity(sidc) === id ? '.active' : ''}`, {
        type: 'button',
        title: tt(`userlayers.affiliation.${id}`, label),
        'aria-pressed': String(identity(sidc) === id)
      })
      if (p.kind === 'symbol') {
        try {
          b.innerHTML = await symbolSvg(withIdentity(sidc, id), 16)
        } catch {
          b.textContent = id
        }
      } else {
        b.append(el(`span.oim-ul-identity-dot.oim-ul-identity-${id}`), label)
      }
      b.onclick = () => setSidc(withIdentity(sidc, id))
      ids.append(b)
    }
    const others = IDENTITIES.filter(([c]) => !MAIN_IDENTITIES.includes(c))
    ids.append(
      select(
        [['', tt('userlayers.more-identities', 'More…')], ...others],
        MAIN_IDENTITIES.includes(identity(sidc)) ? '' : identity(sidc),
        (v) => v && setSidc(withIdentity(sidc, v)),
        'identity-more'
      )
    )
    strip.push(ids)
    const st = status(sidc)
    const statusRow = el(
      '.oim-ul-chips',
      chip(tt('userlayers.status.P', 'Present'), st !== 'A', () => setSidc(withStatus(sidc, 'P'))),
      chip(tt('userlayers.status.A', 'Planned'), st === 'A', () => setSidc(withStatus(sidc, 'A')))
    )
    if (kind !== 'graphic') {
      for (const [code, label] of CONDITIONS) {
        statusRow.append(
          chip(tt(`userlayers.condition.${code}`, label), st === code, () =>
            setSidc(withStatus(sidc, st === code ? 'P' : code))
          )
        )
      }
    }
    strip.push(statusRow)
    if (kind === 'unit') {
      const m = unitModifiers(sidc)
      strip.push(
        el(
          '.oim-ul-echelons',
          ECHELON_MARKS.map(([code, mark, label]) =>
            chip(
              mark,
              m.echelon === code,
              () => setSidc(withUnitModifiers(sidc, { ...m, echelon: code })),
              tt(`userlayers.echelon.${code}`, label)
            )
          )
        ),
        el(
          '.oim-ul-chips',
          chip(
            tt('userlayers.f.hq', 'HQ'),
            m.hq,
            () => setSidc(withUnitModifiers(sidc, { ...m, hq: !m.hq })),
            tt('userlayers.f.hq-title', 'Headquarters')
          ),
          chip(tt('userlayers.f.task-force', 'Task force'), m.taskForce, () =>
            setSidc(withUnitModifiers(sidc, { ...m, taskForce: !m.taskForce }))
          ),
          chip(
            tt('userlayers.f.feint', 'Dummy'),
            m.feint,
            () => setSidc(withUnitModifiers(sidc, { ...m, feint: !m.feint })),
            tt('userlayers.f.feint-title', 'Feint / dummy')
          )
        )
      )
    }
    if (kind === 'equipment' && sidc[2] === 'G') {
      strip.push(
        el(
          'label.oim-ul-detail',
          el('span.oim-ul-detail-name', tt('userlayers.f.mobility', 'Mobility')),
          select(MOBILITIES, mobility(sidc), (v) => setSidc(withMobility(sidc, v)), 'mobility')
        )
      )
    }
    parts.push(el('.oim-ul-identity', ...strip))
  }

  // --- Details: the ones for its kind and any filled in; the rest one click away ---
  if (military && kind) {
    const details = el('.oim-ul-details')
    for (const field of cardFields(kind, modifiers)) {
      if (field.key === 'T') continue // in the header
      details.append(detailRow(field, modifiers[field.key] ?? '', (v) => setModifier(field.key, v)))
    }
    parts.push(details)
    const addable = addableFields(kind, modifiers)
    if (addable.length) {
      parts.push(
        el(
          'details.oim-ul-menu.oim-ul-add-detail',
          el('summary', `+ ${tt('userlayers.add-detail', 'Add detail')}`),
          el(
            '.oim-ul-menu-items',
            ...addable.flatMap(([group, fields]) => [
              el('h4', tt(`userlayers.group.${group}`, GROUPS.find(([g]) => g === group)![1])),
              ...fields.map((field) => {
                const b = el(
                  'button.oim-ul-add-field',
                  el('strong', tt(`userlayers.f.${field.key}`, field.label)),
                  field.help ? el('small', field.help) : '',
                  { type: 'button' }
                )
                // A blank value makes the row appear, ready to fill in.
                b.onclick = () =>
                  update({
                    modifiers: {
                      ...modifiers,
                      [field.key]: field.input === 'datetime' ? toDtg(new Date()) : ' '
                    },
                    name: undefined
                  })
                return b
              })
            ])
          )
        )
      )
    }
  }

  // --- Notes, always there ---
  const notes = el('textarea.oim-ul-inline-input.oim-ul-notes', p.notes ?? '', {
    rows: 2,
    'data-field': 'notes',
    placeholder: tt('userlayers.notes-placeholder', 'Notes…')
  }) as HTMLTextAreaElement
  notes.onchange = () => update({ notes: notes.value.trim() || undefined })
  parts.push(notes)

  // --- Appearance ---
  const look: HTMLElement[] = []
  const lookRow = (label: string, control: HTMLElement) =>
    el('.oim-ul-detail', el('span.oim-ul-detail-name', label), control)
  if (p.kind === 'symbol' || p.kind === 'image' || p.kind === 'marker') {
    const value = p.size ?? 1
    const size = el('input', {
      type: 'range',
      min: String(MIN_SIZE),
      max: String(MAX_SIZE),
      step: '0.05',
      value: String(value),
      'data-field': 'size'
    }) as HTMLInputElement
    const shown = el('small', `${Math.round(value * 100)} %`)
    size.oninput = () => (shown.textContent = `${Math.round(Number(size.value) * 100)} %`)
    size.onchange = () => update({ size: Number(size.value) })
    const reset = el('button.oim-ul-button', '100 %', {
      type: 'button',
      title: tt('userlayers.size-reset', 'Normal size')
    })
    reset.onclick = () => update({ size: 1 })
    look.push(lookRow(tt('userlayers.size', 'Size'), el('span.oim-ul-unit', size, shown, reset)))
  }
  if (p.kind === 'drawing' || p.kind === 'marker' || p.kind === 'graphic') {
    const color = el('input', {
      type: 'color',
      value: p.color ?? layer.style.color ?? DEFAULT_COLOR,
      'data-field': 'color'
    }) as HTMLInputElement
    color.onchange = () => update({ color: color.value })
    look.push(lookRow(tt('userlayers.color', 'Colour'), color))
  }
  if (p.kind === 'drawing' && feature.geometry.type !== 'Point') {
    const width = el('input', {
      type: 'range',
      min: '1',
      max: '12',
      step: '1',
      value: String(p.width ?? 3),
      'data-field': 'width'
    }) as HTMLInputElement
    width.onchange = () => update({ width: Number(width.value) })
    look.push(lookRow(tt('userlayers.width', 'Line width'), width))
  }
  if (look.length) {
    parts.push(
      el(
        'details.oim-ul-editor-section',
        { open: p.kind === 'image' },
        el('summary', tt('userlayers.s.appearance', 'Appearance')),
        ...look
      )
    )
  }

  // --- Hint, then the footer: layer, duplicate, delete, done ---
  const hint =
    feature.geometry.type === 'Point'
      ? tt('userlayers.drag-hint', 'Drag it on the map to move it.')
      : p.kind === 'copy'
        ? ''
        : p.axis || p.axisWidth !== undefined
          ? tt(
              'userlayers.drag-arrow-hint',
              'Drag the points of its path to move or bend it, and the blue handle to make it wider or narrower.'
            )
          : tt('userlayers.drag-points-hint', 'Drag its points on the map to change its shape.')
  if (hint) parts.push(el('p.oim-ul-hint', hint))
  const layerSelect = select(
    layers.map((l): [string, string] => [l.id, l.name]),
    layer.id,
    (v) => v !== layer.id && actions.moveTo(v),
    'layer'
  )
  layerSelect.title = tt('userlayers.f.layer', 'Layer')
  const button = (label: string, onclick: () => void, primary = false) => {
    const b = el(`button.oim-ul-button${primary ? '.primary' : ''}`, label, { type: 'button' })
    b.onclick = onclick
    return b
  }
  parts.push(
    el(
      '.oim-ul-card-footer',
      layerSelect,
      button(tt('userlayers.duplicate', 'Duplicate'), actions.duplicate),
      button(tt('userlayers.delete', 'Delete'), actions.remove),
      button(tt('userlayers.deselect', 'Done'), actions.done, true)
    )
  )
  return el('div.oim-popup-content.oim-ul-editor', ...parts)
}

export interface BulkActions {
  /** Apply a change to the properties of each selected item (one undo step). */
  updateEach: (change: (properties: FeatureProps) => FeatureProps | null) => void
  moveTo: (layerId: string) => void
  remove: () => void
  clear: () => void
}

/** The card for several selected items: what they are, and changes for all of them. */
export function buildBulkCard(
  items: { feature: UserFeature; layer: UserLayer }[],
  layers: UserLayer[],
  actions: BulkActions
): HTMLElement {
  const unlocked = items.filter((i) => !i.layer.style.locked)
  const military = unlocked.filter((i) => i.feature.properties.sidc)
  const parts: (HTMLElement | string)[] = []
  parts.push(
    el(
      'div.oim-popup-header.oim-ul-card-header',
      el('span.oim-ul-card-symbol', '▣'),
      el(
        'div.oim-ul-card-titles',
        el('h3', tt('userlayers.n-selected', '{{count}} items selected', { count: items.length })),
        el('span.oim-ul-what', tt('userlayers.bulk-hint', 'Changes below apply to all of them'))
      )
    )
  )
  const names = items.map(({ feature }) => {
    const p = feature.properties
    const name = (p.modifiers?.['T'] || p.name || '').trim()
    const what = p.sidc ? (symbolName(p.sidc) ?? p.sidc) : tt(`userlayers.kind.${p.kind}`, p.kind)
    return el('li', name ? `${name} · ${what}` : what)
  })
  parts.push(el('ul.oim-ul-bulk-list', names))
  if (unlocked.length < items.length) {
    parts.push(
      el(
        'p.oim-ul-locked-note',
        tt('userlayers.bulk-locked', '🔒 {{count}} in locked layers are left as they are.', {
          count: items.length - unlocked.length
        })
      )
    )
  }
  if (military.length) {
    const setSidc = (change: (sidc: string) => string) =>
      actions.updateEach((p) => (p.sidc ? { ...p, sidc: change(p.sidc) } : null))
    parts.push(
      el(
        '.oim-ul-identity',
        el(
          '.oim-ul-chips',
          ...MAIN_IDENTITIES.map((id) =>
            chip(
              IDENTITIES.find(([c]) => c === id)?.[1] ?? id,
              military.every((i) => identity(i.feature.properties.sidc!) === id),
              () => setSidc((s) => withIdentity(s, id))
            )
          )
        ),
        el(
          '.oim-ul-chips',
          chip(
            tt('userlayers.status.P', 'Present'),
            military.every((i) => status(i.feature.properties.sidc!) !== 'A'),
            () => setSidc((s) => withStatus(s, 'P'))
          ),
          chip(
            tt('userlayers.status.A', 'Planned'),
            military.every((i) => status(i.feature.properties.sidc!) === 'A'),
            () => setSidc((s) => withStatus(s, 'A'))
          )
        )
      )
    )
  }
  const move = select(
    [
      ['', tt('userlayers.move-to', 'Move to layer…')],
      ...layers.filter((l) => !l.style.locked).map((l): [string, string] => [l.id, l.name])
    ],
    '',
    (v) => v && actions.moveTo(v),
    'bulk-layer'
  )
  const button = (label: string, onclick: () => void, primary = false) => {
    const b = el(`button.oim-ul-button${primary ? '.primary' : ''}`, label, { type: 'button' })
    b.onclick = onclick
    return b
  }
  parts.push(
    el(
      '.oim-ul-card-footer',
      move,
      button(tt('userlayers.delete-all', 'Delete all'), actions.remove),
      button(tt('userlayers.clear-selection', 'Done'), actions.clear, true)
    ),
    el(
      'p.oim-ul-hint',
      tt('userlayers.bulk-help', 'Shift-click on the map or in the list to add or remove items.')
    )
  )
  return el('div.oim-popup-content.oim-ul-editor', ...parts)
}
