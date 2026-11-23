// Fork: "About this map" (the fork's page, backend fork/about.py) at the start of
// the map's credits (the ⓘ, bottom right), where the header's "about" was. MapLibre
// adds its credits control itself and has no way to add a line to it later: it's
// replaced by one with the link (the same, compact).
import { AttributionControl, type IControl, type Map } from 'maplibre-gl'
import { t } from '../../core/i18n.ts'

export function aboutInCredits(map: Map) {
  const controls = (map as unknown as { _controls: IControl[] })._controls ?? []
  const current = controls.find((c) => c instanceof AttributionControl)
  if (current) map.removeControl(current)
  const label = t('nav.about-map', 'About this map').replace(/[<>&"]/g, '')
  map.addControl(
    new AttributionControl({ compact: true, customAttribution: `<a href="/about">${label}</a>` }),
    'bottom-right'
  )
  // MapLibre puts a bottom control added later above the others: back in the corner.
  const credits = map.getContainer().querySelector('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib')
  credits?.parentElement?.append(credits)
}
