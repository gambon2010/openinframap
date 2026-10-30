// Fork: the details of a selected My layers item, shown in the left side panel like
// any map feature's details: identity (in the symbol code: sidc.ts), the descriptive
// fields of the standard (fields.ts), appearance, layer, notes. Each change is a
// change of the feature (saved with "Save", and in the history).
import { tt } from './i18n.ts'
import { el } from 'redom'
import { FeatureProps, UserFeature, UserLayer, DEFAULT_COLOR } from './model.ts'
import { Field, SECTIONS, fieldsFor, fromDtg, toDtg } from './fields.ts'
import {
  ECHELONS,
  IDENTITIES,
  MOBILITIES,
  STATUSES,
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
  remove: () => void
  done: () => void
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

function row(label: string, input: HTMLElement, help?: string) {
  return el('label.oim-ul-field', el('span', label), input, help ? el('small', help) : '')
}

/** A datetime-local input value (local time) for a DTG, and back. */
function dtgToInput(dtg: string | undefined): string {
  const date = dtg ? fromDtg(dtg) : null
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function fieldInput(field: Field, value: string, set: (value: string) => void): HTMLElement {
  const name = `${field.section}:${field.key}:${field.label}`
  if (field.input === 'textarea') {
    const t = el('textarea', value, { rows: 2, 'data-field': name }) as HTMLTextAreaElement
    t.onchange = () => set(t.value)
    return t
  }
  if (field.input === 'datetime') {
    const input = el('input', {
      type: 'datetime-local',
      value: dtgToInput(value),
      'data-field': name
    }) as HTMLInputElement
    input.onchange = () => set(input.value ? toDtg(new Date(input.value)) : '')
    return el('span.oim-ul-dtg', input, el('small', value || ''))
  }
  if (field.input === 'rating') {
    const reliability = select(
      [['', '–'], ...'ABCDEF'.split('').map((c): [string, string] => [c, c])],
      value[0] ?? '',
      (v) => set(v ? v + (value[1] ?? '') : ''),
      name + ':r'
    )
    const credibility = select(
      [['', '–'], ...'123456'.split('').map((c): [string, string] => [c, c])],
      value[1] ?? '',
      (v) => set((value[0] ?? 'F') + v),
      name + ':c'
    )
    return el('span.oim-ul-rating', reliability, credibility)
  }
  const input = el('input', {
    type: field.input === 'number' ? 'number' : 'text',
    value,
    'data-field': name
  }) as HTMLInputElement
  input.onchange = () => set(input.value.trim())
  return field.unit ? el('span.oim-ul-unit', input, el('small', field.unit)) : input
}

/** The editor for a feature. */
export async function buildEditor(
  feature: UserFeature,
  layer: UserLayer,
  layers: UserLayer[],
  actions: EditorActions
): Promise<HTMLElement> {
  const p = feature.properties
  const update = (changes: Partial<FeatureProps>) => actions.update({ ...p, ...changes })
  const sections: HTMLElement[] = []
  const section = (title: string, open: boolean, ...children: (HTMLElement | string)[]) =>
    el('details.oim-ul-editor-section', { open }, el('summary', title), ...children)

  // Header: what it is, with a preview.
  const military = (p.kind === 'symbol' || p.kind === 'graphic') && p.sidc
  const preview: HTMLElement = el('span.oim-ul-preview')
  let what = tt(`userlayers.kind.${p.kind}`, p.kind)
  if (military) {
    what = symbolName(p.sidc!) ?? p.sidc!
    const geometry = entryOf(p.sidc!)?.[3]
    if (p.kind === 'symbol') {
      try {
        preview.innerHTML = await symbolSvg(p.sidc!, 24)
      } catch {
        // No preview.
      }
    } else if (geometry) {
      preview.textContent = GEOMETRY_LABELS[geometry][0]
    }
  } else if (p.kind === 'copy') {
    what = tt('userlayers.copy-of', 'Copy of a map feature ({{layer}})', { layer: p.copy?.layer })
  }
  const title = (military ? p.modifiers?.['T'] : p.name) || what

  if (military) {
    const sidc = p.sidc!
    const kind = symbolKind(sidc)
    const setSidc = (next: string) => update({ sidc: next })
    const identityRows: HTMLElement[] = [
      row(
        tt('userlayers.f.identity', 'Standard identity'),
        select(IDENTITIES, identity(sidc), (v) => setSidc(withIdentity(sidc, v)), 'identity')
      ),
      row(
        tt('userlayers.f.status', 'Status'),
        select(
          kind === 'graphic' ? STATUSES.slice(0, 2) : STATUSES,
          status(sidc),
          (v) => setSidc(withStatus(sidc, v)),
          'status'
        )
      )
    ]
    if (kind === 'unit') {
      const m = unitModifiers(sidc)
      identityRows.push(
        row(
          tt('userlayers.f.echelon', 'Echelon'),
          select(
            ECHELONS,
            m.echelon,
            (v) => setSidc(withUnitModifiers(sidc, { ...m, echelon: v })),
            'echelon'
          )
        )
      )
      const flag = (key: 'hq' | 'taskForce' | 'feint', label: string) => {
        const box = el('input', { type: 'checkbox', checked: m[key], 'data-field': key }) as HTMLInputElement
        box.onchange = () => setSidc(withUnitModifiers(sidc, { ...m, [key]: box.checked }))
        return el('label.oim-ul-inline', box, label)
      }
      identityRows.push(
        el(
          '.oim-ul-flags',
          flag('hq', tt('userlayers.f.hq', 'Headquarters')),
          flag('taskForce', tt('userlayers.f.task-force', 'Task force')),
          flag('feint', tt('userlayers.f.feint', 'Feint / dummy'))
        )
      )
    }
    if (kind === 'equipment' && sidc[2] === 'G') {
      identityRows.push(
        row(
          tt('userlayers.f.mobility', 'Mobility'),
          select(MOBILITIES, mobility(sidc), (v) => setSidc(withMobility(sidc, v)), 'mobility')
        )
      )
    }
    sections.push(section(tt('userlayers.s.identity', 'Identity'), true, ...identityRows))

    const modifiers = { ...(p.modifiers ?? {}) }
    // Items made before the fields existed had a name: it's the designation.
    if (!modifiers['T'] && p.name) modifiers['T'] = p.name
    const setModifier = (key: string, value: string) => {
      const next = { ...modifiers, [key]: value }
      if (!value) delete next[key]
      update({ modifiers: next, name: undefined })
    }
    const fields = fieldsFor(kind)
    for (const [id, label] of SECTIONS) {
      const inSection = fields.filter((f) => f.section === id)
      if (!inSection.length) continue
      const filled = inSection.some((f) => modifiers[f.key])
      sections.push(
        section(
          tt(`userlayers.s.${id}`, label),
          id === 'labels' || filled,
          ...inSection.map((f) =>
            row(
              tt(`userlayers.f.${f.key}`, f.label),
              fieldInput(f, modifiers[f.key] ?? '', (v) => setModifier(f.key, v)),
              f.help
            )
          )
        )
      )
    }
  } else {
    const name = el('input', { type: 'text', value: p.name ?? '', 'data-field': 'name' }) as HTMLInputElement
    name.onchange = () => update({ name: name.value.trim() || undefined })
    sections.push(
      section(tt('userlayers.s.labels', 'Labels'), true, row(tt('userlayers.name', 'Name or label'), name))
    )
  }

  // Appearance
  const look: HTMLElement[] = []
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
    look.push(
      row(
        tt('userlayers.size', 'Size'),
        el('span.oim-ul-unit', size, shown, reset),
        tt('userlayers.size-hint', 'Or drag the round handle at its corner on the map.')
      )
    )
  }
  if (p.kind === 'drawing' || p.kind === 'marker' || p.kind === 'graphic') {
    const color = el('input', {
      type: 'color',
      value: p.color ?? layer.style.color ?? DEFAULT_COLOR,
      'data-field': 'color'
    }) as HTMLInputElement
    color.onchange = () => update({ color: color.value })
    look.push(row(tt('userlayers.color', 'Colour'), color))
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
    look.push(row(tt('userlayers.width', 'Line width'), width))
  }
  // Open for pictures: their size is what one changes most.
  if (look.length)
    sections.push(section(tt('userlayers.s.appearance', 'Appearance'), p.kind === 'image', ...look))

  // Layer, notes, position
  const layerSelect = select(
    layers.map((l): [string, string] => [l.id, l.name]),
    layer.id,
    (v) => v !== layer.id && actions.moveTo(v),
    'layer'
  )
  const notes = el('textarea', p.notes ?? '', { rows: 3, 'data-field': 'notes' }) as HTMLTextAreaElement
  notes.onchange = () => update({ notes: notes.value.trim() || undefined })
  const other: HTMLElement[] = [
    row(tt('userlayers.f.layer', 'Layer'), layerSelect),
    row(tt('userlayers.f.notes', 'Notes'), notes)
  ]
  if (feature.geometry.type === 'Point') {
    const [lon, lat] = feature.geometry.coordinates
    other.push(
      row(tt('userlayers.f.position', 'Position'), el('code', `${lat.toFixed(5)}, ${lon.toFixed(5)}`))
    )
  }
  sections.push(section(tt('userlayers.s.other', 'Layer and notes'), Boolean(p.notes), ...other))

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
  const remove = el('button.oim-ul-button', tt('userlayers.delete', 'Delete'), { type: 'button' })
  remove.onclick = actions.remove
  const done = el('button.oim-ul-button.primary', tt('userlayers.deselect', 'Done'), { type: 'button' })
  done.onclick = actions.done

  return el(
    'div.oim-popup-content.oim-ul-editor',
    el('div.oim-popup-header', el('h3', preview, ' ', title)),
    el('p.oim-ul-what', what, el('span.oim-ul-layer-tag', ` · ${layer.name}`)),
    ...sections,
    hint ? el('p.oim-ul-hint', hint) : '',
    el('.oim-ul-row.oim-ul-editor-buttons', remove, done)
  )
}
