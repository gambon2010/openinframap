// Fork: the form setting a status (and its extra fields), for one feature
// (details.ts) or several at once (selection.ts).
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { author, setAuthor } from '../../core/author.ts'
import { Evidence, STATUSES, Status, evidenceLabel, statusLook } from './statuses.ts'
import { Details, Field } from './fields.ts'

export interface StatusValues {
  status: Status
  evidence: Evidence | null
  note: string
  details: Details
  author: string
}

export interface FeatureRef {
  layer: string
  id: number
  name?: string
  /** Its extra fields: only these are sent for it. */
  fields: Field[]
}

/** POST /userdata/status for each feature, one after the other. */
export async function saveStatus(features: FeatureRef[], values: StatusValues) {
  for (const feature of features) {
    const keys = new Set(feature.fields.map((f) => f.key))
    const details = Object.fromEntries(
      Object.entries(values.details).filter(([key]) => keys.has(key as never))
    )
    const response = await fetch('/userdata/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layer: feature.layer,
        id: feature.id,
        name: feature.name,
        status: values.status,
        evidence: values.evidence,
        note: values.note,
        details,
        author: values.author
      })
    })
    if (!response.ok) throw new Error(await response.text())
  }
}

export function statusForm(options: {
  initial?: { status?: Status | null; evidence?: Evidence | null; details?: Details }
  fields: Field[]
  submitLabel?: string
  onSubmit: (values: StatusValues) => Promise<void>
  onCancel: () => void
}): HTMLFormElement {
  const initial = options.initial ?? {}
  const status = el(
    'select',
    STATUSES.map((s) =>
      el('option', statusLook(s).label, { value: s, selected: s === (initial.status ?? 'unknown') })
    )
  ) as HTMLSelectElement
  const evidence = el(
    'select',
    el('option', '—', { value: '' }),
    (['seen', 'reported', 'imagery'] as Evidence[]).map((e) =>
      el('option', evidenceLabel(e), { value: e, selected: e === initial.evidence })
    )
  ) as HTMLSelectElement
  const inputs = options.fields.map((field) => {
    const value = initial.details?.[field.key] ?? ''
    const input = field.choices
      ? (el(
          'select',
          el('option', '—', { value: '' }),
          field.choices.map(([v, label]) => el('option', label, { value: v, selected: v === value }))
        ) as HTMLSelectElement)
      : (el('input', { type: 'text', value }) as HTMLInputElement)
    return { field, input }
  })
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
  const save = el('button.oim-button', options.submitLabel ?? t('status.save', 'Save'), {
    type: 'submit'
  }) as HTMLButtonElement
  const form = el(
    'form.oim-status-form',
    el('label', t('status.title', 'Status'), status),
    el('label', t('status.how-known', 'How it is known'), evidence),
    inputs.map(({ field, input }) => el('label', field.label, input)),
    el('label', t('status.note', 'Note'), note),
    el('label', t('status.author', 'Set by'), who),
    error,
    el(
      'div.oim-status-buttons',
      save,
      el('button.oim-button', t('status.cancel', 'Cancel'), { type: 'button', onclick: options.onCancel })
    )
  ) as HTMLFormElement
  form.onsubmit = async (e) => {
    e.preventDefault()
    save.disabled = true
    setAuthor(who.value.trim())
    try {
      await options.onSubmit({
        status: status.value as Status,
        evidence: (evidence.value || null) as Evidence | null,
        note: note.value,
        details: Object.fromEntries(inputs.map(({ field, input }) => [field.key, input.value.trim()])),
        author: who.value.trim()
      })
    } catch (err) {
      error.textContent = t('status.failed', "Couldn't save: {{error}}", { error: (err as Error).message })
      save.disabled = false
    }
  }
  return form
}
