import { beforeEach, describe, expect, it } from 'vitest'
import { type Buildings, buildingLayers, followLook, raisedFilter } from './look.ts'
import { BUILDINGS_LAYER, PARTS_LAYER, ZOOMED_OUT_LAYER } from '../../core/buildings.ts'
import { background } from '../../services/background.ts'
import { view3d } from '../../services/view3d.ts'
import { DEFAULT_HEIGHT_M, OUTLINE_OPACITY, ROOF_OPACITY, SHADOW_OPACITY } from './buildings.constants.ts'

const layers = buildingLayers()
const layer = (id: string) => layers.find((l) => l.id === id)!

describe('buildings raised in the 3D view', () => {
  it('rise to their height, a standard one if the map has none, from where they start', () => {
    const raised = layer(`${BUILDINGS_LAYER}_3d`)
    expect(raised.type).toBe('fill-extrusion')
    expect(raised.paint).toMatchObject({
      'fill-extrusion-height': ['coalesce', ['get', 'height'], DEFAULT_HEIGHT_M],
      'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0]
    })
    expect(layer(`${ZOOMED_OUT_LAYER}_3d`).type).toBe('fill-extrusion')
  })

  it('leave out the buildings with parts: their parts rise instead', () => {
    const whole: Buildings = {
      source: 's',
      sourceLayer: 'l',
      filter: ['==', ['get', 'kind'], 'building'],
      minzoom: 15
    }
    expect(raisedFilter(BUILDINGS_LAYER, whole, new Set())).toEqual(whole.filter)
    expect(raisedFilter(BUILDINGS_LAYER, whole, new Set([7, 9]))).toEqual([
      'all',
      whole.filter,
      ['match', ['id'], [7, 9], false, true]
    ])
    const parts: Buildings = { ...whole, filter: ['==', ['get', 'kind'], 'building_part'] }
    expect(raisedFilter(PARTS_LAYER, parts, new Set([7]))).toEqual(parts.filter)
    expect(layer(`${PARTS_LAYER}_3d`).type).toBe('fill-extrusion')
  })

  it('are drawn above the flat buildings', () => {
    expect(layer(`${BUILDINGS_LAYER}_3d`).zorder).toBeGreaterThan(layer(BUILDINGS_LAYER).zorder ?? 0)
  })
})

/** A map that keeps what was set on it. */
function fakeMap() {
  const paint: Record<string, unknown> = {}
  const filters: Record<string, unknown> = {}
  const map = {
    getLayer: () => ({}),
    setPaintProperty: (id: string, property: string, value: unknown) => (paint[`${id} ${property}`] = value),
    setFilter: (id: string, filter: unknown) => (filters[id] = filter),
    on: () => undefined
  }
  return { map, paint, filters }
}

describe('the look follows the background and the 3D view', () => {
  beforeEach(() => {
    background.offerImagery({ maxzoom: 17, covers: async () => true })
    background.choose('contrast')
    view3d.set(false)
  })

  it('over the map: no roofs, no shadows, outlines, nothing raised', () => {
    const { map, paint, filters } = fakeMap()
    followLook(map as never)
    expect(paint[`${BUILDINGS_LAYER}_hit fill-opacity`]).toBe(0)
    expect(paint[`${BUILDINGS_LAYER}_shadow fill-opacity`]).toBe(0)
    expect(paint[`${BUILDINGS_LAYER} line-opacity`]).toBe(OUTLINE_OPACITY)
    expect(filters[`${PARTS_LAYER}_3d`]).toEqual(['boolean', false])
    expect(filters[`${BUILDINGS_LAYER}_3d`]).toEqual(['boolean', false])
  })

  it('over imagery: roofs and shadows', () => {
    const { map, paint } = fakeMap()
    followLook(map as never)
    background.choose('satellite')
    expect(paint[`${BUILDINGS_LAYER}_hit fill-opacity`]).toBe(ROOF_OPACITY)
    expect(paint[`${ZOOMED_OUT_LAYER}_shadow fill-opacity`]).toBe(SHADOW_OPACITY)
  })

  it('in 3D: raised instead, with no flat roofs, shadows or outlines under them', () => {
    const { map, paint, filters } = fakeMap()
    followLook(map as never)
    background.choose('satellite')
    view3d.set(true)
    expect(filters[`${BUILDINGS_LAYER}_3d`]).toEqual(['==', ['get', 'kind'], 'building'])
    expect(filters[`${ZOOMED_OUT_LAYER}_3d`]).toBeNull()
    expect(paint[`${BUILDINGS_LAYER}_hit fill-opacity`]).toBe(0)
    expect(paint[`${BUILDINGS_LAYER}_shadow fill-opacity`]).toBe(0)
    expect(paint[`${BUILDINGS_LAYER} line-opacity`]).toBe(0)
  })
})
