import { describe, expect, test } from 'vitest'
import { measurementFeatures, summary } from './features.ts'

const leg: [number, number][] = [
  [7, 47],
  [7, 48]
]

describe('measurements', () => {
  test('what they come to', () => {
    expect(summary({ kind: 'distance', points: leg })).toBe('111 km, 000°T (0 mils)')
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

describe('the tool', () => {
  test('right-click drops the measurement being made, then stops the tool; Esc stops it', async () => {
    const { MeasureTool } = await import('./tool.ts')
    const { mapMode } = await import('../../ui/map-mode.ts')
    const handlers: Record<string, (e: unknown) => void> = {}
    const map = {
      on: (name: string, handler: (e: unknown) => void) => (handlers[name] = handler),
      once: () => undefined,
      project: ([x, y]: [number, number]) => ({ x: x * 1000, y: y * 1000 }),
      getSource: () => ({ setData: () => undefined }),
      doubleClickZoom: { enable: () => undefined, disable: () => undefined },
      getCanvas: () => ({ style: {} })
    }
    const router = { handleClick: () => undefined }
    mapMode.install(map as never, router as never)
    const tool = new MeasureTool(map as never)
    const event = { preventDefault: () => undefined, originalEvent: { preventDefault: () => undefined } }
    const click = (lng: number) => handlers.click({ ...event, lngLat: { lng, lat: 47 } })
    tool.start('distance')
    expect(mapMode.current).toBe('measure')
    click(7)
    click(7.1)
    expect(tool.points).toHaveLength(2)
    handlers.contextmenu(event)
    expect(tool.points).toHaveLength(0)
    expect(tool.done).toHaveLength(0)
    expect(tool.mode).toBe('distance')
    handlers.contextmenu(event)
    expect(tool.mode).toBeNull()
    expect(mapMode.current).toBeNull()
    tool.start('area')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(tool.mode).toBeNull()
  })
})
