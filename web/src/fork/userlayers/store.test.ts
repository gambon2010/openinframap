import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Change, UserLayer } from './model.ts'
import { Store, applyChange } from './store.ts'

const at = '2026-10-30T10:00:00Z'
const point: GeoJSON.Point = { type: 'Point', coordinates: [7.75, 48.58] }

describe('applyChange', () => {
  test('layers and features, in order', () => {
    const layers = new Map<string, UserLayer>()
    const changes: Change[] = [
      { op: 'layer_create', layer_id: 'a', data: { name: 'Grid', style: { color: '#ff0000' } }, made_at: at },
      {
        op: 'feature_create',
        layer_id: 'a',
        feature_id: 'f1',
        data: { geometry: point, properties: { kind: 'marker' } },
        made_at: at
      },
      { op: 'layer_update', layer_id: 'a', data: { name: 'Grid 2' }, made_at: at },
      {
        op: 'feature_update',
        layer_id: 'a',
        feature_id: 'f1',
        data: { geometry: point, properties: { kind: 'marker', name: 'Here' } },
        made_at: at
      }
    ]
    for (const change of changes) applyChange(layers, change)
    const layer = layers.get('a')!
    expect(layer.name).toBe('Grid 2')
    expect(layer.style).toEqual({ color: '#ff0000' }) // a rename keeps the style
    expect(layer.features.get('f1')?.properties.name).toBe('Here')

    applyChange(layers, { op: 'feature_delete', layer_id: 'a', feature_id: 'f1', made_at: at })
    expect(layer.features.size).toBe(0)
    applyChange(layers, { op: 'layer_delete', layer_id: 'a', made_at: at })
    expect(layers.size).toBe(0)
  })

  test('changes to a layer that is gone are ignored', () => {
    const layers = new Map<string, UserLayer>()
    applyChange(layers, { op: 'layer_update', layer_id: 'x', data: { name: 'Nope' }, made_at: at })
    applyChange(layers, {
      op: 'feature_create',
      layer_id: 'x',
      feature_id: 'f',
      data: { geometry: point, properties: { kind: 'marker' } },
      made_at: at
    })
    expect(layers.size).toBe(0)
  })
})

describe('Store', () => {
  let store: Store
  beforeEach(() => {
    localStorage.clear()
    store = new Store()
  })

  test('every edit is a pending change, kept in the browser', () => {
    const layer = store.createLayer('Grid')
    const id = store.addFeature(layer, point, { kind: 'symbol', sidc: 'SFGPUCI--------' })
    expect(store.activeLayer).toBe(layer)
    expect(store.layerOf(id)?.id).toBe(layer)
    expect(store.pending.map((c) => c.op)).toEqual(['layer_create', 'feature_create'])
    expect(JSON.parse(localStorage.getItem('oim-userlayers-pending')!)).toHaveLength(2)
  })

  test('moving a feature to another layer: out of one, into the other', () => {
    const a = store.createLayer('A')
    const b = store.createLayer('B')
    const id = store.addFeature(a, point, { kind: 'marker', name: 'Pin' })
    store.moveFeature(id, b)
    expect(store.layers.get(a)!.features.has(id)).toBe(false)
    expect(store.layers.get(b)!.features.get(id)?.properties.name).toBe('Pin')
    expect(store.pending.slice(-2).map((c) => [c.op, c.layer_id])).toEqual([
      ['feature_delete', a],
      ['feature_create', b]
    ])
  })

  test('moving to the same layer or a missing one does nothing', () => {
    const a = store.createLayer('A')
    const id = store.addFeature(a, point, { kind: 'marker' })
    const before = store.pending.length
    store.moveFeature(id, a)
    store.moveFeature(id, 'missing')
    expect(store.pending.length).toBe(before)
  })

  test('deleting the active layer picks another', () => {
    const a = store.createLayer('A')
    const b = store.createLayer('B')
    expect(store.activeLayer).toBe(b)
    store.deleteLayer(b)
    expect(store.activeLayer).toBe(a)
  })

  test('hiding a layer is remembered but is not a change', () => {
    const a = store.createLayer('A')
    const before = store.pending.length
    store.setHidden(a, true)
    expect(store.hidden.has(a)).toBe(true)
    expect(store.pending.length).toBe(before)
    expect(new Store().hidden.has(a)).toBe(true)
  })
})

describe('undo and redo', () => {
  let store: Store
  beforeEach(() => {
    localStorage.clear()
    store = new Store()
  })

  test('one change at a time, and back', () => {
    const layer = store.createLayer('A')
    const id = store.addFeature(layer, point, { kind: 'marker', name: 'one' })
    store.updateFeature(layer, {
      ...store.layers.get(layer)!.features.get(id)!,
      properties: { kind: 'marker', name: 'two' }
    })
    store.undo()
    expect(store.layers.get(layer)!.features.get(id)!.properties.name).toBe('one')
    store.undo()
    expect(store.layers.get(layer)!.features.has(id)).toBe(false)
    expect(store.canRedo).toBe(true)
    store.redo()
    store.redo()
    expect(store.layers.get(layer)!.features.get(id)!.properties.name).toBe('two')
    expect(store.canRedo).toBe(false)
  })

  test('something new after an undo: nothing left to redo', () => {
    const layer = store.createLayer('A')
    store.addFeature(layer, point, { kind: 'marker' })
    store.undo()
    store.addFeature(layer, point, { kind: 'marker' })
    expect(store.canRedo).toBe(false)
  })

  test('several items changed, moved or deleted at once: one undo each', () => {
    const a = store.createLayer('A')
    const b = store.createLayer('B')
    const ids = [1, 2, 3].map((n) => store.addFeature(a, point, { kind: 'marker', name: String(n) }))
    const count = store.pending.length
    store.updateFeatures(
      ids.map((id) => ({
        layerId: a,
        feature: { ...store.layers.get(a)!.features.get(id)!, properties: { kind: 'marker', name: 'x' } }
      }))
    )
    store.moveFeatures(ids, b)
    expect(store.layers.get(b)!.features.size).toBe(3)
    store.undo() // the move
    expect(store.layers.get(a)!.features.size).toBe(3)
    expect([...store.layers.get(a)!.features.values()].every((f) => f.properties.name === 'x')).toBe(true)
    store.undo() // the change
    expect([...store.layers.get(a)!.features.values()].map((f) => f.properties.name)).toEqual(['1', '2', '3'])
    expect(store.pending.length).toBe(count)
    store.deleteFeatures(ids)
    expect(store.layers.get(a)!.features.size).toBe(0)
    store.undo()
    expect(store.layers.get(a)!.features.size).toBe(3)
  })
})

describe('what Save would change', () => {
  test('changes that cancel out count for nothing', async () => {
    localStorage.clear()
    // The saved state, as the backend returns it.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              last_save: 1,
              layers: [
                {
                  id: 'L',
                  name: 'Grid',
                  style: { color: '#d32f2f' },
                  features: [
                    { type: 'Feature', id: 'F', geometry: point, properties: { kind: 'marker', name: 'a' } }
                  ]
                }
              ]
            })
          )
      )
    )
    const store = new Store()
    await store.load()
    expect(store.unsavedCount).toBe(0)
    const style = store.layers.get('L')!.style
    store.updateLayer('L', { style: { ...style, locked: true } })
    expect(store.unsavedCount).toBe(1)
    store.updateLayer('L', { style: { ...style, locked: undefined } })
    expect(store.unsavedCount).toBe(0) // locked then unlocked
    expect(store.pending.length).toBe(2) // still there to undo
    store.undo()
    expect(store.unsavedCount).toBe(1)
    const feature = store.layers.get('L')!.features.get('F')!
    store.updateFeature('L', { ...feature, properties: { kind: 'marker', name: 'b' } })
    store.updateFeature('L', { ...feature, properties: { kind: 'marker', name: 'a' } })
    expect(store.unsavedCount).toBe(1) // only the lock
    vi.unstubAllGlobals()
  })
})

test('an update that changes nothing is not a change', () => {
  localStorage.clear()
  const store = new Store()
  const layer = store.createLayer('A')
  const id = store.addFeature(layer, point, { kind: 'marker', name: 'x' })
  const count = store.pending.length
  store.updateFeature(layer, structuredClone(store.layers.get(layer)!.features.get(id)!))
  store.updateLayer(layer, { name: 'A' })
  store.updateLayer(layer, { style: { ...store.layers.get(layer)!.style } })
  expect(store.pending.length).toBe(count)
})

describe('undo after a save', () => {
  // A backend that keeps what's saved, like the real one.
  let saved: Change[]
  beforeEach(() => {
    localStorage.clear()
    saved = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          saved.push(...(JSON.parse(String(init.body)).changes as Change[]))
          return new Response(JSON.stringify({ ok: true }))
        }
        const layers = new Map<string, UserLayer>()
        for (const change of saved) applyChange(layers, change)
        return new Response(
          JSON.stringify({
            layers: [...layers.values()].map((l) => ({ ...l, features: [...l.features.values()] }))
          })
        )
      })
    )
    return () => vi.unstubAllGlobals()
  })

  test('takes back saved steps with new changes, without touching the server', async () => {
    const store = new Store()
    await store.load()
    const layer = store.createLayer('A')
    const id = store.addFeature(layer, point, { kind: 'marker', name: 'one' })
    await store.save()
    store.updateFeature(layer, {
      ...store.layers.get(layer)!.features.get(id)!,
      properties: { kind: 'marker', name: 'two' }
    })
    await store.save()
    const sent = saved.length

    store.undo() // the rename, saved
    expect(store.layers.get(layer)!.features.get(id)!.properties.name).toBe('one')
    expect(store.pending.map((c) => c.op)).toEqual(['feature_update'])
    expect(store.unsavedCount).toBe(1)
    store.undo() // the new item, saved
    expect(store.layers.get(layer)!.features.has(id)).toBe(false)
    expect(store.pending.map((c) => c.op)).toEqual(['feature_update', 'feature_delete'])
    expect(saved.length).toBe(sent) // nothing sent until Save

    store.redo()
    expect(store.layers.get(layer)!.features.get(id)!.properties.name).toBe('one')
    expect(store.pending.length).toBe(1)
    await store.save()
    expect(saved.at(-1)!.op).toBe('feature_update')
    // The undo is saved: the next one goes on from there, to the new layer.
    store.undo()
    expect(store.layers.get(layer)!.features.has(id)).toBe(false)
    store.undo()
    expect(store.layers.has(layer)).toBe(false)
    expect(store.canUndo).toBe(false)
  })

  test('a deleted layer comes back with its items', async () => {
    const store = new Store()
    await store.load()
    const layer = store.createLayer('A')
    store.addFeature(layer, point, { kind: 'marker' })
    store.addFeature(layer, point, { kind: 'marker' })
    store.updateLayer(layer, { name: 'B' })
    await store.save()
    store.deleteLayer(layer)
    await store.save()
    store.undo()
    expect(store.layers.get(layer)!.name).toBe('B')
    expect(store.layers.get(layer)!.features.size).toBe(2)
    expect(store.pending.map((c) => c.op)).toEqual(['layer_create', 'feature_create', 'feature_create'])
  })

  test('discarding puts the undone saved steps back', async () => {
    const store = new Store()
    await store.load()
    const layer = store.createLayer('A')
    await store.save()
    store.undo()
    expect(store.layers.has(layer)).toBe(false)
    await store.discard()
    expect(store.layers.has(layer)).toBe(true)
    expect(store.canUndo).toBe(true)
    store.undo()
    expect(store.layers.has(layer)).toBe(false)
  })

  test('unsaved changes are undone first', async () => {
    const store = new Store()
    await store.load()
    const layer = store.createLayer('A')
    await store.save()
    store.updateLayer(layer, { name: 'B' })
    store.undo()
    expect(store.pending.length).toBe(0)
    expect(store.layers.get(layer)!.name).toBe('A')
    store.undo()
    expect(store.layers.has(layer)).toBe(false)
  })
})
