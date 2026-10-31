// Fork: the Status board (a panel in the right-hand dock): every feature with a
// status, counted and filtered by status, kind and name; a click goes to it. And
// the status history played back: the map (and the list) as they were at each
// change, step by step or playing, then back to now.
import { LngLatBounds, Map } from 'maplibre-gl'
import type { Feature, FeatureCollection, Position } from 'geojson'
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import { leftColumn } from '../../ui/left-column.ts'
import { makePanel } from '../../ui/panel.ts'
import { STATUSES, Status, statusLook } from './statuses.ts'
import { detailsText } from './fields.ts'
import { StatusChange, featuresAt } from './playback.ts'
import { StatusMap } from './map.ts'
import { SupplyMode } from './supply.ts'

const PLAY_STEP_MS = 900

/** The kind of feature from its tile layer, for the filter. */
export function kindOf(layer: string): string {
  if (layer.startsWith('power_')) return 'power'
  if (layer.startsWith('sites_')) return 'sites'
  if (layer.startsWith('telecoms_')) return 'telecoms'
  if (layer.startsWith('extra_')) return 'extra'
  if (layer.includes('pipeline') || layer.startsWith('petroleum_')) return 'pipelines'
  return 'water'
}

function kindLabel(kind: string): string {
  return (
    {
      power: t('board.kind.power', 'Power'),
      sites: t('board.kind.sites', 'Critical sites'),
      telecoms: t('board.kind.telecoms', 'Telecoms'),
      pipelines: t('board.kind.pipelines', 'Pipelines'),
      water: t('board.kind.water', 'Water'),
      extra: t('board.kind.extra', 'Open data')
    }[kind] ?? kind
  )
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function bounds(feature: Feature): LngLatBounds {
  const box = new LngLatBounds()
  const add = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') box.extend(c as Position as [number, number])
    else if (Array.isArray(c)) c.forEach(add)
  }
  add((feature.geometry as { coordinates?: unknown }).coordinates)
  return box
}

export class StatusBoard {
  panel: HTMLElement
  private body: HTMLElement
  private all: FeatureCollection = { type: 'FeatureCollection', features: [] }
  private changes: StatusChange[] = []
  /** The history step shown; null: now. */
  private step: number | null = null
  private playing: number | undefined
  private filter = { statuses: new Set<Status>(), kind: '', text: '' }

  constructor(
    private map: Map,
    private statusMap: StatusMap,
    private supply: SupplyMode
  ) {
    supply.onChange(() => {
      if (this.panel.classList.contains('visible')) this.render()
    })
    const made = makePanel('oim-status-board', t('board.title', 'Status board'))
    this.panel = made.panel
    this.body = made.body
    // Closed: back to now.
    new MutationObserver(() => {
      if (!this.panel.classList.contains('visible') && this.step !== null) this.goTo(null)
    }).observe(this.panel, { attributes: true, attributeFilter: ['class'] })
  }

  /** Load the statuses and their history again (opened, or one was set). */
  async load() {
    try {
      const [all, history] = await Promise.all([
        fetch('/userdata/status?all=1').then((r) => r.json()),
        fetch('/userdata/status/history').then((r) => r.json())
      ])
      this.all = all
      this.changes = history.changes
    } catch {
      setChildren(this.body, [el('p', t('board.unavailable', "The statuses couldn't be loaded."))])
      return
    }
    if (this.step !== null) this.step = Math.min(this.step, this.changes.length)
    this.render()
  }

  private shown(): FeatureCollection {
    return this.step === null ? this.all : featuresAt(this.all, this.changes, this.step)
  }

  private goTo(step: number | null) {
    this.step = step === null || step >= this.changes.length ? null : Math.max(0, step)
    if (this.step === null) this.stop()
    this.statusMap.showPast(this.step === null ? null : featuresAt(this.all, this.changes, this.step, true))
    this.render()
  }

  private play() {
    if (this.playing !== undefined) return this.stop()
    if (this.step === null) this.step = 0
    this.playing = window.setInterval(() => {
      if (this.step === null || this.step >= this.changes.length) return this.goTo(null)
      this.goTo(this.step + 1)
    }, PLAY_STEP_MS)
    this.goTo(this.step)
  }

  private stop() {
    window.clearInterval(this.playing)
    this.playing = undefined
  }

  private render() {
    const features = this.shown().features
    const counts = new globalThis.Map<Status, number>()
    for (const f of features) counts.set(f.properties?.status, (counts.get(f.properties?.status) ?? 0) + 1)
    const chips = el(
      'div.oim-board-counts',
      STATUSES.filter((s) => counts.get(s)).map((s) => {
        const look = statusLook(s)
        const on = this.filter.statuses.has(s)
        return el(
          'button.oim-board-count' + (on ? '.on' : ''),
          { type: 'button', title: t('board.filter-status', 'Show only these (click again: all)') },
          el('span.oim-status-dot', { style: { background: look.color } }),
          `${look.label} ${counts.get(s)}`,
          {
            onclick: () => {
              if (on) this.filter.statuses.delete(s)
              else this.filter.statuses.add(s)
              this.render()
            }
          }
        )
      })
    )
    const kinds = [...new Set(features.map((f) => kindOf(f.properties?.layer ?? '')))]
    const kind = el(
      'select',
      el('option', t('board.all-kinds', 'All kinds'), { value: '' }),
      kinds.map((k) => el('option', kindLabel(k), { value: k, selected: k === this.filter.kind }))
    ) as HTMLSelectElement
    kind.onchange = () => {
      this.filter.kind = kind.value
      this.render()
    }
    const search = el('input', {
      type: 'search',
      value: this.filter.text,
      placeholder: t('board.search', 'Name')
    }) as HTMLInputElement
    search.oninput = () => {
      this.filter.text = search.value
      this.renderList(listEl, features)
    }
    const listEl = el('ul.oim-board-list')
    this.renderList(listEl, features)
    setChildren(this.body, [
      this.supplyControls(),
      this.timeline(),
      chips,
      el('div.oim-board-filters', kind, search),
      listEl
    ])
  }

  private renderList(list: HTMLElement, features: Feature[]) {
    const text = this.filter.text.trim().toLowerCase()
    const rows = features
      .filter((f) => !this.filter.statuses.size || this.filter.statuses.has(f.properties?.status))
      .filter((f) => !this.filter.kind || kindOf(f.properties?.layer ?? '') === this.filter.kind)
      .filter(
        (f) =>
          !text ||
          String(f.properties?.name ?? '')
            .toLowerCase()
            .includes(text)
      )
      .sort((a, b) => String(b.properties?.updated_at).localeCompare(String(a.properties?.updated_at)))
    setChildren(
      list,
      rows.length
        ? rows.map((f) => this.row(f))
        : [el('li.oim-board-empty', t('board.none', 'No feature with a status here.'))]
    )
  }

  private row(feature: Feature): HTMLElement {
    const p = feature.properties ?? {}
    const look = statusLook(p.status)
    const extra = detailsText(p.details)
    return el(
      'li',
      el(
        'button.oim-board-row',
        { type: 'button', onclick: () => this.goToFeature(feature) },
        el(
          'div.oim-board-row-title',
          el('span.oim-status-dot', { style: { background: look.color } }),
          el('strong', p.name || kindLabel(kindOf(p.layer ?? ''))),
          el('span.oim-board-status', look.label)
        ),
        el(
          'div.oim-status-byline',
          [kindLabel(kindOf(p.layer ?? '')), p.author, p.updated_at ? when(p.updated_at) : null]
            .filter(Boolean)
            .join(' · ')
        ),
        extra ? el('div.oim-status-fields', extra) : '',
        p.note ? el('div.oim-status-note', p.note) : ''
      )
    )
  }

  private goToFeature(feature: Feature) {
    const box = bounds(feature)
    if (box.isEmpty()) return
    this.map.fitBounds(box, { padding: 80, maxZoom: 16 })
    leftColumn.highlight.setData([{ ...feature, properties: {} }])
  }

  /** Power supply mode: on or off, pessimistic or not, and what it finds. */
  private supplyControls(): HTMLElement {
    const on = el('input', { type: 'checkbox', checked: this.supply.active }) as HTMLInputElement
    const pessimistic = el('input', {
      type: 'checkbox',
      checked: this.supply.pessimistic
    }) as HTMLInputElement
    on.onchange = () => void this.supply.set(on.checked, pessimistic.checked)
    pessimistic.onchange = () => void this.supply.set(this.supply.active, pessimistic.checked)
    return el(
      'div.oim-board-supply',
      el('label', on, t('supply.mode', 'Power supply mode')),
      el(
        'label',
        { title: t('supply.pessimistic-title', 'Count suspected damage as lost too') },
        pessimistic,
        t('supply.pessimistic', 'Pessimistic')
      ),
      this.supply.active && this.supply.summary ? el('p.oim-board-hint', this.supply.summary) : ''
    )
  }

  private timeline(): HTMLElement {
    const total = this.changes.length
    if (!total) return el('p.oim-board-hint', t('board.no-history', 'No status set yet.'))
    const step = this.step ?? total
    const slider = el('input', { type: 'range', min: 0, max: total, value: step }) as HTMLInputElement
    slider.oninput = () => this.goTo(Number(slider.value))
    const current = step > 0 ? this.changes[step - 1] : null
    const label =
      this.step === null
        ? t('board.now', 'Now ({{count}} changes)', { count: total })
        : current
          ? t('board.as-of', 'As of {{when}} (change {{step}} of {{count}})', {
              when: when(current.at),
              step,
              count: total
            })
          : t('board.before', 'Before the first change')
    const button = (text: string, title: string, onclick: () => void) =>
      el('button.oim-button', text, { type: 'button', title, onclick })
    return el(
      'div.oim-board-timeline' + (this.step === null ? '' : '.past'),
      el('div.oim-board-timeline-label', label),
      slider,
      el(
        'div.oim-board-timeline-buttons',
        button('⏮', t('board.first', 'Before the first change'), () => this.goTo(0)),
        button('◀', t('board.back', 'One change back'), () => this.goTo(step - 1)),
        button(this.playing === undefined ? '▶' : '⏸', t('board.play', 'Play the changes'), () =>
          this.play()
        ),
        button('▶|', t('board.forward', 'One change on'), () => this.goTo(step + 1)),
        button(t('board.live', 'Now'), t('board.live-title', 'Back to the statuses now'), () =>
          this.goTo(null)
        )
      )
    )
  }
}
