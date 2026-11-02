// Fork: the Measure panel (📏 on the right): the three tools, the ring distances or
// the north bearings are from, what to do next, the measurement being made, and
// the ones kept (each removable). Drawn again whenever the tool changes; the text
// field and the north list are kept, so typing keeps the focus.
import { Map } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import { makePanel } from '../../ui/panel.ts'
import { formatDistance, parseDistances } from './geo.ts'
import { North, describeNorth } from './north.ts'
import { MeasureMode, Measurement, summary } from './features.ts'
import { MeasureTool } from './tool.ts'

const TOOLS: [MeasureMode, string, string][] = [
  ['distance', '📏', 'Distance'],
  ['area', '▱', 'Area'],
  ['rings', '◎', 'Range rings']
]

function hint(mode: MeasureMode): string {
  if (mode === 'rings')
    return t('measure.hint-rings', 'Click the centre of the rings. Right-click or Esc: stop.')
  return t(
    'measure.hint-points',
    'Click points; double-click or Enter to finish. Backspace: take back the last point. Right-click: drop this measurement (again: stop). Esc: stop.'
  )
}

export class MeasurePanel {
  readonly panel: HTMLElement
  private body: HTMLElement
  private radii = el('input.oim-measure-radii', {
    type: 'text',
    value: '1, 5, 10 km',
    'aria-label': t('measure.radii', 'Ring distances')
  }) as HTMLInputElement
  private radiiNote = el('span.oim-measure-note')
  private radiiRow = el(
    'label.oim-measure-radii-row',
    t('measure.radii', 'Ring distances'),
    this.radii,
    this.radiiNote
  )
  private north: HTMLSelectElement
  private northNote = el('span.oim-measure-note')
  private northRow: HTMLElement

  constructor(
    private map: Map,
    private tool: MeasureTool
  ) {
    const made = makePanel('oim-measure-panel', t('measure.title', 'Measure'))
    this.panel = made.panel
    this.body = made.body
    this.radii.oninput = () => {
      tool.radii = parseDistances(this.radii.value)
      this.update()
    }
    this.north = el(
      'select.oim-measure-north',
      (
        [
          ['true', t('measure.north-true', 'True north')],
          ['magnetic', t('measure.north-magnetic', 'Magnetic north (compass)')],
          ['grid', t('measure.north-grid', 'Grid north (MGRS)')]
        ] as [North, string][]
      ).map(([value, label]) => el('option', label, { value, selected: value === tool.north }))
    ) as HTMLSelectElement
    this.north.onchange = () => tool.setNorth(this.north.value as North)
    this.northRow = el(
      'label.oim-measure-radii-row',
      t('measure.bearings', 'Bearings from'),
      this.north,
      this.northNote
    )
    // How far that north is from true north: at the map's centre.
    map.on('moveend', () => {
      if (tool.north !== 'true') this.update()
    })
    tool.onChange(() => this.update())
    // The panel closed: the tool stops (what was measured stays).
    new MutationObserver(() => {
      if (!this.panel.classList.contains('visible')) tool.stop()
    }).observe(this.panel, { attributes: true, attributeFilter: ['class'] })
    this.update()
  }

  private toolButtons(): HTMLElement {
    return el(
      '.oim-measure-tools',
      TOOLS.map(([mode, icon, label]) => {
        const on = this.tool.mode === mode
        const b = el(
          `button.oim-measure-tool${on ? '.active' : ''}`,
          `${icon} ${t(`measure.${mode}`, label)}`,
          {
            type: 'button',
            'aria-pressed': String(on)
          }
        ) as HTMLButtonElement
        b.onclick = () => this.tool.start(mode)
        return b
      })
    )
  }

  private row(m: Measurement): HTMLElement {
    const remove = el('button.oim-measure-remove', '×', {
      type: 'button',
      title: t('measure.remove', 'Remove from the map')
    }) as HTMLButtonElement
    remove.onclick = () => this.tool.remove(m.id)
    const icon = TOOLS.find(([mode]) => mode === m.kind)![1]
    return el('li', el('span.oim-measure-kind', icon), el('span', summary(m, this.tool.north)), remove)
  }

  update() {
    const tool = this.tool
    this.radiiNote.textContent = tool.radii.length
      ? tool.radii.map(formatDistance).join(', ')
      : t('measure.radii-none', 'e.g. 1, 5, 10 km or 500 m, 3 nm')
    const centre = this.map.getCenter()
    this.northNote.textContent = describeNorth(tool.north, centre.lng, centre.lat)
    const draft = tool.draft
    const kept = tool.done.slice().reverse()
    const clear = el('button.oim-measure-clear', t('measure.clear', 'Remove all'), {
      type: 'button'
    }) as HTMLButtonElement
    clear.onclick = () => tool.clear()
    const parts: (HTMLElement | '')[] = [
      this.toolButtons(),
      tool.mode === 'rings' ? this.radiiRow : this.northRow,
      tool.mode ? el('p.oim-measure-hint', hint(tool.mode)) : '',
      draft && draft.points.length > 1 ? el('p.oim-measure-now', summary(draft, tool.north)) : '',
      kept.length
        ? el(
            'ul.oim-measure-list',
            kept.map((m) => this.row(m))
          )
        : '',
      kept.length > 1 ? clear : '',
      !tool.mode && !kept.length
        ? el(
            'p.oim-measure-note',
            t(
              'measure.about',
              'Measurements stay on the map until removed; they are not saved. The grid reference under the cursor is at the bottom right: click it to copy it.'
            )
          )
        : ''
    ]
    setChildren(
      this.body,
      parts.filter((p): p is HTMLElement => p !== '')
    )
  }
}
