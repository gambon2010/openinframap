// Fork: the map sources (background map tiles, Photon) as a section of the
// Settings window, at its end (map-sources.ts).
import { ForkModule } from '../../types.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import { MapSourcesSection } from './map-sources.ts'

const mapSources: ForkModule = {
  init: ({ map }) => {
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
