// Fork: the key's additions. Once upstream's key/key.ts has built its sections,
// forkKey() adds the fork modules' sections and a checkbox on every row that hides
// those features from the map (feature-hider.ts), plus a "Show all" button.
//
// Upstream's rows don't say what they show, so their swatches carry it: svg.ts
// marks lines with their colour (data-colour, data-dash) or layer (data-layer),
// key.ts marks icons with their sprite (data-icon). The fork's own rows carry their
// HideSpec in data-hide.
import { t } from 'i18next'
import { el } from 'redom'
import { Map } from 'maplibre-gl'
import { manifest } from 'virtual:render-svg'
import { FeatureHider, HideSpec } from './feature-hider.ts'
import { KeyRow, KeySection } from '../types.ts'
import './key.css'

// Dashed line swatches stand for line styles, not a colour: what they hide.
const DASHED_LINES: { [colour: string]: string[] } = {
  // Underground power lines, also the open-data ones (fork/extra).
  '#7A7A85': ['power_line_underground', 'extra_power_line_underground']
}

/** An icon from web/src/icons for a key row, as key.ts draws them. */
export function keySprite(name: string, size = 25): HTMLElement {
  return el('img.oim-key-symbol', {
    src: manifest['svg'][name],
    height: size,
    style: `max-width: ${size}px`,
    'data-icon': name
  })
}

/** What unticking an upstream row hides, from its swatch. */
function swatchSpec(swatch: Element | null): HideSpec | undefined {
  if (!swatch) return undefined
  const data = (swatch as HTMLElement).dataset ?? {}
  if (data.icon) return { icon: data.icon }
  if (data.layer) return { layers: [data.layer] }
  if (data.colour) {
    if (data.dash) {
      const layers = DASHED_LINES[data.colour]
      return layers ? { layers } : undefined
    }
    return { colour: data.colour }
  }
  return undefined
}

function sectionTable(rows: KeyRow[]): HTMLTableElement {
  return el(
    'table',
    rows.map(([label, swatch, hide]) => {
      const label_cell = el('td')
      label_cell.innerHTML = label
      const row = el('tr', label_cell, el('td', swatch ?? ''))
      if (hide) row.dataset.hide = JSON.stringify(hide)
      return row
    })
  ) as HTMLTableElement
}

function addSections(pane: HTMLElement, sections: KeySection[]) {
  for (const section of sections) {
    const after = section.appendTo
      ? [...pane.querySelectorAll('h3')].find((h3) => h3.textContent === section.appendTo)
      : undefined
    const table = after?.nextElementSibling
    if (table?.tagName === 'TABLE') {
      const rows = sectionTable(section.rows).querySelectorAll('tr')
      ;(table.querySelector('tbody') ?? table).append(...rows)
    } else {
      pane.append(el('h3', section.title), sectionTable(section.rows))
    }
  }
}

function addToggles(pane: HTMLElement, hider: FeatureHider) {
  for (const row of pane.querySelectorAll('tr')) {
    const spec: HideSpec | undefined = row.dataset.hide
      ? JSON.parse(row.dataset.hide)
      : swatchSpec(row.children[1]?.firstElementChild ?? null)
    const cell = el('td')
    row.append(cell)
    if (!spec) continue
    const box = el('input.oim-key-toggle', {
      type: 'checkbox',
      checked: !hider.isHidden(spec),
      title: t('key.toggle', 'Show on the map')
    }) as HTMLInputElement
    box.onchange = () => {
      hider.setHidden(spec, !box.checked)
      row.classList.toggle('oim-key-row-hidden', !box.checked)
    }
    row.classList.toggle('oim-key-row-hidden', hider.isHidden(spec))
    cell.append(box)
  }
}

function addShowAll(container: HTMLElement, hider: FeatureHider) {
  const header = container.querySelector('.oim-key-header')
  if (!header) return
  const button = el('button.oim-key-show-all', t('key.show-all', 'Show all'), {
    title: t('key.show-all-title', 'Show everything hidden from the key')
  })
  button.onclick = () => {
    hider.showAll()
    container.querySelectorAll<HTMLInputElement>('input.oim-key-toggle').forEach((box) => {
      box.checked = true
      box.closest('tr')?.classList.remove('oim-key-row-hidden')
    })
  }
  header.insertBefore(button, header.querySelector('.oim-key-close'))
}

/** Called by key.ts once its sections are in the pane. */
export async function extendKey(
  map: Map,
  container: HTMLElement,
  pane: HTMLElement,
  sections: KeySection[]
): Promise<void> {
  const hider = new FeatureHider(map)
  if (map.isStyleLoaded()) hider.apply()
  else map.once('load', () => hider.apply())
  addSections(pane, sections)
  addToggles(pane, hider)
  addShowAll(container, hider)
}
