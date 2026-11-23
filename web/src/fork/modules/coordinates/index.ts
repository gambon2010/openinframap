// Fork: coordinates: the cursor's position and military grid reference (MGRS) at
// the bottom left, next to the scale (readout.ts), and grid references found by the search box
// (mgrs.ts; the formatting is core/mgrs.ts). Measuring is a My layers tool
// (userlayers/measure/).
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import { MgrsSearch } from './mgrs.ts'
import { CoordinatesReadout } from './readout.ts'
import './coordinates.css'

const coordinates: ForkModule = {
  searchProviders: () => [new MgrsSearch()],
  shortcuts: () => [
    {
      keys: 'G',
      does: t('shortcuts.grid-reference', 'Copy the grid reference under the pointer'),
      group: t('shortcuts.everywhere', 'Everywhere')
    }
  ],

  init: ({ map }) => {
    // Bottom right, above the credits: the left side has the panels.
    map.addControl(new CoordinatesReadout(), 'bottom-left')
  }
}

export default coordinates
