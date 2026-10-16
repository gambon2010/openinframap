/*
 * Open Infrastructure Map search provider
 */
import { SearchResult, ISearchProvider } from './search'
import { formatVoltage, formatPower } from '../l10n'
import { t } from 'i18next'
import { BACKEND_BASE_URL } from '../config.js'
import { site_kind_label } from '../style/style_sites.ts'

// Fork: what the other named features are (schema/search.sql); critical sites use
// their kind's label from style_sites.ts.
function feature_kind_label(kind: string): string {
  return (
    {
      power_line: t('search.kind.power-line', 'Power line'),
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

type OIMResult = {
  name: string
  type: string
  place_type?: string
  operator?: string
  voltage?: number
  output?: number
  source?: string
  country: string
  // Fork: type "feature" (schema/search.sql)
  kind?: string
  town?: string
  layer?: string
  geometry: {
    coordinates: number[]
  }
}

type OIMResponse = {
  results: OIMResult[]
}

export default class OIMSearchProvider implements ISearchProvider {
  url = `${BACKEND_BASE_URL}/search/typeahead`
  baseScore: number = 0.9
  language: string
  regionNames: Intl.DisplayNames

  constructor(language: string = 'en') {
    this.language = language
    this.regionNames = new Intl.DisplayNames([language], { type: 'region' })
  }

  async search(query: string): Promise<SearchResult[]> {
    const searchParams = new URLSearchParams({
      q: query,
      lang: this.language,
      v: '2'
    })

    const result = await fetch(`${this.url}?${searchParams.toString()}`, {
      method: 'GET'
    })

    if (!result.ok) {
      throw new Error('Failed to fetch OIM search results')
    }

    const data = (await result.json()) as OIMResponse

    if (data.results.length === 0) {
      return []
    }

    return data.results.map((result: OIMResult, index: number) => ({
      latitude: result.geometry.coordinates[1],
      longitude: result.geometry.coordinates[0],
      name: result.name,
      description: this.description(result),
      layer: result.layer,
      score: this.baseScore - index * 0.1
    }))
  }

  description(result: OIMResult): string {
    let description = ''
    if (result.type === 'substation' && result.voltage) {
      description += `${t('names.power.substation')} (${formatVoltage(result.voltage / 1000)})`
    } else if (result.type === 'plant' && result.output) {
      description += `${t('names.power.plant')} (${formatPower(result.output / 1e6)})`
    } else if (result.type === 'feature' && result.kind) {
      // Fork: everything else with a name; the town tells apart the many "Mairie".
      description += result.source === 'site' ? site_kind_label(result.kind) : feature_kind_label(result.kind)
      if (result.town) description += `, ${result.town}`
      return description
    } else if (result.type === 'place' && result.place_type) {
      // Fork: local place search (cities, towns, villages…), see imposm/places.py.
      const fallback = result.place_type.charAt(0).toUpperCase() + result.place_type.slice(1)
      description += t(`search.place.${result.place_type}`, fallback)
    } else {
      description += `${result.type}`
    }
    if (result.country) {
      const country = this.regionNames.of(result.country)
      if (country) {
        description += `, ${country}`
      }
    }
    return description
  }
}
