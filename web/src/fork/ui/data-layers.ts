// Fork: the Data layers panel, upstream's layer list and key in one. Upstream's
// groups (Infrastructure, Critical sites...) are headings; each of their entries
// (Power, Telecoms...) is a row with its tick box (switching it on or off, through
// upstream's layer switcher) that unfolds to the key sections of what it draws, each
// key row with its own tick box (feature-hider.ts). A key section belongs to the
// entry of the same name, else to the entry whose map layers its rows draw (by the
// entry's layer prefix); any other goes under "Other". Statuses' rows have no tick box: they're a key, not a filter.
//
// Upstream's list is rebuilt when the map's address changes, so it isn't moved: the
// tick boxes here ask its switcher and are drawn again from it. The key is built
// once: its sections are moved here (their tick boxes keep working), in a body that
// keeps the key's class, where the printed legend reads them (legend.ts keyRows).
import type { Map } from 'maplibre-gl'
import { el } from 'redom'
import { t } from '../core/i18n.ts'
import { readJson, writeJson } from '../core/storage.ts'
import { makePanel } from './panel.ts'
import { HideSpec, StyleLayer, specConditions } from './key/feature-hider.ts'
import { keyRows } from './key/legend.ts'
import './data-layers.css'

/** What the panel needs of upstream's layer switcher (maplibregl-layer-switcher). */
export interface Switcher {
  _layers: (SwitcherLayer | SwitcherGroup)[]
  _visible: string[]
  setVisibility(id: string, visible: boolean): void
}
export interface SwitcherLayer {
  id: string
  title: string
  prefix: string
  groupId?: string
}
export interface SwitcherGroup {
  title: string
  layers: SwitcherLayer[]
}

const OPEN_KEY = 'oim-data-layers-open'

/** A key section: its heading and its table. */
interface Section {
  title: string
  heading: HTMLElement
  table: HTMLElement
}

/**
 * Which entry each key section belongs to: the entry of the same title; else the
 * one whose prefix starts the most of the map layers its rows draw; else none.
 */
export function assignSections(
  sections: { title: string; specs: HideSpec[] }[],
  entries: SwitcherLayer[],
  styleLayers: StyleLayer[]
): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const section of sections) {
    // The entry of the same name first (Critical sites' entries share their map
    // layers, so the layers can't tell them apart).
    const named = entries.find((e) => e.title.trim().toLowerCase() === section.title.trim().toLowerCase())
    if (named) {
      out[section.title] = named.id
      continue
    }
    const ids = new Set<string>()
    for (const spec of section.specs) for (const id of specConditions(spec, styleLayers).keys()) ids.add(id)
    let best: string | null = null
    let most = 0
    for (const entry of entries) {
      if (!entry.prefix) continue
      const n = [...ids].filter((id) => id.startsWith(entry.prefix)).length
      if (n > most) [best, most] = [entry.id, n]
    }
    out[section.title] = best
  }
  return out
}

/** The key's sections (h3 and its table), in order. */
function keySections(pane: HTMLElement): Section[] {
  const out: Section[] = []
  for (const heading of pane.querySelectorAll<HTMLElement>('h3')) {
    const table = heading.nextElementSibling
    if (table?.tagName === 'TABLE')
      out.push({ title: heading.textContent?.trim() ?? '', heading, table: table as HTMLElement })
  }
  return out
}

export function buildDataLayers(map: Map, switcher: Switcher, keyPane: HTMLElement) {
  const { panel, body } = makePanel('oim-data-layers', t('data-layers.title', 'Data layers'))
  // The key's look and the printed legend's place to read the rows from.
  body.classList.add('oim-key-body')
  // The key's "Show all" (it unticks nothing, so it works wherever the rows are).
  const showAll = keyPane.parentElement?.querySelector('.oim-key-show-all')
  const header = panel.querySelector('.oim-panel-header')
  if (showAll && header) header.insertBefore(showAll, header.querySelector('.oim-panel-button'))

  const groups = switcher._layers.map((item) =>
    'layers' in item ? item : ({ title: '', layers: [item] } as SwitcherGroup)
  )
  const entries = groups.flatMap((g) => g.layers)
  const sections = keySections(keyPane)
  const rows = keyRows(keyPane)
  const styleLayers = (map.getStyle()?.layers ?? []) as unknown as StyleLayer[]
  const owner = assignSections(
    sections.map((s) => ({
      title: s.title,
      specs: rows.filter((r) => r.section === s.title).map((r) => r.spec)
    })),
    entries,
    styleLayers
  )
  const open = new Set(readJson<string[]>(OPEN_KEY, []))
  const boxes: [SwitcherLayer, HTMLInputElement][] = []

  /** A row that unfolds (its caret) to what's under it. */
  const foldable = (key: string, head: HTMLElement, inside: HTMLElement[]) => {
    const row = el('.oim-dl-entry')
    const caret = el('button.oim-dl-caret', { type: 'button', 'aria-expanded': 'false' })
    const under = el('.oim-dl-sections', inside)
    const draw = () => {
      const on = open.has(key)
      caret.textContent = on ? '▾' : '▸'
      caret.setAttribute('aria-expanded', String(on))
      under.hidden = !on
    }
    caret.onclick = () => {
      if (open.has(key)) open.delete(key)
      else open.add(key)
      writeJson(OPEN_KEY, [...open])
      draw()
    }
    draw()
    row.append(el('.oim-dl-head', inside.length ? caret : el('span.oim-dl-caret'), head), under)
    return row
  }

  const entryRow = (entry: SwitcherLayer) => {
    const box = el('input', {
      type: entry.groupId ? 'radio' : 'checkbox',
      name: entry.groupId ?? undefined
    }) as HTMLInputElement
    box.onchange = () => {
      // A radio group: the others go off (as upstream's list does).
      if (entry.groupId)
        for (const other of entries)
          if (other.groupId === entry.groupId) switcher.setVisibility(other.id, false)
      switcher.setVisibility(entry.id, box.checked)
      refresh()
    }
    boxes.push([entry, box])
    const mine = sections.filter((s) => owner[s.title] === entry.id)
    return foldable(
      entry.id,
      el('label.oim-dl-label', box, ` ${entry.title}`),
      mine.flatMap((s) => [s.heading, s.table])
    )
  }

  for (const group of groups) {
    body.append(...(group.title ? [el('h3.oim-dl-group', group.title)] : []), ...group.layers.map(entryRow))
  }
  // Key sections no entry draws.
  const loose = sections.filter((s) => !owner[s.title])
  if (loose.length) {
    body.append(
      el('h3.oim-dl-group', t('data-layers.other', 'Other')),
      ...loose.map((s) => foldable(`key:${s.title}`, el('span.oim-dl-label', s.title), [s.heading, s.table]))
    )
  }

  // The old key pane is empty now: the legend reads this one.
  keyPane.classList.remove('oim-key-body')

  /** The tick boxes from upstream's switcher (the address may have changed it). */
  const refresh = () => {
    for (const [entry, box] of boxes) box.checked = switcher._visible.includes(entry.id)
  }
  refresh()
  window.addEventListener('hashchange', refresh)
  return { panel, refresh }
}
