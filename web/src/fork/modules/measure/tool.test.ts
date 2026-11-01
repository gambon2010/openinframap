import { describe, expect, test } from 'vitest'
import { measurementFeatures, summary } from './tool.ts'

const leg: [number, number][] = [
  [7, 47],
  [7, 48]
]

describe('measurements', () => {
  test('what they come to', () => {
    expect(summary({ kind: 'distance', points: leg })).toBe('111 km, 000° (0 mils)')
    expect(summary({ kind: 'distance', points: [...leg, [8, 48]] })).toMatch(/^186 km$/)
    expect(summary({ kind: 'rings', points: [[7, 47]], radii: [1000, 5000] })).toBe('1 km, 5 km')
    expect(
      summary({
        kind: 'area',
        points: [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
          [0, 0.01]
        ]
      })
    ).toMatch(/^1\.2 km², perimeter 4\.45 km$/)
  })

  test('drawn: each leg labelled, the total at the end; rings labelled four times', () => {
    const features = measurementFeatures({ id: 1, kind: 'distance', points: [...leg, [8, 48]] })
    const labels = features.map((f) => f.properties?.label).filter(Boolean)
    expect(labels).toHaveLength(3)
    expect(labels[2]).toBe('186 km')
    const rings = measurementFeatures({ id: 2, kind: 'rings', points: [[7, 47]], radii: [1000, 2000] })
    expect(rings.filter((f) => f.geometry.type === 'LineString')).toHaveLength(2)
    expect(rings.filter((f) => f.properties?.label === '2 km')).toHaveLength(4)
  })

  test('the one being made is marked as a draft', () => {
    const features = measurementFeatures({ id: 0, kind: 'area', points: leg }, true)
    expect(features.every((f) => f.properties?.draft)).toBe(true)
  })
})
