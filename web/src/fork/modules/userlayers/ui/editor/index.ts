// Fork: the card of a selected My layers item, in the left details panel (the
// sidebar's inspector, docs/plans/my-layers-v3.md). Read first, edit in place:
// - a header with the symbol (large, live) and its designation;
// - identity, status, echelon, HQ / task force / dummy as clickable shapes and marks
//   (they're part of the code: sidc.ts);
// - the details that matter for its kind, plus any filled in, in plain words
//   (fields.ts); "+ Add detail" for the rest, by question (who, what, when...);
// - notes, appearance, layer, duplicate / delete.
// Each change is a change of the feature (undoable, saved with Save, in the history).
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { FeatureProps, UserFeature, UserLayer } from '../../model/model.ts'
import { IDENTITIES } from '../../model/sidc.constants.ts'
import { identity, status, symbolKind, withIdentity, withStatus } from '../../model/sidc.ts'
import { kindOf } from '../../kinds/index.ts'
import { BulkActions, Card, CardPart, EditorActions } from './types.ts'
import { MAIN_IDENTITIES } from './constants.ts'
import { chip, select } from './controls.ts'
import {
  appearanceSection,
  detailsSection,
  footerSection,
  headerSection,
  identitySection,
  kindSection,
  notesSection
} from './sections.ts'

export async function buildEditor(
  feature: UserFeature,
  layer: UserLayer,
  layers: UserLayer[],
  actions: EditorActions
): Promise<HTMLElement> {
  const p = feature.properties
  const update = (changes: Partial<FeatureProps>) => actions.update({ ...p, ...changes })
  const itemKind = kindOf(p)
  const military = Boolean(itemKind.military && p.sidc)
  const sidc = p.sidc ?? ''
  const kind = military ? symbolKind(sidc) : null
  const parts: CardPart[] = []
  const modifiers = { ...(p.modifiers ?? {}) }
  // Items made before the fields existed had a name: it's the designation.
  if (military && !modifiers['T'] && p.name) modifiers['T'] = p.name
  const setModifier = (key: string, value: string) => {
    const next = { ...modifiers, [key]: value }
    if (!value) delete next[key]
    update({ modifiers: next, name: undefined })
  }
  const card: Card = {
    feature,
    layer,
    layers,
    actions,
    p,
    update,
    itemKind,
    military,
    sidc,
    kind,
    modifiers,
    setModifier
  }
  await headerSection(card, parts)
  await identitySection(card, parts)
  detailsSection(card, parts)
  notesSection(card, parts)
  kindSection(card, parts)
  appearanceSection(card, parts)
  footerSection(card, parts)
  return el('div.oim-popup-content.oim-ul-editor', ...parts)
}

/** The card for several selected items: what they are, and changes for all of them. */
export function buildBulkCard(
  items: { feature: UserFeature; layer: UserLayer }[],
  layers: UserLayer[],
  actions: BulkActions
): HTMLElement {
  const unlocked = items.filter((i) => actions.canEdit(i.layer))
  const military = unlocked.filter((i) => i.feature.properties.sidc)
  const parts: (HTMLElement | string)[] = []
  parts.push(
    el(
      'div.oim-popup-header.oim-ul-card-header',
      el('span.oim-ul-card-symbol', '▣'),
      el(
        'div.oim-ul-card-titles',
        el('h3', t('userlayers.n-selected', '{{count}} items selected', { count: items.length })),
        el('span.oim-ul-what', t('userlayers.bulk-hint', 'Changes below apply to all of them'))
      )
    )
  )
  const names = items.map(({ feature }) => {
    const p = feature.properties
    const name = (p.modifiers?.['T'] || p.name || '').trim()
    const what = kindOf(p).what(feature)
    return el('li', name ? `${name} · ${what}` : what)
  })
  parts.push(el('ul.oim-ul-bulk-list', names))
  if (unlocked.length < items.length) {
    parts.push(
      el(
        'p.oim-ul-locked-note',
        t('userlayers.bulk-locked', '🔒 {{count}} in locked layers are left as they are.', {
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
            t('userlayers.status.P', 'Present'),
            military.every((i) => status(i.feature.properties.sidc!) !== 'A'),
            () => setSidc((s) => withStatus(s, 'P'))
          ),
          chip(
            t('userlayers.status.A', 'Planned'),
            military.every((i) => status(i.feature.properties.sidc!) === 'A'),
            () => setSidc((s) => withStatus(s, 'A'))
          )
        )
      )
    )
  }
  const move = select(
    [
      ['', t('userlayers.move-to', 'Move to layer…')],
      ...layers.filter((l) => actions.canEdit(l)).map((l): [string, string] => [l.id, l.name])
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
      button(t('userlayers.delete-all', 'Delete all'), actions.remove),
      button(t('userlayers.clear-selection', 'Done'), actions.clear, true)
    ),
    el(
      'p.oim-ul-hint',
      t('userlayers.bulk-help', 'Shift-click on the map or in the list to add or remove items.')
    )
  )
  return el('div.oim-popup-content.oim-ul-editor', ...parts)
}
