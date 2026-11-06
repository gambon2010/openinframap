// Fork: printing the map as a PDF (docs/SPECIFICATIONS.md 10.7): the printer among
// the map's buttons (top right) opens a window (title, paper, orientation, legend), beside the map: a frame
// on the map shows what will be printed (frame.ts), and the map can be moved under
// it. The PDF: the map filling the page, a box over its corner with the legend, the
// scale, north and the centre's grid reference (pdf.ts). What the legend lists,
// modules say (ui/legend.ts).
import { el } from 'redom'
import { addMapButton } from '../../ui/map-button.ts'
import { printerIcon } from '../../ui/icons.ts'
import { ForkModule } from '../../types.ts'
import { t } from '../../core/i18n.ts'
import { makePanel } from '../../ui/panel.ts'
import { addLegend } from '../../services/legend.ts'
import { keyLegend } from '../../ui/key/legend.ts'
import { printMap } from './pdf.ts'
import { Orientation, Paper, mapBox, pageSize, printedArea } from './layout.ts'
import { PrintFrame } from './frame.ts'
import { readText, writeText } from '../../core/storage.ts'
import './print.css'

const TITLE_KEY = 'oim-print-title'

function remembered(): string {
  return readText(TITLE_KEY) || ''
}

const print: ForkModule = {
  init: ({ map }) => {
    // The legend starts with the key's rows of what's in the printed area.
    addLegend((map, area) => keyLegend(map, area))
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
    const { panel } = makePanel(
      'oim-print-panel',
      t('print.title', 'Print the map'),
      el(
        'p.oim-print-note',
        t(
          'print.about-frame',
          'What is inside the frame on the map is printed, filling the page. Move or zoom the map to change it. The legend goes in a box over its bottom-right corner.'
        )
      ),
      el('label.oim-print-field', el('span', t('print.title-field', 'Title')), title),
      el('label.oim-print-field', el('span', t('print.paper', 'Paper')), paper),
      el('label.oim-print-field', el('span', t('print.orientation', 'Orientation')), orientation),
      el('label.oim-print-check', legend, t('print.with-legend', 'With a legend')),
      make,
      status
    )
    document.body.append(panel)
    const frame = new PrintFrame(map, (width, height) =>
      printedArea(width, height, mapBox(pageSize(paper.value as Paper, orientation.value as Orientation)))
    )
    paper.onchange = () => frame.update()
    orientation.onchange = () => frame.update()
    const close = () => panel.classList.remove('visible')
    // Closed (its × or Escape): no frame.
    new MutationObserver(() => {
      if (!panel.classList.contains('visible')) frame.hide()
    }).observe(panel, { attributes: true, attributeFilter: ['class'] })
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })
    let me = ''
    make.onclick = async () => {
      make.disabled = true
      status.textContent = t('print.making', 'Making the PDF…')
      writeText(TITLE_KEY, title.value.trim())
      try {
        await printMap(map, {
          title: title.value.trim() || t('print.default-title', 'Open Infrastructure Map'),
          paper: paper.value as Paper,
          orientation: orientation.value as Orientation,
          legend: legend.checked,
          author: me
        })
        status.textContent = ''
        close()
      } catch (e) {
        console.error('Printing the map failed', e)
        status.textContent = t('print.failed', "The PDF couldn't be made: {{error}}", {
          error: (e as Error).message ?? String(e)
        })
      } finally {
        make.disabled = false
      }
    }
    const open = () => {
      status.textContent = ''
      panel.classList.add('visible')
      frame.show()
      title.select()
      // Signed with your account's name if there's no other.
      void fetch('/auth/me')
        .then(async (r) => (r.ok ? ((await r.json()) as { name: string }).name : ''))
        .then((name) => (me = name))
        .catch(() => undefined)
    }
    // Among the map's buttons, top right.
    addMapButton(map, {
      content: printerIcon(),
      title: t('print.button', 'Print the map (PDF)'),
      className: 'oim-print-button',
      onclick: open
    })
  }
}

export default print
