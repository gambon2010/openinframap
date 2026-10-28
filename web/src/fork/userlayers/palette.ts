// Fork: the symbol palette of "My layers": the MIL-STD-2525C point symbols ODINv2
// offers (catalogue: scripts/make_symbol_catalog.py), drawn by @syncpoint/signs.
import { tt } from './i18n.ts'
import { el } from 'redom'
import catalogue from './symbols-2525c.json'
import { symbolRenderer } from './symbols.ts'

type Entry = [code: string, name: string, depth: number]

const AFFILIATIONS: [string, string][] = [
  ['F', 'Friend'],
  ['H', 'Hostile'],
  ['N', 'Neutral'],
  ['U', 'Unknown']
]
const STATUSES: [string, string][] = [
  ['P', 'Present'],
  ['A', 'Planned'] // "anticipated" in the standard
]
const MAX_RESULTS = 150

/** A catalogue code (with * for affiliation and status) made concrete. */
export function concreteSidc(code: string, affiliation: string, status: string): string {
  const chars = code.split('')
  if (chars[1] === '*') chars[1] = affiliation
  if (chars[3] === '*') chars[3] = status
  return chars.join('')
}

/** The catalogue name of a concrete code. */
export function symbolName(sidc: string): string | undefined {
  for (const group of catalogue.groups) {
    for (const [code, name] of group.symbols as Entry[]) {
      if (concreteSidc(code, sidc[1], sidc[3]) === sidc) return name
    }
  }
  return undefined
}

export class Palette {
  el: HTMLElement
  private search: HTMLInputElement
  private affiliation: HTMLSelectElement
  private status: HTMLSelectElement
  private results: HTMLElement
  private onPick: (sidc: string, name: string) => void
  private render?: (sidc: string, size?: number) => string

  constructor(onPick: (sidc: string, name: string) => void) {
    this.onPick = onPick
    this.search = el('input.oim-ul-palette-search', {
      type: 'search',
      placeholder: tt('userlayers.palette.search', 'Search symbols (fire, hospital, bridge...)')
    }) as HTMLInputElement
    this.affiliation = el(
      'select',
      AFFILIATIONS.map(([value, label]) =>
        el('option', tt(`userlayers.affiliation.${value}`, label), { value })
      )
    ) as HTMLSelectElement
    this.status = el(
      'select',
      STATUSES.map(([value, label]) => el('option', tt(`userlayers.status.${value}`, label), { value }))
    ) as HTMLSelectElement
    this.results = el('.oim-ul-palette-results')
    this.el = el(
      '.oim-ul-palette',
      this.search,
      el('.oim-ul-palette-options', this.affiliation, this.status),
      this.results,
      el(
        'p.oim-ul-credit',
        tt('userlayers.palette.credit', 'Symbols: MIL-STD-2525C, drawn by @syncpoint/signs (as in ODIN).')
      )
    )
    this.search.oninput = () => this.update()
    this.affiliation.onchange = () => this.update()
    this.status.onchange = () => this.update()
  }

  /** Called when the palette is shown (loads the symbol library the first time). */
  async open() {
    if (!this.render) {
      this.results.textContent = tt('userlayers.palette.loading', 'Loading symbols...')
      this.render = await symbolRenderer()
    }
    this.update()
    this.search.focus()
  }

  private button(code: string, name: string): HTMLElement {
    const sidc = concreteSidc(code, this.affiliation.value, this.status.value)
    const button = el('button.oim-ul-symbol', { title: name, type: 'button' })
    try {
      button.innerHTML = this.render!(sidc, 18)
    } catch {
      button.textContent = '?'
    }
    button.onclick = () => this.onPick(sidc, name)
    return button
  }

  private update() {
    if (!this.render) return
    const query = this.search.value.trim().toLowerCase()
    this.results.textContent = ''
    if (query) {
      const matches: [string, string][] = []
      for (const group of catalogue.groups) {
        for (const [code, name] of group.symbols as Entry[]) {
          if (name.toLowerCase().includes(query)) matches.push([code, name])
        }
      }
      const grid = el('.oim-ul-symbol-grid')
      for (const [code, name] of matches.slice(0, MAX_RESULTS)) grid.append(this.labelled(code, name))
      this.results.append(
        matches.length
          ? grid
          : el('p.oim-ul-hint', tt('userlayers.palette.none', 'No symbol with that name.'))
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
      return
    }
    // Browsing: one collapsed section per group, drawn when opened.
    for (const group of catalogue.groups) {
      const body = el('.oim-ul-symbol-grid')
      const details = el(
        'details',
        el('summary', `${group.name} (${group.symbols.length})`),
        body
      ) as HTMLDetailsElement
      details.ontoggle = () => {
        if (!details.open || body.childElementCount) return
        for (const [code, name] of group.symbols as Entry[]) body.append(this.labelled(code, name))
      }
      this.results.append(details)
    }
  }

  private labelled(code: string, name: string): HTMLElement {
    return el('.oim-ul-symbol-entry', this.button(code, name), el('span', name))
  }
}
