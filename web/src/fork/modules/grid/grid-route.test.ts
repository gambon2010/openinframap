import { describe, expect, test } from 'vitest'
import { RoutePath, RouteResponse, combineRoutes, decodeStation, encodeStation } from './grid-route.ts'

describe('stations in the map link', () => {
  test('substations and plants, negative ids (relations) too', () => {
    expect(encodeStation({ kind: 'substation', osm_id: 123 })).toBe('s123')
    expect(encodeStation({ kind: 'plant', osm_id: -456 })).toBe('p-456')
    expect(decodeStation('s123')).toEqual({ kind: 'substation', osm_id: 123 })
    expect(decodeStation('p-456')).toEqual({ kind: 'plant', osm_id: -456 })
    expect(decodeStation('x1')).toBeNull()
    expect(decodeStation('')).toBeNull()
  })
})

const station = (osm_id: number, name: string) => ({ kind: 'substation' as const, osm_id, name })
const path = (
  km: number,
  kv: number[],
  stations: ReturnType<typeof station>[],
  coords: number[][]
): RoutePath => ({
  length_km: km,
  voltages_kv: kv,
  stations,
  segments: [{ from: stations[0], to: stations[stations.length - 1], length_km: km, voltages_kv: kv }],
  geometry: { type: 'MultiLineString', coordinates: [coords] }
})

describe('combineRoutes', () => {
  const a = station(1, 'A')
  const b = station(2, 'B')
  const c = station(3, 'C')
  const wind = station(4, 'Wind farm')

  test('a connection leg at lower voltage is joined to each path', () => {
    const data: RouteResponse = {
      from: wind,
      to: c,
      notices: [],
      access: [
        {
          ...path(
            10.6,
            [65],
            [wind, a],
            [
              [0, 0],
              [1, 1]
            ]
          ),
          end: 'from'
        }
      ],
      paths: [
        path(
          20,
          [220],
          [a, b, c],
          [
            [1, 1],
            [2, 2]
          ]
        ),
        path(
          30,
          [380, 220],
          [a, c],
          [
            [1, 1],
            [3, 3]
          ]
        )
      ]
    }
    const routes = combineRoutes(data)
    expect(routes).toHaveLength(2)
    expect(routes[0].length_km).toBe(30.6)
    expect(routes[0].stations.map((s) => s.name)).toEqual(['Wind farm', 'A', 'B', 'C'])
    expect(routes[0].voltages_kv).toEqual([220, 65])
    expect(routes[0].segments).toHaveLength(2)
    expect(routes[0].geometry.coordinates).toHaveLength(2)
    expect(routes[1].voltages_kv).toEqual([380, 220, 65])
  })

  test('both ends reach the grid at the same station: the legs are the route', () => {
    const data: RouteResponse = {
      from: wind,
      to: b,
      notices: [],
      access: [
        {
          ...path(
            5,
            [65],
            [wind, a],
            [
              [0, 0],
              [1, 1]
            ]
          ),
          end: 'from'
        },
        {
          ...path(
            4,
            [110],
            [a, b],
            [
              [1, 1],
              [2, 2]
            ]
          ),
          end: 'to'
        }
      ],
      paths: []
    }
    const routes = combineRoutes(data)
    expect(routes).toHaveLength(1)
    expect(routes[0].length_km).toBe(9)
    expect(routes[0].stations.map((s) => s.name)).toEqual(['Wind farm', 'A', 'B'])
  })

  test('no path and no legs: no route', () => {
    expect(combineRoutes({ from: a, to: b, notices: [], access: [], paths: [] })).toEqual([])
  })
})
