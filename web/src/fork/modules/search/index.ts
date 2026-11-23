// Fork: search additions. The backend also finds places (imposm/places.py) and
// everything else with a name (schema/fork/search.sql); these say what each result is.
// Picking one leaves the layers as they are: the details panel pins it (details/).
import { groundDistance } from '../../core/geo.ts'
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import type { SearchResult } from '../../../search/search.ts'
import PhotonSearch from './photon.ts'
import { SEARCH_INPUT } from './search.constants.ts'

// What the named features of schema/fork/search.sql are (critical sites: fork/sites).
function feature_kind_label(kind: string): string {
  return (
    {
      power_line: t('search.kind.power-line', 'Power line'),
      power_tower: t('search.kind.power-tower', 'Tower, numbered along its line'),
      building: t('search.kind.building-number', 'Building, numbered in its area'),
      named_building: t('search.kind.named-building', 'Building'),
      generator: t('search.kind.generator', 'Generator'),
      switchgear: t('search.kind.switchgear', 'Switchgear'),
      street_cabinet: t('search.kind.street-cabinet', 'Street cabinet'),
      telecom_building: t('search.kind.telecom-building', 'Telecoms building'),
      telecom_location: t('search.kind.telecom-location', 'Telecoms site'),
      mast: t('search.kind.mast', 'Mast'),
      antenna: t('search.kind.antenna', 'Antenna'),
      telecom_cable: t('search.kind.telecom-cable', 'Telecoms cable'),
      petroleum_site: t('search.kind.petroleum-site', 'Oil or gas site'),
      petroleum_well: t('search.kind.petroleum-well', 'Oil or gas well'),
      pipeline: t('search.kind.pipeline', 'Pipeline'),
      pipeline_feature: t('search.kind.pipeline-feature', 'Pipeline station'),
      marker: t('search.kind.marker', 'Pipeline marker'),
      pressurised_waterway: t('search.kind.pressurised-waterway', 'Penstock, water pipe'),
      pumping_station: t('search.kind.pumping-station', 'Pumping station'),
      wastewater_plant: t('search.kind.wastewater-plant', 'Wastewater plant'),
      water_treatment_plant: t('search.kind.water-treatment-plant', 'Water treatment plant'),
      water_reservoir: t('search.kind.water-reservoir', 'Water reservoir'),
      water_tower: t('search.kind.water-tower', 'Water tower'),
      water_well: t('search.kind.water-well', 'Water well'),
      icpe: t('search.kind.icpe', 'Classified installation (ICPE)'),
      biomethane_injection: t('search.kind.biomethane-injection', 'Biomethane injection point'),
      distribution_substation: t('search.kind.distribution-substation', 'Distribution substation')
    }[kind] || kind
  )
}

/** / or Ctrl+K: the search box, the cursor in it (/ not while typing elsewhere). */
export function focusSearchOnKey(e: KeyboardEvent) {
  const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')
  const slash = e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey
  const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
  const box = document.querySelector<HTMLInputElement>(SEARCH_INPUT)
  if (!(slash || ctrlK) || !box) return
  e.preventDefault()
  box.focus()
  box.select()
}

const search: ForkModule = {
  init: () => document.addEventListener('keydown', focusSearchOnKey),
  shortcuts: () => [
    {
      keys: '/  ' + t('shortcuts.or', 'or') + '  Ctrl+K',
      does: t('shortcuts.search', 'The search box'),
      group: t('shortcuts.everywhere', 'Everywhere')
    }
  ],
  // Addresses from a Photon server, if one is configured.
  searchProviders: (language) => [new PhotonSearch(language)],

  searchDescription: (result) => {
    if (result.type === 'feature' && result.kind) {
      // The town tells apart the many features with the same name ("Mairie").
      return feature_kind_label(result.kind) + (result.town ? `, ${result.town}` : '')
    }
    if (result.type === 'place' && result.place_type) {
      const fallback = result.place_type.charAt(0).toUpperCase() + result.place_type.slice(1)
      return t(`search.place.${result.place_type}`, fallback)
    }
    return undefined
  }
}

// The same place can come from more than one provider (local database and
// Photon), or twice from one (mapped as a point and an area). Keep the
// best-scored result for each name within 5 km on the ground.
const DUPLICATE_METRES = 5000

/** search/search.ts: results sorted best first, without duplicates. */
export function dropDuplicates(results: SearchResult[]): SearchResult[] {
  const kept: SearchResult[] = []
  for (const result of results) {
    const duplicate = kept.some(
      (k) =>
        k.name.toLowerCase() === result.name.toLowerCase() &&
        groundDistance([k.longitude, k.latitude], [result.longitude, result.latitude]) < DUPLICATE_METRES
    )
    if (!duplicate) kept.push(result)
  }
  return kept
}

export default search
