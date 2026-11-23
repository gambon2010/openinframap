// Fork: the satellite button among the map's buttons: what's under the map's data,
// the background map or satellite imagery (the bold roads and railways over either
// are data layers: modules/roads). Pressed while imagery shows. The choice is kept
// in services/background.ts, which the imagery (modules/satellite) follows. It can be
// pressed only where there is imagery; otherwise its title says why.
import type { Map } from 'maplibre-gl'
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import { satelliteIcon } from '../../ui/icons.ts'
import { addMapButton, showPressed } from '../../ui/map-button.ts'
import { background } from '../../services/background.ts'

/** Whether the imagery covers any of the map's view (none: false). */
async function imageryHere(map: Map): Promise<boolean> {
  const imagery = background.imagery()
  if (!imagery) return false
  const b = map.getBounds()
  return imagery.covers([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
}

/** The button's title: what it does, or why it can't. */
function titleOf(here: boolean): string {
  if (!background.imagery())
    return t(
      'background.none',
      'No satellite imagery yet. Run "bash scripts/offline-maps.sh" (your data stays): NASA Blue Marble for the whole world, Sentinel-2 10 m for your region, and in France IGN aerial photos.'
    )
  if (!here)
    return t('background.not-here', 'No satellite imagery here: move the map to where you have some.')
  return background.chosen() === 'satellite'
    ? t('background.show-map', 'Show the map')
    : t('background.show-satellite', 'Show satellite imagery')
}

const backgroundModule: ForkModule = {
  init: ({ map }) => {
    const button = addMapButton(map, {
      content: satelliteIcon(),
      title: t('background.show-satellite', 'Show satellite imagery'),
      className: 'oim-background-button',
      onclick: () => background.choose(background.chosen() === 'satellite' ? 'map' : 'satellite')
    })
    let here = false
    const draw = () => {
      showPressed(button, background.mode() === 'satellite')
      // Imagery chosen stays pressable where there's none, to go back to the map.
      button.disabled = !here && background.chosen() !== 'satellite'
      button.title = titleOf(here)
      button.setAttribute('aria-label', button.title)
    }
    const checkCoverage = async () => {
      here = await imageryHere(map)
      draw()
    }
    map.on('moveend', () => void checkCoverage())
    background.onChange(() => void checkCoverage())
    void checkCoverage()
  }
}

export default backgroundModule
