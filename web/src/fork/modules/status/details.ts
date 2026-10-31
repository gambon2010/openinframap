// Fork: a "Status" section in a map feature's details: its status (with how it's
// known, who set it and when), a form to change it, and its history.
import { MapGeoJSONFeature } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import { author, setAuthor } from '../../core/author.ts'
import { Evidence, STATUSES, Status, evidenceLabel, statusLook } from './statuses.ts'

interface Change {
  status: Status
  previous: Status | null
  evidence: Evidence | null
  note: string | null
  author: string | null
  at: string
}

interface FeatureStatus {
  status: Status | null
  evidence: Evidence | null
  note: string | null
  author: string | null
  updated_at: string | null
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
      [current, note, change, this.history(data.history)].filter(Boolean) as HTMLElement[]
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
            c.note ? el('div.oim-status-note', c.note) : ''
          )
        )
      )
    )
  }

  private form(data: FeatureStatus): HTMLElement {
    const status = el(
      'select',
      STATUSES.map((s) =>
        el('option', statusLook(s).label, { value: s, selected: s === (data.status ?? 'unknown') })
      )
    ) as HTMLSelectElement
    const evidence = el(
      'select',
      el('option', '—', { value: '' }),
      (['seen', 'reported', 'imagery'] as Evidence[]).map((e) =>
        el('option', evidenceLabel(e), { value: e, selected: e === data.evidence })
      )
    ) as HTMLSelectElement
    const note = el('textarea', {
      rows: 2,
      placeholder: t('status.note-placeholder', 'What happened, what is known')
    }) as HTMLTextAreaElement
    const who = el('input', {
      type: 'text',
      value: author(),
      placeholder: t('status.author-placeholder', 'Your name')
    }) as HTMLInputElement
    const error = el('p.oim-status-error')
    const save = el('button.oim-button', t('status.save', 'Save'), { type: 'submit' }) as HTMLButtonElement
    const form = el(
      'form.oim-status-form',
      el('label', t('status.title', 'Status'), status),
      el('label', t('status.how-known', 'How it is known'), evidence),
      el('label', t('status.note', 'Note'), note),
      el('label', t('status.author', 'Set by'), who),
      error,
      el(
        'div.oim-status-buttons',
        save,
        el('button.oim-button', t('status.cancel', 'Cancel'), {
          type: 'button',
          onclick: () => this.show(data)
        })
      )
    ) as HTMLFormElement
    form.onsubmit = async (e) => {
      e.preventDefault()
      save.disabled = true
      setAuthor(who.value.trim())
      try {
        const response = await fetch('/userdata/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            layer: this.layer,
            id: this.id,
            status: status.value,
            evidence: evidence.value || null,
            note: note.value,
            name: this.name,
            author: who.value.trim()
          })
        })
        if (!response.ok) throw new Error(await response.text())
      } catch (err) {
        error.textContent = t('status.failed', "Couldn't save: {{error}}", { error: (err as Error).message })
        save.disabled = false
        return
      }
      await this.load()
      this.onChanged()
    }
    return form
  }
}

/** The tile layer and id that name a clicked feature for its status, if it has an id. */
export function featureKey(feature: MapGeoJSONFeature): { layer: string; id: number } | null {
  const id = Number(feature.properties['osm_id'] ?? feature.properties['id'])
  if (!feature.sourceLayer || !Number.isFinite(id)) return null
  return { layer: feature.sourceLayer, id }
}
