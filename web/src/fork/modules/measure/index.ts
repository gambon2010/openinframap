// Fork: measuring and grid references (docs/SPECIFICATIONS.md 10.2): the cursor's
// position and military grid reference (MGRS) at the bottom left, grid references
// found by the search box, and the Measure panel (📏 on the right): distances and
// bearings, areas, range rings.
import { MapMouseEvent } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { ForkModule } from '../../types.ts'
import { t } from '../../core/i18n.ts'
import { dock } from '../../ui/dock.ts'
import { makePanel } from '../../ui/panel.ts'
import { mapClicks } from '../../ui/map-clicks.ts'
import { formatDistance, parseDistances } from './geo.ts'
import { MgrsSearch } from './mgrs.ts'
import { CoordinatesReadout } from './readout.ts'
import { MeasureMode, MeasureTool, summary } from './tool.ts'
import './measure.css'

const TOOLS: [MeasureMode, string, string][] = [
  ['distance', '📏', 'Distance'],
  ['area', '▱', 'Area'],
  ['rings', '◎', 'Range rings']
]

function hint(mode: MeasureMode): string {
  if (mode === 'rings') return t('measure.hint-rings', 'Click the centre of the rings. Esc: stop.')
  return t(
    'measure.hint-points',
    'Click points; double-click or Enter to finish. Backspace: take back the last point. Esc: stop.'
  )
}

const measure: ForkModule = {
  searchProviders: () => [new MgrsSearch()],

  init: ({ map, clickRouter }) => {
    map.addControl(new CoordinatesReadout(), 'bottom-left')
    const tool = new MeasureTool(map)

    // While measuring, clicks on features don't open their details. The click router
    // calls handleClick for every click on its layers (wrapped as My layers does).
    const router = clickRouter as unknown as { handleClick: (e: MapMouseEvent) => void }
    const handleClick = router.handleClick.bind(clickRouter)
    router.handleClick = (e) => {
      if (mapClicks.taken !== 'measure') handleClick(e)
    }

    const { panel, body } = makePanel('oim-measure-panel', t('measure.title', 'Measure'))
    const radii = el('input.oim-measure-radii', {
      type: 'text',
      value: '1, 5, 10 km',
      'aria-label': t('measure.radii', 'Ring distances')
    }) as HTMLInputElement
    // Kept (not drawn again), so typing in it keeps the focus.
    const radiiNote = el('span.oim-measure-note')
    const radiiRow = el('label.oim-measure-radii-row', t('measure.radii', 'Ring distances'), radii, radiiNote)
    radii.oninput = () => {
      tool.radii = parseDistances(radii.value)
      update()
    }

    const update = () => {
      const buttons = TOOLS.map(([mode, icon, label]) => {
        const b = el(
          `button.oim-measure-tool${tool.mode === mode ? '.active' : ''}`,
          `${icon} ${t(`measure.${mode}`, label)}`,
          {
            type: 'button',
            'aria-pressed': String(tool.mode === mode)
          }
        ) as HTMLButtonElement
        b.onclick = () => tool.start(mode)
        return b
      })
      radiiNote.textContent = tool.radii.length
        ? tool.radii.map(formatDistance).join(', ')
        : t('measure.radii-none', 'e.g. 1, 5, 10 km or 500 m, 3 nm')
      const draft = tool.draft
      const list = tool.done
        .slice()
        .reverse()
        .map((m) => {
          const remove = el('button.oim-measure-remove', '×', {
            type: 'button',
            title: t('measure.remove', 'Remove from the map')
          }) as HTMLButtonElement
          remove.onclick = () => tool.remove(m.id)
          const name = TOOLS.find(([mode]) => mode === m.kind)!
          return el('li', el('span.oim-measure-kind', name[1]), el('span', summary(m)), remove)
        })
      const clear = el('button.oim-measure-clear', t('measure.clear', 'Remove all'), {
        type: 'button'
      }) as HTMLButtonElement
      clear.onclick = () => tool.clear()
      const parts: (HTMLElement | '')[] = [
        el('.oim-measure-tools', buttons),
        tool.mode === 'rings' ? radiiRow : '',
        tool.mode ? el('p.oim-measure-hint', hint(tool.mode)) : '',
        draft && draft.points.length > 1 ? el('p.oim-measure-now', summary(draft)) : '',
        list.length ? el('ul.oim-measure-list', list) : '',
        list.length > 1 ? clear : '',
        !tool.mode && !list.length
          ? el(
              'p.oim-measure-note',
              t(
                'measure.about',
                'Measurements stay on the map until removed; they are not saved. The grid reference under the cursor is at the bottom left: click it to copy it.'
              )
            )
          : ''
      ]
      setChildren(
        body,
        parts.filter((p): p is HTMLElement => p !== '')
      )
    }
    tool.onChange(update)
    update()

    const button = el('button.maplibregl-ctrl-icon.oim-measure-button', '📏', {
      type: 'button',
      title: t('measure.title', 'Measure'),
      'aria-label': t('measure.title', 'Measure')
    })
    map.addControl(
      { onAdd: () => el('div.maplibregl-ctrl.maplibregl-ctrl-group', button), onRemove: () => {} },
      'top-right'
    )
    dock.add(button, panel)
    // The panel closed: the tool stops (what was measured stays).
    new MutationObserver(() => {
      if (!panel.classList.contains('visible')) tool.stop()
    }).observe(panel, { attributes: true, attributeFilter: ['class'] })
  }
}

export default measure
