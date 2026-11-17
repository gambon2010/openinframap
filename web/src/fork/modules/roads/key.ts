// Fork: the key's rows for the bold roads, railways, trams and metro: each section
// takes its Data layers entry's name, so it unfolds under that entry (ui/data-layers.ts),
// each kind with its tick box hiding its layers (by their ids' start). Sidings, yards
// and depots start hidden: rarely wanted, and they clutter towns and stations.
import { svg } from 'redom'
import { t } from '../../core/i18n.ts'
import type { KeyRow, KeySection } from '../../types.ts'
import { ROAD_KINDS, roadKindPrefixes } from './layers.ts'
import {
  RAILWAY_SETS,
  TRANSIT_SETS,
  type TrackSet,
  railwaySetPrefix,
  transitSetPrefix
} from './rail-layers.ts'
import * as look from './roads.constants.ts'

/** A road's or a track's swatch: its line on its edge. */
function lineSwatch(colour: string, edge: string, dashes = ''): SVGElement {
  const line = (stroke: string, width: number, dash = '') =>
    svg('line', { x1: 0, y1: 8, x2: 30, y2: 8, stroke, 'stroke-width': width, 'stroke-dasharray': dash })
  return svg('svg', { width: 30, height: 16 }, line(edge, 6), line(colour, 4, dashes))
}

/** The roads' layers of these kinds (ROAD_KINDS' names). */
function roadsOf(...names: string[]) {
  const kinds = ROAD_KINDS.filter((road) => names.includes(road.name))
  return { layers: kinds.flatMap(roadKindPrefixes) }
}

function roadRows(): KeyRow[] {
  const road = (label: string, colour: string, names: string[], dashes = ''): KeyRow => [
    label,
    lineSwatch(colour, look.EDGE_COLOUR.bold, dashes),
    roadsOf(...names)
  ]
  return [
    road(t('roads.motorways', 'Motorways'), look.HIGHWAY_COLOUR.bold, ['highway']),
    road(t('roads.trunk', 'Trunk roads (voies express)'), look.TRUNK_COLOUR.bold, ['trunk']),
    road(t('roads.primary', 'Main roads'), look.MAJOR_COLOUR.bold, ['major']),
    road(t('roads.secondary', 'Secondary roads'), look.SECONDARY_COLOUR.bold, ['secondary']),
    road(t('roads.tertiary', 'Tertiary roads'), look.TERTIARY_COLOUR.bold, ['tertiary']),
    road(t('roads.links', 'Slip roads'), look.MAJOR_COLOUR.bold, ['links']),
    road(t('roads.small', 'Small roads'), look.MINOR_COLOUR.bold, ['minor', 'service']),
    road(t('roads.paths', 'Paths and tracks'), look.PATH_COLOUR.bold, ['paths'], '3 1')
  ]
}

/** A set of tracks' row; sidings hidden at first. */
function trackRow(label: string, swatch: SVGElement, set: TrackSet, prefix: string): KeyRow {
  const hide = { layers: [prefix] }
  return set.name === 'sidings' ? [label, swatch, hide, { hiddenAtFirst: true }] : [label, swatch, hide]
}

function railwayRows(): KeyRow[] {
  const labels: Record<string, string> = {
    main: t('railways.main', 'Main lines'),
    branch: t('railways.branch', 'Branch lines'),
    minor: t('railways.minor', 'Other lines (industrial, heritage, narrow gauge)'),
    sidings: t('railways.sidings', 'Sidings and yards')
  }
  const swatch = () => lineSwatch(look.RAIL_COLOUR.bold, look.RAIL_EDGE_COLOUR.bold)
  // Most important first, as the key reads.
  return [...RAILWAY_SETS]
    .reverse()
    .map((set) => trackRow(labels[set.name], swatch(), set, railwaySetPrefix(set)))
}

function transitRows(): KeyRow[] {
  const labels: Record<string, string> = {
    tram: t('railways.tram', 'Trams'),
    metro: t('railways.metro', 'Metro'),
    light_rail: t('railways.light-rail', 'Light rail'),
    sidings: t('railways.depots', 'Sidings and depots')
  }
  const swatch = () => lineSwatch(look.TRAM_COLOUR.bold, look.RAIL_EDGE_COLOUR.bold)
  return [...TRANSIT_SETS]
    .reverse()
    .map((set) => trackRow(labels[set.name], swatch(), set, transitSetPrefix(set)))
}

/** The sections, each named as its Data layers entry (index.ts). */
export function roadsKey(entries: { roads: string; railways: string; transit: string }): KeySection[] {
  return [
    { title: entries.roads, rows: roadRows() },
    { title: entries.railways, rows: railwayRows() },
    { title: entries.transit, rows: transitRows() }
  ]
}
