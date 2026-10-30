// Fork: the symbol and graphics picker of "My layers": MIL-STD-2525C symbols and
// tactical graphics (catalogue: scripts/make_symbol_catalog.py). Point symbols are
// previewed by @syncpoint/signs; lines, areas and arrows are drawn on the map by the
// C5ISR renderer (graphics.ts), so the picker shows their kind instead.
import { tt } from './i18n.ts'
import { el } from 'redom'
import catalogue from './symbols-2525c.json'
import { symbolRenderer } from './symbols.ts'
import { graphicsLibrary, pointCount } from './graphics.ts'

/** [code with * for identity and status, name, depth, graphic geometry (L, A, M)] */
export type Entry = [code: string, name: string, depth: number, geometry?: 'L' | 'A' | 'M']

export type PaletteMode = 'symbols' | 'graphics'

const AFFILIATIONS: [string, string][] = [
  ['F', 'Friend'],
  ['H', 'Hostile'],
  ['N', 'Neutral'],
  ['U', 'Unknown']
]
const MAX_RESULTS = 150
const RECENT_KEY = 'oim-userlayers-recent'
const MAX_RECENT = 12

export const GEOMETRY_LABELS: Record<string, [string, string]> = {
  L: ['╱', 'Line'],
  A: ['▱', 'Area'],
  M: ['➚', 'Shape from points']
}

/** A catalogue code (with * for identity and status) made concrete. */
export function concreteSidc(code: string, affiliation: string, status: string): string {
  const chars = code.split('')
  if (chars[1] === '*') chars[1] = affiliation
  if (chars[3] === '*') chars[3] = status
  return chars.join('')
}

/** The catalogue code a concrete code comes from (identity and status as *). */
export function catalogueCode(sidc: string): string {
  return sidc[0] + '*' + sidc[2] + '*' + sidc.slice(4, 10)
}

const BY_CODE = new Map<string, Entry>()
for (const group of catalogue.groups) {
  for (const entry of group.symbols as Entry[]) BY_CODE.set(catalogueCode(entry[0]), entry)
}

/** The catalogue entry of a concrete code. */
export function entryOf(sidc: string): Entry | undefined {
  return BY_CODE.get(catalogueCode(sidc))
}

/** The catalogue name of a concrete code. */
export function symbolName(sidc: string): string | undefined {
  return entryOf(sidc)?.[1]
}

/** Entries of the mode, matching every word of the query, at most `limit`. */
export function searchCatalogue(query: string, mode: PaletteMode, group?: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const out: Entry[] = []
  for (const g of catalogue.groups) {
    if (group && g.name !== group) continue
    for (const entry of g.symbols as Entry[]) {
      if ((mode === 'graphics') !== Boolean(entry[3])) continue
      const name = entry[1].toLowerCase()
      if (words.every((w) => name.includes(w))) out.push(entry)
    }
  }
  return out
}

/** Groups that have entries for a mode. */
export function groupsFor(mode: PaletteMode): string[] {
  return catalogue.groups
    .filter((g) => (g.symbols as Entry[]).some((e) => (mode === 'graphics') === Boolean(e[3])))
    .map((g) => g.name)
}

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

/** Remember a picked catalogue code, most recent first. */
export function rememberRecent(code: string, recent = readRecent()): string[] {
  const next = [code, ...recent.filter((c) => c !== code)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Not remembered.
  }
  return next
}

export interface Pick {
  sidc: string
  name: string
  geometry?: 'L' | 'A' | 'M'
}

export class Palette {
  el: HTMLElement
  mode: PaletteMode = 'symbols'
  private search: HTMLInputElement
  private chips: HTMLElement
  private frames: HTMLElement
  private planned: HTMLInputElement
  private results: HTMLElement
  private affiliation = 'F'
  private group: string | undefined
  private onPick: (pick: Pick) => void
  private render?: (sidc: string, size?: number) => string
  // Graphics the renderer can draw (a few catalogue entries are only headings).
  private drawable?: Set<string>

  constructor(onPick: (pick: Pick) => void) {
    this.onPick = onPick
    this.search = el('input.oim-ul-palette-search', { type: 'search' }) as HTMLInputElement
    this.chips = el('.oim-ul-chips')
    this.frames = el('.oim-ul-frames')
    this.planned = el('input', { type: 'checkbox' }) as HTMLInputElement
    this.results = el('.oim-ul-palette-results')
    this.el = el(
      '.oim-ul-palette',
      this.search,
      el(
        '.oim-ul-palette-options',
        this.frames,
        el('label.oim-ul-inline', this.planned, tt('userlayers.planned', 'Planned'))
      ),
      this.chips,
      this.results,
      el(
        'p.oim-ul-credit',
        tt(
          'userlayers.palette.credit',
          'MIL-STD-2525C. Symbols drawn by @syncpoint/signs (as in ODIN), graphics by the C5ISR renderer.'
        )
      )
    )
    this.search.oninput = () => this.update()
    this.planned.onchange = () => this.update()
  }

  /** Show the palette for symbols or graphics (loads the symbol library the first time). */
  async open(mode: PaletteMode) {
    this.mode = mode
    this.group = undefined
    this.search.value = ''
    this.search.placeholder =
      mode === 'symbols'
        ? tt('userlayers.palette.search', 'Search symbols (fire, hospital, infantry...)')
        : tt('userlayers.palette.search-graphics', 'Search graphics (axis, phase line, block...)')
    if (!this.render) {
      this.results.textContent = tt('userlayers.palette.loading', 'Loading symbols...')
      this.render = await symbolRenderer()
    }
    if (mode === 'graphics' && !this.drawable) {
      const lib = await graphicsLibrary()
      this.drawable = new Set(
        searchCatalogue('', 'graphics')
          .filter(([code]) => pointCount(lib, concreteSidc(code, 'F', 'P')))
          .map(([code]) => code)
      )
    }
    this.update()
    this.search.focus()
  }

  private status() {
    return this.planned.checked ? 'A' : 'P'
  }

  private framesRow() {
    this.frames.textContent = ''
    for (const [value, label] of AFFILIATIONS) {
      const button = el(`button.oim-ul-frame${value === this.affiliation ? '.active' : ''}`, {
        type: 'button',
        title: tt(`userlayers.affiliation.${value}`, label),
        'aria-pressed': String(value === this.affiliation)
      })
      try {
        // An empty frame of that identity (a ground unit without an icon).
        button.innerHTML = this.render!(`S${value}G${this.status()}U--------`, 14)
      } catch {
        button.textContent = value
      }
      button.onclick = () => {
        this.affiliation = value
        this.update()
      }
      this.frames.append(button)
    }
  }

  private chipsRow() {
    this.chips.textContent = ''
    const chip = (label: string, group: string | undefined) => {
      const button = el(`button.oim-ul-chip${this.group === group ? '.active' : ''}`, label, {
        type: 'button'
      })
      button.onclick = () => {
        this.group = group
        this.update()
      }
      return button
    }
    this.chips.append(chip(tt('userlayers.palette.all', 'All'), undefined))
    for (const name of groupsFor(this.mode)) this.chips.append(chip(name, name))
  }

  private button(entry: Entry): HTMLElement {
    const [code, name, , geometry] = entry
    const sidc = concreteSidc(code, this.affiliation, this.status())
    const button = el('button.oim-ul-symbol', { title: name, type: 'button' })
    if (geometry) {
      const [glyph, kind] = GEOMETRY_LABELS[geometry]
      button.textContent = glyph
      button.title = `${name} (${tt(`userlayers.geometry.${geometry}`, kind)})`
    } else {
      try {
        button.innerHTML = this.render!(sidc, 18)
      } catch {
        button.textContent = '?'
      }
    }
    button.onclick = () => {
      rememberRecent(code)
      this.onPick({ sidc, name, geometry })
    }
    return button
  }

  private labelled(entry: Entry): HTMLElement {
    return el('.oim-ul-symbol-entry', this.button(entry), el('span', entry[1]))
  }

  private update() {
    if (!this.render) return
    this.framesRow()
    this.chipsRow()
    this.results.textContent = ''
    const query = this.search.value.trim()
    if (!query && !this.group) {
      const recent = readRecent()
        .map((code) => BY_CODE.get(catalogueCode(code)))
        .filter((e): e is Entry => Boolean(e) && (this.mode === 'graphics') === Boolean(e![3]))
      if (recent.length) {
        this.results.append(
          el('h4', tt('userlayers.palette.recent', 'Recently used')),
          el('.oim-ul-symbol-grid', ...recent.map((e) => this.labelled(e)))
        )
      }
      this.results.append(
        el('p.oim-ul-hint', tt('userlayers.palette.pick', 'Search by name, or pick a category above.'))
      )
      return
    }
    const matches = searchCatalogue(query, this.mode, this.group).filter(
      ([code, , , geometry]) => !geometry || !this.drawable || this.drawable.has(code)
    )
    const grid = el('.oim-ul-symbol-grid')
    for (const entry of matches.slice(0, MAX_RESULTS)) grid.append(this.labelled(entry))
    this.results.append(
      matches.length ? grid : el('p.oim-ul-hint', tt('userlayers.palette.none', 'Nothing with that name.'))
    )
    if (matches.length > MAX_RESULTS) {
      this.results.append(
        el(
          'p.oim-ul-hint',
          tt('userlayers.palette.more', 'Showing the first {{n}}: type more to narrow it down.', {
            n: MAX_RESULTS
          })
        )
      )
    }
  }
}
