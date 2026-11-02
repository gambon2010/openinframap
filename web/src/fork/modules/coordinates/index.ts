// Fork: coordinates: the cursor's position and military grid reference (MGRS) at
// the bottom right (readout.ts), and grid references found by the search box
// (mgrs.ts; the formatting is core/mgrs.ts). Measuring is a My layers tool
// (userlayers/measure/).
import { ForkModule } from '../../types.ts'
import { MgrsSearch } from './mgrs.ts'
import { CoordinatesReadout } from './readout.ts'
import './coordinates.css'

const coordinates: ForkModule = {
  searchProviders: () => [new MgrsSearch()],

  init: ({ map }) => {
    // Bottom right, above the credits: the left side has the panels.
    map.addControl(new CoordinatesReadout(), 'bottom-right')
  }
}

export default coordinates
