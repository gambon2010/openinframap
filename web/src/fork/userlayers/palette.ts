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

/**
 * Categories in plain words, rather than the standard's sections: which catalogue
 * groups they take entries from, and which of those entries.
 */
export interface Category {
  mode: PaletteMode
  label: string
  groups: string[]
  test?: (entry: Entry) => boolean
}

const GRAPHIC_GROUPS = [
  'Tasks',
  'Command, control and manoeuvre',
  'Mobility and survivability',
  'Fire support',
  'Combat service support',
  'Other graphics'
]
const ARROW = /attack|axis|direction|advance|counterattack/i

export const CATEGORIES: Category[] = [
  { mode: 'symbols', label: 'Units', groups: ['Ground units', 'Special operations forces'] },
  { mode: 'symbols', label: 'Equipment and vehicles', groups: ['Ground equipment'] },
  { mode: 'symbols', label: 'Installations', groups: ['Installations'] },
  { mode: 'symbols', label: 'Incidents and emergencies', groups: ['Emergency management'] },
  { mode: 'symbols', label: 'Points on the map', groups: GRAPHIC_GROUPS },
  { mode: 'symbols', label: 'Air', groups: ['Air'] },
  { mode: 'symbols', label: 'Sea', groups: ['Sea surface', 'Subsurface'] },
  { mode: 'symbols', label: 'Space', groups: ['Space'] },
  { mode: 'symbols', label: 'Intelligence', groups: ['Signals intelligence'] },
  { mode: 'symbols', label: 'Civil and stability', groups: ['Stability operations'] },
  { mode: 'graphics', label: 'Arrows', groups: GRAPHIC_GROUPS, test: (e) => ARROW.test(e[1]) },
  { mode: 'graphics', label: 'Tasks', groups: ['Tasks'] },
  {
    mode: 'graphics',
    label: 'Lines',
    groups: ['Command, control and manoeuvre', 'Other graphics'],
    test: (e) => e[3] === 'L' && !ARROW.test(e[1])
  },
  {
    mode: 'graphics',
    label: 'Areas',
    groups: ['Command, control and manoeuvre', 'Other graphics'],
    test: (e) => e[3] === 'A'
  },
  {
    mode: 'graphics',
    label: 'Shapes',
    groups: ['Command, control and manoeuvre', 'Other graphics'],
    test: (e) => e[3] === 'M' && !ARROW.test(e[1])
  },
  { mode: 'graphics', label: 'Obstacles', groups: ['Mobility and survivability'] },
  { mode: 'graphics', label: 'Fire support', groups: ['Fire support'] },
  { mode: 'graphics', label: 'Logistics', groups: ['Combat service support'] }
]

/** Entries of the mode (in a category, if given), matching every word of the query. */
export function searchCatalogue(query: string, mode: PaletteMode, category?: string): Entry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const cat = category ? CATEGORIES.find((c) => c.mode === mode && c.label === category) : undefined
  const out: Entry[] = []
  for (const g of catalogue.groups) {
    if (cat && !cat.groups.includes(g.name)) continue
    for (const entry of g.symbols as Entry[]) {
      if ((mode === 'graphics') !== Boolean(entry[3])) continue
      if (cat?.test && !cat.test(entry)) continue
      const name = entry[1].toLowerCase()
      if (words.every((w) => name.includes(w))) out.push(entry)
    }
  }
  return out
}

/** The categories of a mode that have entries. */
export function categoriesFor(mode: PaletteMode): string[] {
  return CATEGORIES.filter((c) => c.mode === mode && searchCatalogue('', mode, c.label).length).map(
    (c) => c.label
  )
}

const FAVOURITES_KEY = 'oim-userlayers-favourites'

export function readFavourites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')
  } catch {
    return []
  }
}

/** Star or unstar a catalogue code; returns the favourites. */
export function toggleFavourite(code: string, favourites = readFavourites()): string[] {
  const next = favourites.includes(code) ? favourites.filter((c) => c !== code) : [...favourites, code]
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next))
  } catch {
    // Not remembered.
  }
  return next
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
    for (const name of categoriesFor(this.mode))
      this.chips.append(chip(tt(`userlayers.category.${name}`, name), name))
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
    const starred = readFavourites().includes(entry[0])
    const star = el(`button.oim-ul-star${starred ? '.on' : ''}`, starred ? '★' : '☆', {
      type: 'button',
      title: starred
        ? tt('userlayers.unfavourite', 'Remove from favourites')
        : tt('userlayers.favourite', 'Add to favourites')
    })
    star.onclick = () => {
      toggleFavourite(entry[0])
      this.update()
    }
    return el('.oim-ul-symbol-entry', this.button(entry), el('span', entry[1]), star)
  }

  private update() {
    if (!this.render) return
    this.framesRow()
    this.chipsRow()
    this.results.textContent = ''
    const query = this.search.value.trim()
    if (!query && !this.group) {
      const ofMode = (e: Entry | undefined): e is Entry =>
        Boolean(e) && (this.mode === 'graphics') === Boolean(e![3])
      const favourites = readFavourites()
        .map((code) => BY_CODE.get(catalogueCode(code)))
        .filter(ofMode)
      if (favourites.length) {
        this.results.append(
          el('h4', tt('userlayers.palette.favourites', 'Favourites')),
          el('.oim-ul-symbol-grid', ...favourites.map((e) => this.labelled(e)))
        )
      }
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
