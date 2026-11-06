// Fork: the map sources (background map tiles, Photon) as a section of the
// Settings window, at its end (map-sources.ts); place names when zoomed in
// (labels.ts); the background map's colours (palette.ts).
import { ForkModule } from '../../types.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import { MapSourcesSection } from './map-sources.ts'
import { placeLabelZooms } from './labels.ts'
import { backgroundPalette } from './palette.ts'

const mapSources: ForkModule = {
  init: ({ map }) => {
    placeLabelZooms(map)
    backgroundPalette(map)
    const section = new MapSourcesSection(map)
    addSettingsSection({
      el: section.el,
      order: 100,
      refresh: () => section.refresh(),
      focus: () => section.rows[0].input.focus()
    })
  }
}

export default mapSources
