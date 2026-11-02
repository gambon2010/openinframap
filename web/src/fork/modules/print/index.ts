// Fork: printing the map as a PDF (docs/SPECIFICATIONS.md 10.7): "print" in the
// header opens a window (title, paper, orientation, legend); the PDF has the map as
// on screen with a legend, the scale, north and the centre's grid reference
// (pdf.ts). What the legend lists, modules say (ui/legend.ts).
import { el } from 'redom'
import { ForkModule } from '../../types.ts'
import { t } from '../../core/i18n.ts'
import { author } from '../../core/author.ts'
import { makeModal } from '../../ui/panel.ts'
import { addLegend } from '../../ui/legend.ts'
import { printMap } from './pdf.ts'
import type { Orientation, Paper } from './layout.ts'
import './print.css'

const TITLE_KEY = 'oim-print-title'

function remembered(): string {
  try {
    return localStorage.getItem(TITLE_KEY) || ''
  } catch {
    return ''
  }
}

const print: ForkModule = {
  init: ({ map, layerSwitcher }) => {
    // The legend starts with the map's layers that are on (their names).
    addLegend(() => {
      const visible = new Set(layerSwitcher._visible)
      const titles = layerSwitcher._layers
        .flatMap((item) => ('layers' in item ? item.layers : [item]))
        .filter((layer) => visible.has(layer.id))
        .map((layer) => ({ label: layer.title }))
      return [{ title: t('print.map-layers', 'Map layers shown'), entries: titles }]
    })
    const title = el('input', {
      type: 'text',
      value: remembered() || t('print.default-title', 'Open Infrastructure Map')
    }) as HTMLInputElement
    const paper = el(
      'select',
      el('option', 'A4', { value: 'a4' }),
      el('option', 'A3', { value: 'a3' })
    ) as HTMLSelectElement
    const orientation = el(
      'select',
      el('option', t('print.landscape', 'Landscape'), { value: 'landscape' }),
      el('option', t('print.portrait', 'Portrait'), { value: 'portrait' })
    ) as HTMLSelectElement
    const legend = el('input', { type: 'checkbox', checked: true }) as HTMLInputElement
    const status = el('p.oim-print-status')
    const make = el('button.oim-print-make', t('print.make', 'Make the PDF'), {
      type: 'button'
    }) as HTMLButtonElement
    const modal = makeModal(
      t('print.title', 'Print the map'),
      el('p.oim-print-note', t('print.about', 'The map as it is on screen now, with what is shown on it.')),
      el('label.oim-print-field', el('span', t('print.title-field', 'Title')), title),
      el('label.oim-print-field', el('span', t('print.paper', 'Paper')), paper),
      el('label.oim-print-field', el('span', t('print.orientation', 'Orientation')), orientation),
      el('label.oim-print-check', legend, t('print.with-legend', 'With a legend')),
      make,
      status
    )
    let me = ''
    make.onclick = async () => {
      make.disabled = true
      status.textContent = t('print.making', 'Making the PDF…')
      try {
        localStorage.setItem(TITLE_KEY, title.value.trim())
      } catch {
        // Not remembered.
      }
      try {
        await printMap(map, {
          title: title.value.trim() || t('print.default-title', 'Open Infrastructure Map'),
          paper: paper.value as Paper,
          orientation: orientation.value as Orientation,
          legend: legend.checked,
          author: author() || me
        })
        status.textContent = ''
        modal.close()
      } catch (e) {
        console.error('Printing the map failed', e)
        status.textContent = t('print.failed', "The PDF couldn't be made: {{error}}", {
          error: (e as Error).message ?? String(e)
        })
      } finally {
        make.disabled = false
      }
    }
    const link = el('a', t('nav.print', 'print'), { href: '#print' })
    link.onclick = (event: Event) => {
      event.preventDefault()
      status.textContent = ''
      modal.open()
      title.select()
      // Signed with your account's name if there's no other.
      void fetch('/auth/me')
        .then(async (r) => (r.ok ? ((await r.json()) as { name: string }).name : ''))
        .then((name) => (me = name))
        .catch(() => undefined)
    }
    document.querySelector('header nav ul')?.append(' ', el('li', link))
  }
}

export default print
