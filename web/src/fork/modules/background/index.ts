// Fork: Settings → Background: the background map in high contrast or in its
// original colours, or satellite imagery, alone or with the map's roads. The
// choice is kept in services/background.ts, which the map's colours
// (modules/map-sources/palette.ts) and the imagery (modules/satellite) follow; the
// imagery choices only when there is some, and only where the map is.
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import { BackgroundChoice, background } from '../../services/background.ts'
import './background.css'

const isMap = (choice: BackgroundChoice) => choice === 'original' || choice === 'contrast'

const backgroundModule: ForkModule = {
  init: ({ map }) => {
    const choices: [BackgroundChoice, string, string][] = [
      [
        'contrast',
        t('background.map-contrast', 'Map, high contrast'),
        t('background.map-contrast-help', 'Each kind of area its own shade: towns, fields, woods, water')
      ],
      [
        'original',
        t('background.map-original', 'Map, original colours'),
        t('background.map-original-help', "Open Infrastructure Map's own, paler")
      ],
      [
        'satellite',
        t('background.satellite', 'Satellite'),
        t('background.satellite-help', 'Imagery, with place names')
      ],
      [
        'hybrid',
        t('background.hybrid', 'Satellite with roads'),
        t('background.hybrid-help', 'Imagery with roads, railways and borders')
      ]
    ]
    const imagery = background.imagery()
    const radios = choices
      .filter(([choice]) => isMap(choice) || imagery)
      .map(([choice, label, help]) => {
        const input = el('input', {
          type: 'radio',
          name: 'oim-background',
          value: choice
        }) as HTMLInputElement
        input.onchange = () => background.choose(choice)
        return {
          choice,
          input,
          row: el('label.oim-background-choice', input, el('span', el('strong', label), el('small', help)))
        }
      })
    // No imagery where the map is: the imagery choices can't be picked.
    const nothingHere = el(
      'p.oim-map-sources-note',
      t('background.not-here', 'No satellite imagery here: move the map to where you have some.')
    )
    nothingHere.hidden = true
    const section = el(
      'section.oim-background',
      el('h3', t('background.title', 'Background')),
      el('.oim-background-choices', ...radios.map((r) => r.row)),
      el(
        'p.oim-map-sources-note',
        imagery
          ? t('background.zooms', 'Imagery up to zoom {{zoom}}.', { zoom: imagery.maxzoom })
          : t(
              'background.none',
              'No satellite imagery yet. Run "bash scripts/satellite.sh" (your data stays): NASA Blue Marble for the whole world, Sentinel-2 10 m for your region, and in France IGN aerial photos.'
            )
      ),
      nothingHere
    )
    const checkCoverage = async () => {
      if (!imagery) return
      const b = map.getBounds()
      const here = await imagery.covers([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      for (const r of radios) {
        if (isMap(r.choice)) continue
        r.input.disabled = !here
        r.row.classList.toggle('disabled', !here)
      }
      nothingHere.hidden = here
    }
    map.on('moveend', () => {
      if (section.isConnected) void checkCoverage()
    })
    addSettingsSection({
      el: section,
      refresh: () => {
        const chosen = background.choice()
        for (const r of radios) r.input.checked = r.choice === chosen
        void checkCoverage()
      }
    })
  }
}

export default backgroundModule
