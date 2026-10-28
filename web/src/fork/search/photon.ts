/*
 * Search provider for a Photon geocoder (https://github.com/komoot/photon):
 * addresses and places from OpenStreetMap. Optional: only used when a Photon URL
 * is configured (VITE_PHOTON_URL in web/.env, or the Map sources panel).
 */
import { SearchResult, ISearchProvider } from '../../search/search'
import { getPhotonUrl } from '../config.ts'

type PhotonFeature = {
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    street?: string
    housenumber?: string
    city?: string
    state?: string
    country?: string
  }
}

// Languages a standard Photon index has names for.
const PHOTON_LANGUAGES = ['en', 'de', 'fr', 'it']

export default class PhotonSearch implements ISearchProvider {
  baseScore: number = 0.8
  language: string

  constructor(language: string = 'en') {
    this.language = language.split('-')[0]
  }

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    const base = getPhotonUrl().replace(/\/+$/, '')
    if (!base) {
      return []
    }
    const params = new URLSearchParams({ q: query, limit: limit.toString() })
    if (PHOTON_LANGUAGES.includes(this.language)) {
      params.set('lang', this.language)
    }

    const response = await fetch(`${base}/api?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`Photon search failed (${response.status})`)
    }
    const data = (await response.json()) as { features: PhotonFeature[] }

    return data.features.map((feature, index) => {
      const p = feature.properties
      const street = [p.street, p.housenumber].filter(Boolean).join(' ')
      const name = p.name || street || p.city || ''
      const description = [p.name ? street : '', p.city, p.state, p.country]
        .filter((part) => part && part !== name)
        .join(', ')
      return {
        latitude: feature.geometry.coordinates[1],
        longitude: feature.geometry.coordinates[0],
        name,
        description,
        score: this.baseScore - index * 0.1
      }
    })
  }
}
