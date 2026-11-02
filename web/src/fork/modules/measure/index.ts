// Fork: measuring and grid references (docs/SPECIFICATIONS.md 10.2): the cursor's
// position and military grid reference (MGRS) at the bottom (readout.ts), grid
// references found by the search box (mgrs.ts), and the Measure panel (📏 on the
// right, panel.ts): distances and bearings, areas, range rings (tool.ts; what they
// come to: features.ts; on the map: layers.ts; maths: geo.ts, north.ts).
import { el } from 'redom'
import { ForkModule } from '../../types.ts'
import { t } from '../../core/i18n.ts'
import { dock } from '../../ui/dock.ts'
import { MgrsSearch } from './mgrs.ts'
import { CoordinatesReadout } from './readout.ts'
import { MeasureTool } from './tool.ts'
import { MeasurePanel } from './panel.ts'
import './measure.css'

const measure: ForkModule = {
  searchProviders: () => [new MgrsSearch()],

  init: ({ map }) => {
    // Bottom right, above the credits: the left side has the panels.
    map.addControl(new CoordinatesReadout(), 'bottom-right')
    const panel = new MeasurePanel(map, new MeasureTool(map))
    const button = el('button.maplibregl-ctrl-icon.oim-measure-button', '📏', {
      type: 'button',
      title: t('measure.title', 'Measure'),
      'aria-label': t('measure.title', 'Measure')
    })
    map.addControl(
      { onAdd: () => el('div.maplibregl-ctrl.maplibregl-ctrl-group', button), onRemove: () => {} },
      'top-right'
    )
    dock.add(button, panel.panel)
  }
}

export default measure
