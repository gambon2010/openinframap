import { describe, expect, test } from 'vitest'
import { measure } from './measure.ts'

const line = {
  type: 'LineString' as const,
  coordinates: [
    [0, 0],
    [1, 1]
  ]
}

describe('dragging a measurement', () => {
  test('a line of sight only by its points: it is placed by where one stands and looks', () => {
    expect(measure.pointsOnly?.({ geometry: line, properties: { kind: 'measure', measure: 'sight' } })).toBe(
      true
    )
  })

  test('a distance moved whole too', () => {
    expect(
      measure.pointsOnly?.({ geometry: line, properties: { kind: 'measure', measure: 'distance' } })
    ).toBe(false)
  })
})
