// Fork: an item's card (editor/index.ts): its parts, in order: header, identity,
// details, notes, what its kind adds, appearance, footer.
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { DEFAULT_COLOR } from '../../model/model.ts'
import { GROUPS } from '../../model/fields.constants.ts'
import { addableFields, cardFields, toDtg } from '../../model/fields.ts'
import { IDENTITIES } from '../../model/sidc.constants.ts'
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
import { GEOMETRY_LABELS } from '../palette.constants.ts'
import { entryOf } from '../palette.ts'
import { symbolSvg } from '../../map/symbols.ts'
import { MAX_SIZE, MIN_SIZE } from '../../map/render.constants.ts'
import { controlPoints } from '../../map/geometry.ts'
import { variantsOf, withKey } from '../../graphics/variants.ts'
import { axisWidth } from '../../graphics/graphics.ts'
import { Card, CardPart } from './types.ts'
import { CONDITIONS, ECHELON_MARKS, MAIN_IDENTITIES } from './constants.ts'
import { chip, detailRow, select } from './controls.ts'

/** The card's header: the symbol, large, and the designation (rename in place). */
export async function headerSection(c: Card, parts: CardPart[]): Promise<void> {
  const { feature, layer, p, update, itemKind, military, sidc, modifiers, setModifier } = c
  const preview = el('span.oim-ul-card-symbol')
  let what = itemKind.what(feature)
  if (military) {
    const geometry = entryOf(sidc)?.[3]
    if (itemKind.drawn === 'standard') {
      try {
        preview.innerHTML = await symbolSvg(sidc, 36)
      } catch {
        // No preview.
      }
    } else if (geometry) {
      preview.textContent = GEOMETRY_LABELS[geometry][0]
    }
  } else if (itemKind.drawn === 'copy') {
    what = t('userlayers.copy-of', 'Copy of a map feature ({{layer}})', { layer: p.copy?.layer })
  }
  // Not a symbol: its own small picture (a pin, a line, a photo...).
  if (!military) {
    const picture = itemKind.thumbnail(feature)
    if (picture) preview.append(picture)
  }
  const title = el('input.oim-ul-card-title', {
    type: 'text',
    value: ((military ? modifiers['T'] : p.name) ?? '').trim(),
    placeholder: military ? t('userlayers.f.T', 'Unique designation') : t('userlayers.name', 'Name'),
    'data-field': 'title',
    'aria-label': t('userlayers.name', 'Name')
  }) as HTMLInputElement
  title.onchange = () =>
    military ? setModifier('T', title.value.trim()) : update({ name: title.value.trim() || undefined })
  parts.push(
    el(
      'div.oim-popup-header.oim-ul-card-header',
      preview,
      el('div.oim-ul-card-titles', title, el('span.oim-ul-what', `${what} · ${layer.name}`))
    )
  )
}

/** The card's identity strip (military symbols and graphics). */
export async function identitySection(c: Card, parts: CardPart[]): Promise<void> {
  const { feature, update, itemKind, military, sidc, kind } = c
  if (military && kind) {
    const setSidc = (next: string) => update({ sidc: next })
    const strip: HTMLElement[] = []
    const ids = el('.oim-ul-frames')
    for (const id of MAIN_IDENTITIES) {
      const label = IDENTITIES.find(([c]) => c === id)?.[1] ?? id
      const b = el(`button.oim-ul-frame${identity(sidc) === id ? '.oim-on' : ''}`, {
        type: 'button',
        title: t(`userlayers.affiliation.${id}`, label),
        'aria-pressed': String(identity(sidc) === id)
      })
      if (itemKind.drawn === 'standard') {
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
        [['', t('userlayers.more-identities', 'More…')], ...others],
        MAIN_IDENTITIES.includes(identity(sidc)) ? '' : identity(sidc),
        (v) => v && setSidc(withIdentity(sidc, v)),
        'identity-more'
      )
    )
    strip.push(ids)
    const st = status(sidc)
    const statusRow = el(
      '.oim-ul-chips',
      chip(t('userlayers.status.P', 'Present'), st !== 'A', () => setSidc(withStatus(sidc, 'P'))),
      chip(t('userlayers.status.A', 'Planned'), st === 'A', () => setSidc(withStatus(sidc, 'A')))
    )
    if (kind !== 'graphic') {
      for (const [code, label] of CONDITIONS) {
        statusRow.append(
          chip(t(`userlayers.condition.${code}`, label), st === code, () =>
            setSidc(withStatus(sidc, st === code ? 'P' : code))
          )
        )
      }
    }
    strip.push(statusRow)
    // Two versions of one graphic (graphic-variants.ts): task or obstacle, axis
    // of advance or direction of attack. Same points: the drawing stays.
    const versions = kind === 'graphic' ? variantsOf(sidc) : null
    if (versions) {
      const [first, second] = versions.variants.labels()
      const switchTo = (index: 0 | 1) => {
        if (index === versions.index) return
        const next = withKey(sidc, versions.variants.keys[index])
        if (!versions.variants.arrow) return setSidc(next)
        // An axis has a width (its size handle); a direction of attack doesn't.
        const path = controlPoints(feature.geometry)
        update(
          index === 0
            ? { sidc: next, axis: true, axisWidth: axisWidth(path) }
            : { sidc: next, axis: undefined, axisWidth: undefined }
        )
      }
      strip.push(
        el(
          '.oim-ul-chips',
          chip(first, versions.index === 0, () => switchTo(0)),
          chip(second, versions.index === 1, () => switchTo(1))
        )
      )
    }
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
              t(`userlayers.echelon.${code}`, label)
            )
          )
        ),
        el(
          '.oim-ul-chips',
          chip(
            t('userlayers.f.hq', 'HQ'),
            m.hq,
            () => setSidc(withUnitModifiers(sidc, { ...m, hq: !m.hq })),
            t('userlayers.f.hq-title', 'Headquarters')
          ),
          chip(t('userlayers.f.task-force', 'Task force'), m.taskForce, () =>
            setSidc(withUnitModifiers(sidc, { ...m, taskForce: !m.taskForce }))
          ),
          chip(
            t('userlayers.f.feint', 'Dummy'),
            m.feint,
            () => setSidc(withUnitModifiers(sidc, { ...m, feint: !m.feint })),
            t('userlayers.f.feint-title', 'Feint / dummy')
          )
        )
      )
    }
    if (kind === 'equipment' && sidc[2] === 'G') {
      strip.push(
        el(
          'label.oim-ul-detail',
          el('span.oim-ul-detail-name', t('userlayers.f.mobility', 'Mobility')),
          select(MOBILITIES, mobility(sidc), (v) => setSidc(withMobility(sidc, v)), 'mobility')
        )
      )
    }
    parts.push(el('.oim-ul-identity', ...strip))
  }
}

/** The card's details: the ones for its kind and any filled in; the rest one click away. */
export function detailsSection(c: Card, parts: CardPart[]) {
  const { update, military, kind, modifiers, setModifier } = c
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
          el('summary', `+ ${t('userlayers.add-detail', 'Add detail')}`),
          el(
            '.oim-ul-menu-items',
            ...addable.flatMap(([group, fields]) => [
              el('h4', t(`userlayers.group.${group}`, GROUPS.find(([g]) => g === group)![1])),
              ...fields.map((field) => {
                const b = el(
                  'button.oim-ul-add-field',
                  el('strong', t(`userlayers.f.${field.key}`, field.label)),
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
}

/** The card's notes, always there. */
export function notesSection(c: Card, parts: CardPart[]) {
  const { p, update } = c
  const notes = el('textarea.oim-ul-inline-input.oim-ul-notes', p.notes ?? '', {
    rows: 2,
    'data-field': 'notes',
    placeholder: t('userlayers.notes-placeholder', 'Notes…')
  }) as HTMLTextAreaElement
  notes.onchange = () => update({ notes: notes.value.trim() || undefined })
  parts.push(notes)
}

/** The card's what its kind adds (a measurement's ring distances...). */
export function kindSection(c: Card, parts: CardPart[]) {
  const { feature, actions, update, itemKind } = c
  parts.push(...(itemKind.card?.(feature, update, actions.setGeometry) ?? []))
}

/** The card's appearance. */
export function appearanceSection(c: Card, parts: CardPart[]) {
  const { feature, layer, p, update, itemKind } = c
  const look: HTMLElement[] = []
  const lookRow = (label: string, control: HTMLElement) =>
    el('.oim-ul-detail', el('span.oim-ul-detail-name', label), control)
  if (itemKind.sized && feature.geometry.type === 'Point') {
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
      title: t('userlayers.size-reset', 'Normal size')
    })
    reset.onclick = () => update({ size: 1 })
    look.push(lookRow(t('userlayers.size', 'Size'), el('span.oim-ul-unit', size, shown, reset)))
  }
  if (itemKind.coloured) {
    const color = el('input', {
      type: 'color',
      value: p.color ?? layer.style.color ?? DEFAULT_COLOR,
      'data-field': 'color'
    }) as HTMLInputElement
    color.onchange = () => update({ color: color.value })
    look.push(lookRow(t('userlayers.color', 'Colour'), color))
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
    look.push(lookRow(t('userlayers.width', 'Line width'), width))
  }
  if (look.length) {
    parts.push(
      el(
        'details.oim-ul-editor-section',
        { open: Boolean(itemKind.appearanceFirst) },
        el('summary', t('userlayers.s.appearance', 'Appearance')),
        ...look
      )
    )
  }
}

/** The card's hint, then the footer: layer, duplicate, delete, done. */
export function footerSection(c: Card, parts: CardPart[]) {
  const { feature, layer, layers, actions, p, itemKind } = c
  const hint =
    feature.geometry.type === 'Point'
      ? t('userlayers.drag-hint', 'Drag it on the map to move it.')
      : itemKind.drawn === 'copy'
        ? ''
        : p.axis || p.axisWidth !== undefined
          ? t(
              'userlayers.drag-arrow-hint',
              'Drag the points of its path to move or bend it, and the handle at the arrowhead’s corner to make it wider or narrower.'
            )
          : t('userlayers.drag-points-hint', 'Drag its points on the map to change its shape.')
  if (hint) parts.push(el('p.oim-ul-hint', hint))
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
