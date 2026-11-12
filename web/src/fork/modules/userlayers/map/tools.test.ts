// What clicking, dragging, scrolling and the keyboard do in My layers (Tools), on a
// fake map and renderer with a real store: the safety net for splitting tools.ts
// (docs/plans/refactor-5e.md). Pixels: 1000 a degree, y down.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Map as MapLibre, MapGeoJSONFeature } from 'maplibre-gl'
import { Store } from '../state/store.ts'
import { Tools } from './tools.ts'
import type { Renderer } from './render.ts'
import { mapMode } from '../../../services/map-mode.ts'
import { UserFeature } from '../model/model.ts'

type Handler = (e: unknown) => void

class FakeMap {
  handlers = new globalThis.Map<string, Handler[]>()
  container = document.createElement('div')
  canvas = document.createElement('canvas')
  layers = new Set<string>()
  dragPan = { enable: vi.fn(), disable: vi.fn() }
  /** What queryRenderedFeatures finds, by the layers asked for ('' = any). */
  found: (layers: string[] | undefined) => Partial<MapGeoJSONFeature>[] = () => []

  on(type: string, handler: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler])
  }
  emit(type: string, e: unknown) {
    for (const h of this.handlers.get(type) ?? []) h(e)
  }
  getContainer() {
    return this.container
  }
  getCanvas() {
    return this.canvas
  }
  getLayer(id: string) {
    return this.layers.has(id) ? { id } : undefined
  }
  project([lng, lat]: [number, number]) {
    return { x: lng * 1000, y: -lat * 1000 }
  }
  queryRenderedFeatures(_box: unknown, options?: { layers?: string[] }) {
    return this.found(options?.layers)
  }
  /** What querySourceFeatures finds (a building's pieces, one per tile). */
  pieces: Partial<MapGeoJSONFeature>[] = []
  querySourceFeatures() {
    return this.pieces
  }
}

function fakeRenderer() {
  return {
    draft: vi.fn(),
    graphicDraft: vi.fn(),
    ghost: vi.fn(async () => {}),
    measureDraft: vi.fn(),
    preview: vi.fn(),
    select: vi.fn(),
    selectAll: vi.fn(),
    featureLayerIds: () => ['user_items'],
    iconBox: () => ({ right: 10, bottom: 10, left: -10, top: -10 })
  }
}

/** A mouse event at a place (lng, lat), its pixel there. */
function at(lng: number, lat: number, shiftKey = false) {
  return {
    lngLat: { lng, lat },
    point: { x: lng * 1000, y: -lat * 1000 },
    originalEvent: { shiftKey },
    preventDefault: vi.fn()
  }
}

let map: FakeMap
let store: Store
let tools: Tools

async function click(lng: number, lat: number, shiftKey = false) {
  map.emit('click', at(lng, lat, shiftKey))
  // Whatever the click started (a copy may ask the backend) is finished.
  await new Promise((done) => setTimeout(done, 0))
}

function key(k: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
}

function items(): UserFeature[] {
  return [...store.layers.values()].flatMap((l) => [...l.features.values()])
}

/** The map finds this item under the pointer (as My layers' layers draw it). */
function under(feature: UserFeature | null) {
  map.found = (layers) =>
    feature && layers?.includes('user_items') ? [{ properties: { fid: feature.id } } as never] : []
}

beforeEach(() => {
  localStorage.clear()
  if (mapMode.current) mapMode.leave(mapMode.current)
  map = new FakeMap()
  store = new Store()
  tools = new Tools(map as unknown as MapLibre, store, fakeRenderer() as unknown as Renderer, () => [])
})

describe('placing', () => {
  test('a click puts the item down in the layer, then selects it', async () => {
    tools.setTool({ mode: 'place', properties: { kind: 'marker' } })
    await click(7.5, 48.5)
    const [item] = items()
    expect(item.geometry).toEqual({ type: 'Point', coordinates: [7.5, 48.5] })
    expect(item.properties.kind).toBe('marker')
    expect(tools.tool.mode).toBe('select')
    expect(tools.selected).toBe(item.id)
  })

  test('Shift + scroll makes the item being placed bigger', () => {
    tools.setTool({ mode: 'place', properties: { kind: 'marker' } })
    // Shift + three notches up (happy-dom's WheelEvent leaves these out).
    const wheel = Object.defineProperties(new Event('wheel', { cancelable: true }), {
      deltaY: { value: -300 },
      deltaX: { value: 0 },
      deltaMode: { value: 0 },
      shiftKey: { value: true }
    })
    map.container.dispatchEvent(wheel)
    const tool = tools.tool as { properties: { size?: number } }
    expect(tool.properties.size).toBeGreaterThan(1)
    expect(wheel.defaultPrevented).toBe(true)
  })
})

describe('drawing lines and areas', () => {
  test('a line: clicks, then a double-click (its repeated point dropped)', async () => {
    tools.setTool({ mode: 'line', points: [] })
    await click(0, 0)
    await click(1, 0)
    await click(1, 1)
    await click(1, 1)
    map.emit('dblclick', { preventDefault: vi.fn() })
    const [line] = items()
    expect(line.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
        [1, 1]
      ]
    })
    expect(tools.tool.mode).toBe('select')
  })

  test('an area closes on a click on its first point', async () => {
    tools.setTool({ mode: 'area', points: [] })
    for (const [lng, lat] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.0001]
    ])
      await click(lng, lat)
    const [area] = items()
    expect(area.geometry.type).toBe('Polygon')
    expect((area.geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(5)
  })

  test("an area's point that would make it cross itself is refused", async () => {
    tools.setTool({ mode: 'area', points: [] })
    for (const [lng, lat] of [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1]
    ])
      await click(lng, lat)
    expect((tools.tool as { points: unknown[] }).points).toHaveLength(3)
    expect(tools.message).toMatch(/cross/)
  })

  test("an area's point too close to another is refused", async () => {
    tools.setTool({ mode: 'area', points: [] })
    await click(0, 0)
    await click(0.005, 0)
    expect((tools.tool as { points: unknown[] }).points).toHaveLength(1)
    expect(tools.message).toMatch(/close/i)
  })

  test('Backspace takes the last point back; Escape stops, nothing made', async () => {
    tools.setTool({ mode: 'line', points: [] })
    await click(0, 0)
    await click(1, 0)
    key('Backspace')
    expect((tools.tool as { points: unknown[] }).points).toEqual([[0, 0]])
    key('Escape')
    expect(tools.tool.mode).toBe('select')
    expect(items()).toHaveLength(0)
  })
})

describe('graphics', () => {
  test('one with a fixed number of points finishes by itself', async () => {
    tools.setTool({
      mode: 'graphic',
      properties: { kind: 'graphic', sidc: 'G*G*GLP---****X' },
      points: [],
      min: 2,
      max: 2
    })
    await click(0, 0)
    await click(1, 0)
    expect(items()).toHaveLength(1)
    expect(tools.tool.mode).toBe('select')
  })

  test('Enter before its minimum says how many it needs', async () => {
    tools.setTool({
      mode: 'graphic',
      properties: { kind: 'graphic', sidc: 'G*T*B----****X' },
      points: [],
      min: 3,
      max: 3
    })
    await click(0, 0)
    await click(1, 0)
    key('Enter')
    expect(items()).toHaveLength(0)
    expect(tools.message).toMatch(/3/)
  })
})

describe('selecting, moving and deleting', () => {
  async function marker(lng = 0, lat = 0): Promise<UserFeature> {
    tools.setTool({ mode: 'place', properties: { kind: 'marker' } })
    await click(lng, lat)
    return items().at(-1)!
  }

  test('a click on an item selects it, elsewhere unselects; Shift-click adds', async () => {
    const a = await marker(0, 0)
    const b = await marker(1, 1)
    under(a)
    await click(0, 0)
    expect(tools.selection()).toEqual([a.id])
    under(b)
    await click(1, 1, true)
    expect(tools.selection()).toEqual([a.id, b.id])
    under(null)
    await click(5, 5)
    expect(tools.selection()).toEqual([])
  })

  test('Delete removes what is selected', async () => {
    const a = await marker()
    under(a)
    await click(0, 0)
    key('Delete')
    expect(items()).toHaveLength(0)
    expect(tools.selected).toBeNull()
  })

  test('a selected item dragged moves, saved once on release', async () => {
    const a = await marker(0, 0)
    under(a)
    await click(0, 0)
    map.emit('mousedown', at(0, 0))
    map.emit('mousemove', at(0.5, 0.25))
    map.emit('mouseup', {})
    expect(store.layerOf(a.id)!.features.get(a.id)!.geometry).toEqual({
      type: 'Point',
      coordinates: [0.5, 0.25]
    })
    expect(map.dragPan.enable).toHaveBeenCalled()
  })

  test("a line's point dragged by its handle", async () => {
    tools.setTool({ mode: 'line', points: [] })
    await click(0, 0)
    await click(1, 0)
    key('Enter')
    const line = items()[0]
    expect(tools.selected).toBe(line.id)
    map.layers.add('user_selection_vertex')
    map.found = (layers) =>
      layers?.includes('user_selection_vertex') ? [{ properties: { index: 1 } } as never] : []
    map.emit('mousedown', at(1, 0))
    map.emit('mousemove', at(2, 2))
    map.emit('mouseup', {})
    expect(
      (store.layerOf(line.id)!.features.get(line.id)!.geometry as GeoJSON.LineString).coordinates
    ).toEqual([
      [0, 0],
      [2, 2]
    ])
  })

  test('a click without a move changes nothing', async () => {
    const a = await marker(0, 0)
    under(a)
    await click(0, 0)
    const before = store.pending.length
    map.emit('mousedown', at(0, 0))
    map.emit('mouseup', {})
    expect(store.pending.length).toBe(before)
  })
})

describe('off', () => {
  test('while a past version is shown, clicks do nothing', async () => {
    store.view.mode = 'playback'
    tools.setTool({ mode: 'place', properties: { kind: 'marker' } })
    await click(0, 0)
    expect(items()).toHaveLength(0)
    expect(tools.enabled).toBe(false)
  })
})

function shiftScroll(deltaY: number) {
  map.container.dispatchEvent(
    Object.defineProperties(new Event('wheel', { cancelable: true }), {
      deltaY: { value: deltaY },
      deltaX: { value: 0 },
      deltaMode: { value: 0 },
      shiftKey: { value: true }
    })
  )
}

describe('resizing and copying', () => {
  test('Shift + scroll on a selected marker resizes it, kept as one change', async () => {
    tools.setTool({ mode: 'place', properties: { kind: 'marker' } })
    await click(0, 0)
    const id = tools.selected!
    shiftScroll(-200)
    tools.select(null) // anything else done keeps the resize
    expect(store.layerOf(id)!.features.get(id)!.properties.size).toBeGreaterThan(1)
  })

  test('copy: the map feature under the click goes into the layer, once', async () => {
    tools = new Tools(map as unknown as MapLibre, store, fakeRenderer() as unknown as Renderer, () => [
      { id: 'power_tower', zorder: 10 } as never
    ])
    map.found = () => [
      {
        layer: { id: 'power_tower' },
        source: 'power',
        sourceLayer: 'power_tower',
        properties: { osm_id: 5, name: 'T5' },
        geometry: { type: 'Point', coordinates: [3, 4] }
      } as never
    ]
    tools.setTool({ mode: 'copy' })
    await click(3, 4)
    const [copy] = items()
    expect(copy.properties.kind).toBe('copy')
    expect(copy.properties.copy).toEqual({
      source: 'power',
      sourceLayer: 'power_tower',
      layer: 'power_tower'
    })
    await click(3, 4)
    expect(items()).toHaveLength(1)
    expect(tools.message).toMatch(/Already/)
  })

  test('copy: a building becomes an ordinary area, its exact outline from the backend, once', async () => {
    tools = new Tools(map as unknown as MapLibre, store, fakeRenderer() as unknown as Renderer, () => [
      { id: 'buildings_outline', zorder: -10 } as never
    ])
    const square = (w: number, e: number) => ({
      type: 'Polygon',
      coordinates: [
        [
          [w, 0],
          [e, 0],
          [e, 1],
          [w, 1],
          [w, 0]
        ]
      ]
    })
    const building = 35184388166030
    map.found = () => [
      {
        id: building,
        layer: { id: 'buildings_outline' },
        source: 'basemap',
        sourceLayer: 'buildings',
        properties: { kind: 'building', height: 12 },
        geometry: square(0, 1.1)
      } as never
    ]
    // Cut at a tile edge (x = 1), each piece a little over it.
    map.pieces = [
      { id: building, geometry: square(0, 1.1) },
      { id: building, geometry: square(0.9, 2) }
    ] as never
    // The backend joins its pieces from the zoom 15 tiles (here, a bit wider than
    // what's on screen: zoomed out, the tiles' shapes are simplified).
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      return new Response(JSON.stringify({ geometry: square(0, 2.5) }))
    })
    tools.setTool({ mode: 'copy' })
    await click(0.5, 0.5)
    const [copy] = items()
    expect(asked[0]).toMatch(new RegExp(`^/background/building/${building}\\?lon=0&lat=0$`))
    expect(copy.properties).toMatchObject({ kind: 'drawing', name: 'Building', height: 12 })
    expect(copy.properties.color).toBeTruthy()
    const xs = (copy.geometry as GeoJSON.Polygon).coordinates[0].map(([x]) => x)
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 2.5])
    await click(0.5, 0.5)
    expect(items()).toHaveLength(1)
    expect(tools.message).toMatch(/Already/)
    // The backend out of reach: the pieces on screen, joined.
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    store.deleteFeature(store.layerOf(copy.id)!.id, copy.id)
    await click(0.5, 0.5)
    const xs2 = (items()[0].geometry as GeoJSON.Polygon).coordinates[0].map(([x]) => x)
    expect([Math.min(...xs2), Math.max(...xs2)]).toEqual([0, 2])
    vi.unstubAllGlobals()
  })
})
