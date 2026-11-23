// Fork: routes between stations (grid-route.ts): its types.
import type { MultiLineString } from 'geojson'
import './grid-route.css'

export type StationKind = 'substation' | 'plant'

export type Station = {
  kind: StationKind
  osm_id: number
  name?: string | null
}

// A stretch between two consecutive stations; null = a junction between lines.
export type Segment = {
  from: Station | null
  to: Station | null
  length_km: number
  voltages_kv: number[]
}

export type RoutePath = {
  length_km: number
  voltages_kv: number[]
  stations: Station[]
  segments: Segment[]
  geometry: MultiLineString
}

// A station not on the ≥110 kV grid is first connected to it over lower
// voltages (e.g. a wind farm's 65 kV line to the nearest 220 kV substation).
export type AccessLeg = RoutePath & { end: 'from' | 'to' }

// What's drawn and listed: a whole route (connection legs included).
export type Route = RoutePath

export type RouteResponse = {
  from: Station
  to: Station
  notices: string[]
  access: AccessLeg[]
  paths: RoutePath[]
}
