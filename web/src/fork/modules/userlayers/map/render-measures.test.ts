import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { UserFeature, UserLayer } from '../model/model.ts'
import { MeasureDrawer, type MeasureView } from './render-measures.ts'

const asked = vi.hoisted(() => [] as string[])
vi.mock('../measure/sight.ts', async (original) => {
  const sight = await original<typeof import('../measure/sight.ts')>()
  return {
    ...sight,
    sightAnswer: (from: number[], to: number[]) => {
      asked.push([...from, ...to].join(','))
      return Promise.resolve(null)
    }
  }
})

const VIEW: MeasureView = {
  north: 'true',
  ticks: { zoom: 12, bounds: { west: 0, south: 0, east: 2, north: 2 } }
}

const sightLine = (to: [number, number]): UserFeature => ({
  type: 'Feature',
  id: 'line',
  geometry: { type: 'LineString', coordinates: [[0, 0], to] },
  properties: { kind: 'measure', measure: 'sight' }
})

const layerWith = (feature: UserFeature): UserLayer =>
  ({ id: 'layer', name: 'Layer', style: {}, features: new Map([[feature.id, feature]]) }) as UserLayer

describe('a line of sight on the map', () => {
  beforeEach(() => asked.splice(0))

  test('not asked while its point is dragged, asked for where it is dropped', () => {
    const drawer = new MeasureDrawer(() => {})
    const stored = sightLine([1, 1])
    const layer = layerWith(stored)
    drawer.layerFeatures(layer, VIEW, new Set())
    expect(asked).toEqual(['0,0,1,1'])
    // Dragged through two places: nothing asked.
    drawer.layerFeatures(layer, VIEW, new Set(), sightLine([1.5, 1]))
    drawer.layerFeatures(layer, VIEW, new Set(), sightLine([2, 1]))
    expect(asked).toEqual(['0,0,1,1'])
    // Dropped: the stored item has its new point.
    layer.features.set('line', sightLine([2, 1]))
    drawer.layerFeatures(layer, VIEW, new Set())
    expect(asked).toEqual(['0,0,1,1', '0,0,2,1'])
  })
})
