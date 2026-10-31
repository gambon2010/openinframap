import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { StatusChange, featuresAt, statusesAt } from './playback.ts'

const change = (id: number, feature: number, status: StatusChange['status']): StatusChange => ({
  id,
  source: 'substation',
  feature_id: feature,
  status,
  previous: null,
  evidence: null,
  note: null,
  author: null,
  details: {},
  at: `2026-10-31T0${id}:00:00Z`
})

const changes = [
  change(1, 10, 'threatened'),
  change(2, 20, 'damaged'),
  change(3, 10, 'destroyed'),
  change(4, 20, 'repaired')
]

const all: FeatureCollection = {
  type: 'FeatureCollection',
  features: [10, 20].map((id) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [7, 48] },
    properties: { source: 'substation', id, name: `S${id}`, status: 'whatever' }
  }))
}

describe('playback', () => {
  it('replays the changes up to a step', () => {
    expect(statusesAt(changes, 0).size).toBe(0)
    expect(statusesAt(changes, 2).get('substation:10')?.status).toBe('threatened')
    expect(statusesAt(changes, 3).get('substation:10')?.status).toBe('destroyed')
  })

  it('gives the features as they were, the problems only for the map', () => {
    const at = (step: number, problems = false) =>
      featuresAt(all, changes, step, problems).features.map(
        (f) => `${f.properties?.name} ${f.properties?.status}`
      )
    expect(at(1)).toEqual(['S10 threatened'])
    expect(at(3)).toEqual(['S10 destroyed', 'S20 damaged'])
    expect(at(4)).toEqual(['S10 destroyed', 'S20 repaired'])
    expect(at(4, true)).toEqual(['S10 destroyed'])
  })
})
