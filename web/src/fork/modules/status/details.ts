// Fork: a "Status" section in a map feature's details: its status (with how it's
// known, who set it and when), a form to change it, and its history.
import { MapGeoJSONFeature } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import { Evidence, Status, evidenceLabel, statusLook } from './statuses.ts'
import { Details, Field, detailsText } from './fields.ts'
import { saveStatus, statusForm } from './form.ts'

interface Change {
  status: Status
  previous: Status | null
  evidence: Evidence | null
  note: string | null
  author: string | null
  details: Details
  at: string
}

interface FeatureStatus {
  status: Status | null
  evidence: Evidence | null
  note: string | null
  author: string | null
  updated_at: string | null
  details: Details
  history: Change[]
  can_set: boolean
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function chip(status: Status | null): HTMLElement {
  const look = statusLook(status ?? 'unknown')
  return el(
    'span.oim-status-chip',
    el('span.oim-status-dot', { style: { background: look.color } }),
    look.symbol ? `${look.symbol} ${look.label}` : look.label
  )
}

/** "Imagery · Chris · 31 Oct 2026, 15:24" */
function byline(change: { evidence: Evidence | null; author: string | null; at: string }): string {
  return [change.evidence ? evidenceLabel(change.evidence) : null, change.author, when(change.at)]
    .filter(Boolean)
    .join(' · ')
}

export class StatusSection {
  el: HTMLElement
  private body = el('div')

  constructor(
    private layer: string,
    private id: number,
    private name: string | undefined,
    private fields: Field[],
    private onChanged: () => void
  ) {
    this.el = el('div.oim-status', el('h4', t('status.title', 'Status')), this.body)
  }

  /** The feature's status from the backend; false if it can't have one. */
  async load(): Promise<boolean> {
    let data: FeatureStatus
    try {
      const response = await fetch(
        `/userdata/status/feature?${new URLSearchParams({ layer: this.layer, id: String(this.id) })}`
      )
      if (!response.ok) return false
      data = await response.json()
    } catch {
      return false
    }
    this.show(data)
    return true
  }

  private show(data: FeatureStatus) {
    const current = el(
      'div.oim-status-current',
      chip(data.status),
      data.updated_at
        ? el(
            'span.oim-status-byline',
            byline({ evidence: data.evidence, author: data.author, at: data.updated_at })
          )
        : ''
    )
    const extra = detailsText(data.details)
    const fields = extra ? el('p.oim-status-fields', extra) : null
    const note = data.note ? el('p.oim-status-note', data.note) : null
    const change = data.can_set
      ? el(
          'button.oim-button',
          data.status ? t('status.change', 'Change status') : t('status.set', 'Set status'),
          {
            type: 'button',
            onclick: () => setChildren(this.body, [current, this.form(data)])
          }
        )
      : null
    setChildren(
      this.body,
      [current, fields, note, change, this.history(data.history)].filter(Boolean) as HTMLElement[]
    )
  }

  private history(changes: Change[]): HTMLElement | null {
    if (!changes.length) return null
    return el(
      'details.oim-status-history',
      el('summary', t('status.history', 'History ({{count}})', { count: changes.length })),
      el(
        'ol',
        changes.map((c) =>
          el(
            'li',
            chip(c.status),
            c.previous
              ? el(
                  'span.oim-status-was',
                  t('status.was', 'was {{status}}', { status: statusLook(c.previous).label })
                )
              : '',
            el('div.oim-status-byline', byline(c)),
            detailsText(c.details) ? el('div.oim-status-fields', detailsText(c.details)) : '',
            c.note ? el('div.oim-status-note', c.note) : ''
          )
        )
      )
    )
  }

  private form(data: FeatureStatus): HTMLElement {
    return statusForm({
      initial: data,
      fields: this.fields,
      onSubmit: async (values) => {
        await saveStatus([{ layer: this.layer, id: this.id, name: this.name, fields: this.fields }], values)
        await this.load()
        this.onChanged()
      },
      onCancel: () => this.show(data)
    })
  }
}

/** The tile layer and id that name a clicked feature for its status, if it has an id. */
export function featureKey(feature: MapGeoJSONFeature): { layer: string; id: number } | null {
  const id = Number(feature.properties['osm_id'] ?? feature.properties['id'])
  if (!feature.sourceLayer || !Number.isFinite(id)) return null
  return { layer: feature.sourceLayer, id }
}
