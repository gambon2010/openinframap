// Fork: the conflict window (docs/plans/sync.md, "The conflict window"): items both
// you and someone else changed, one at a time: who changed it and when, the fields
// that differ (yours and theirs side by side), Keep mine / Take theirs, Back /
// Next, or all at once. It folds to a bar ("3 conflicts: resolve") to go on
// working; meanwhile the map shows your version, marked, and Save waits.
import { el, setChildren } from 'redom'
import { t, tn } from '../../../core/i18n.ts'
import { FeatureState, LayerState, featureFields, layerFields } from '../state/merge.ts'
import { Conflict } from '../state/reconcile.ts'
import type { Workspace } from './workspace.ts'

/** A field's name for people. */
export function fieldLabel(field: string): string {
  if (field === 'deleted') return t('userlayers.conflict.deleted', 'Deleted')
  if (field === 'geometry') return t('userlayers.conflict.position', 'Position')
  if (field === 'layer') return t('userlayers.conflict.layer', 'Layer')
  if (field === 'name') return t('userlayers.conflict.name', 'Name')
  if (field.startsWith('modifiers.'))
    return t('userlayers.conflict.detail', 'Detail {{key}}', { key: field.slice(10) })
  if (field.startsWith('sidc.')) {
    const part = field.slice(5)
    return (
      {
        identity: t('userlayers.conflict.identity', 'Identity (friend, hostile...)'),
        status: t('userlayers.conflict.status', 'Status (present, planned)'),
        echelon: t('userlayers.conflict.echelon', 'Echelon, HQ, task force'),
        function: t('userlayers.conflict.function', 'Symbol')
      }[part] ?? t('userlayers.conflict.code', 'Symbol code ({{part}})', { part })
    )
  }
  const key = field.slice(field.indexOf('.') + 1)
  return (
    {
      name: t('userlayers.conflict.name', 'Name'),
      notes: t('userlayers.conflict.notes', 'Notes'),
      color: t('userlayers.conflict.colour', 'Colour'),
      size: t('userlayers.conflict.size', 'Size'),
      width: t('userlayers.conflict.width', 'Line width'),
      locked: t('userlayers.conflict.locked', 'Locked'),
      folder: t('userlayers.conflict.folder', 'Folder')
    }[key] ?? key
  )
}

/** A field's value for people. */
export function fieldValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'object' && value && 'type' in value) {
    const g = value as GeoJSON.Geometry
    if (g.type === 'Point') return `${g.coordinates[1].toFixed(5)}, ${g.coordinates[0].toFixed(5)}`
    return t('userlayers.conflict.shape', 'its shape')
  }
  if (typeof value === 'boolean') return value ? t('userlayers.yes', 'yes') : t('userlayers.no', 'no')
  return String(value)
}

export class ConflictWindow {
  readonly el = el('.oim-ul-conflicts', { role: 'dialog' })
  private index = 0
  private minimised = false

  constructor(private ws: Workspace) {}

  update() {
    const conflicts = this.ws.store.conflicts
    this.el.classList.toggle('visible', conflicts.length > 0)
    if (!conflicts.length) {
      this.minimised = false
      return
    }
    this.index = Math.min(this.index, conflicts.length - 1)
    if (this.minimised) {
      setChildren(this.el, [
        el(
          'button.oim-ul-conflicts-bar',
          tn(
            'userlayers.conflicts-bar',
            '⚠ 1 conflict: resolve',
            '⚠ {{count}} conflicts: resolve',
            conflicts.length
          ),
          { type: 'button', onclick: () => this.setMinimised(false) }
        )
      ])
      return
    }
    setChildren(this.el, this.content(conflicts[this.index], conflicts.length))
  }

  private setMinimised(minimised: boolean) {
    this.minimised = minimised
    this.update()
  }

  private describe(conflict: Conflict): { title: string; layer: string } {
    const isLayer = conflict.key.startsWith('layer:')
    const state = (conflict.mine ?? conflict.theirs) as FeatureState | LayerState | null
    if (isLayer) {
      return { title: (state as LayerState | null)?.name || t('userlayers.layer', 'Layer'), layer: '' }
    }
    const item = state as FeatureState | null
    const layer = item ? (this.ws.store.layers.get(item.layerId)?.name ?? '') : ''
    return {
      title: (item?.feature.properties.name as string) || t('userlayers.conflict.item', 'An item'),
      layer
    }
  }

  private rows(conflict: Conflict): HTMLElement[] {
    const isLayer = conflict.key.startsWith('layer:')
    const fields = (s: Conflict['mine']) =>
      s ? (isLayer ? layerFields(s as LayerState) : featureFields(s as FeatureState)) : null
    const mine = fields(conflict.mine)
    const theirs = fields(conflict.theirs)
    if (!mine || !theirs) {
      const gone = t('userlayers.conflict.gone', 'Deleted')
      const changed = t('userlayers.conflict.changed', 'Changed')
      return [
        el(
          'tr',
          el('td', fieldLabel('deleted')),
          el('td', mine ? changed : gone),
          el('td', theirs ? changed : gone)
        )
      ]
    }
    return conflict.fields.map((field) =>
      el(
        'tr',
        el('td', fieldLabel(field)),
        el('td', fieldValue(mine[field])),
        el('td', fieldValue(theirs[field]))
      )
    )
  }

  private content(conflict: Conflict, count: number): HTMLElement[] {
    const store = this.ws.store
    const { title, layer } = this.describe(conflict)
    const when = conflict.at
      ? new Date(conflict.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : ''
    const button = (text: string, onclick: () => void, extra = '') =>
      el(`button.oim-button${extra}`, text, { type: 'button', onclick })
    return [
      el(
        '.oim-ul-conflicts-head',
        el(
          'strong',
          t('userlayers.conflict.title', 'Conflict {{n}} of {{count}}', { n: this.index + 1, count })
        ),
        button('–', () => this.setMinimised(true), '.oim-ul-conflicts-fold')
      ),
      el(
        'p.oim-ul-conflicts-what',
        el('strong', title),
        layer ? ` · ${layer}` : '',
        el(
          'span.oim-ul-conflicts-who',
          conflict.by
            ? t('userlayers.conflict.by', 'Changed by {{name}} {{when}} while you were changing it too.', {
                name: conflict.by,
                when
              })
            : t('userlayers.conflict.someone', 'Changed by someone else while you were changing it too.')
        )
      ),
      el(
        'table.oim-ul-conflicts-fields',
        el(
          'tr',
          el('th', ''),
          el('th', t('userlayers.conflict.mine', 'Yours')),
          el('th', t('userlayers.conflict.theirs', 'Theirs'))
        ),
        ...this.rows(conflict)
      ),
      el(
        '.oim-ul-conflicts-choose',
        button(
          t('userlayers.conflict.keep-mine', 'Keep mine'),
          () => store.resolve(conflict.key, 'mine'),
          '.primary'
        ),
        button(t('userlayers.conflict.take-theirs', 'Take theirs'), () =>
          store.resolve(conflict.key, 'theirs')
        )
      ),
      el(
        '.oim-ul-conflicts-move',
        button('◀', () => {
          this.index = (this.index - 1 + count) % count
          this.update()
        }),
        button('▶', () => {
          this.index = (this.index + 1) % count
          this.update()
        }),
        count > 1
          ? button(t('userlayers.conflict.all-mine', 'Keep all mine'), () => store.resolveAll('mine'))
          : '',
        count > 1
          ? button(t('userlayers.conflict.all-theirs', 'Take all theirs'), () => store.resolveAll('theirs'))
          : ''
      )
    ]
  }
}
