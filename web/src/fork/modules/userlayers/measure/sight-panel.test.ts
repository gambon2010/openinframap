import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Map } from 'maplibre-gl'
import type { UserFeature } from '../model/model.ts'
import { connectSightPanel, openSightPanel } from './sight-panel.ts'

const asked = vi.hoisted(() => [] as string[])
vi.mock('./sight.ts', async (original) => {
  const sight = await original<typeof import('./sight.ts')>()
  return {
    ...sight,
    sightAnswer: (from: number[], to: number[]) => {
      asked.push([...from, ...to].join(','))
      return Promise.resolve(null)
    }
  }
})

/** Only what the panel calls on the map. */
const fakeMap = {
  getContainer: () => document.body,
  setPadding: () => {},
  fitBounds: () => {},
  easeTo: () => {},
  getSource: () => undefined,
  getLayer: () => undefined
} as unknown as Map

const sightLine = (to: [number, number]): UserFeature => ({
  type: 'Feature',
  id: 'line',
  geometry: { type: 'LineString', coordinates: [[0, 0], to] },
  properties: { kind: 'measure', measure: 'sight' }
})

let stored: UserFeature | undefined
let changed: () => void = () => {}
connectSightPanel(fakeMap, {
  item: (id) => (stored?.id === id ? stored : undefined),
  onChange: (listener) => (changed = listener)
})

const panel = () => document.querySelector('.oim-ul-sight-panel')

describe("a line of sight's profile follows its line", () => {
  beforeEach(() => {
    asked.splice(0)
    stored = sightLine([1, 1])
    openSightPanel('line', () => {})
  })

  test('moved: asked again, with a spinner meanwhile', () => {
    expect(asked).toEqual(['0,0,1,1'])
    stored = sightLine([2, 1])
    changed()
    expect(asked).toEqual(['0,0,1,1', '0,0,2,1'])
    expect(panel()?.querySelector('.oim-spinner')).not.toBeNull()
  })

  test('another change in My layers: not asked again', () => {
    changed()
    expect(asked).toEqual(['0,0,1,1'])
  })

  test('deleted: the panel closes', async () => {
    stored = undefined
    changed()
    expect(panel()?.classList.contains('visible')).toBe(false)
    // The clean-up runs once the close is seen (a MutationObserver).
    await Promise.resolve()
    expect(panel()).toBeNull()
  })
})
