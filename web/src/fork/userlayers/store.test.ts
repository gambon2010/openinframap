import { beforeEach, describe, expect, test } from 'vitest'
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
