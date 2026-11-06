// Fork: the key on a printed map (ui/legend.ts): the key's rows (upstream's and the
// fork modules', as in the Key panel) whose features are drawn in the printed area,
// under the key's own headings, with their swatches. A row says what it draws the
// way unticking it hides it (feature-hider.ts specConditions): the map layers, and
// for each the features it's about (this colour, this icon).
import type { ExpressionSpecification, FilterSpecification, Map } from 'maplibre-gl'
import type { LegendArea, LegendEntry, LegendSection } from '../../services/legend.ts'
import { HideSpec, StyleLayer, specConditions } from './feature-hider.ts'
import { swatchSpec } from './toggles.ts'

/** One row of the Key panel: its heading, label, swatch and what it draws. */
export interface KeyRowInfo {
  section: string
  label: string
  swatch: Element | null
  spec: HideSpec
}

/** The key's rows that say what they draw (in its order), wherever they are in the
 * pane (the Data layers panel folds them under its entries). */
export function keyRows(pane: ParentNode | null): KeyRowInfo[] {
  const rows: KeyRowInfo[] = []
  let section = ''
  for (const child of pane?.querySelectorAll('h3:not(.oim-dl-group), table') ?? []) {
    if (child.tagName === 'H3') section = child.textContent?.trim() ?? ''
    if (child.tagName !== 'TABLE') continue
    for (const row of child.querySelectorAll('tr')) {
      const html = row as HTMLElement
      const swatch = row.children[1]?.firstElementChild ?? null
      const spec: HideSpec | undefined = html.dataset.hide
        ? JSON.parse(html.dataset.hide)
        : swatchSpec(swatch)
      const label = row.children[0]?.textContent?.trim() ?? ''
      if (spec && label) rows.push({ section, label, swatch, spec })
    }
  }
  return rows
}

/** The query filter for a row's features in a layer: its "keep if" turned round. */
export function drawnFilter(condition: ExpressionSpecification | false): FilterSpecification | undefined {
  if (condition === false) return undefined
  // Conditions are ['!=', expr, value]: the row's features are where it's equal.
  const [op, expr, value] = condition as unknown as [string, unknown, unknown]
  return (op === '!=' ? ['==', expr, value] : ['!', condition]) as FilterSpecification
}

/** Whether any feature a row draws is drawn in an area of the map. */
function drawnIn(map: Map, spec: HideSpec, layers: StyleLayer[], area: LegendArea): boolean {
  const box: [[number, number], [number, number]] = [
    [area.x, area.y],
    [area.x + area.w, area.y + area.h]
  ]
  for (const [id, condition] of specConditions(spec, layers)) {
    if (map.getLayoutProperty(id, 'visibility') === 'none') continue
    try {
      const filter = drawnFilter(condition)
      if (map.queryRenderedFeatures(box, { layers: [id], ...(filter ? { filter } : {}) }).length) return true
    } catch {
      // A filter the query can't take: this layer says nothing.
    }
  }
  return false
}

const svgs = new globalThis.Map<string, Promise<string | null>>()

/** A swatch as SVG: an inline <svg> as it is, an <img> (a sprite) fetched. */
async function swatchSvg(swatch: Element | null): Promise<string | null> {
  if (!swatch) return null
  if (swatch.tagName.toLowerCase() === 'svg') {
    const svg = swatch.cloneNode(true) as Element
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    return svg.outerHTML
  }
  const src = (swatch as HTMLImageElement).src
  if (!src) return null
  if (!svgs.has(src)) {
    svgs.set(
      src,
      fetch(src)
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null)
    )
  }
  return svgs.get(src)!
}

/** The key's rows drawn in `area`, by the key's headings. */
export async function keyLegend(map: Map, area: LegendArea, order = 0): Promise<LegendSection[]> {
  const layers = ((map.getStyle()?.layers ?? []) as unknown as StyleLayer[]).filter(
    (l) => !l.id.startsWith('user_')
  )
  const sections: LegendSection[] = []
  const seen = new Set<string>()
  for (const row of keyRows(document.querySelector('.oim-key-body'))) {
    const key = `${row.section}\n${row.label}`
    if (seen.has(key) || !drawnIn(map, row.spec, layers, area)) continue
    seen.add(key)
    let section = sections.find((s) => s.title === row.section)
    if (!section) {
      section = { title: row.section, entries: [], order }
      sections.push(section)
    }
    const entry: LegendEntry = { label: row.label }
    const svg = await swatchSvg(row.swatch)
    if (svg) entry.svg = svg
    section.entries.push(entry)
  }
  return sections
}
