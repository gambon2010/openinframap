// Fork: the symbol and graphic picker (palette.ts): its constants and tables.
import type { Category } from './palette.types.ts'

export const AFFILIATIONS: [string, string][] = [
  ['F', 'Friend'],
  ['H', 'Hostile'],
  ['N', 'Neutral'],
  ['U', 'Unknown']
]

export const MAX_RESULTS = 150

export const GEOMETRY_LABELS: Record<string, [string, string]> = {
  L: ['╱', 'Line'],
  A: ['▱', 'Area'],
  M: ['➚', 'Shape from points']
}

export const GRAPHIC_GROUPS = [
  'Tasks',
  'Command, control and manoeuvre',
  'Mobility and survivability',
  'Fire support',
  'Combat service support',
  'Other graphics'
]

export const ARROW = /attack|axis|direction|advance|counterattack/i

export const CATEGORIES: Category[] = [
  { mode: 'symbols', label: 'Units', groups: ['Ground units', 'Special operations forces'] },
  { mode: 'symbols', label: 'Equipment and vehicles', groups: ['Ground equipment'] },
  { mode: 'symbols', label: 'Installations', groups: ['Installations'] },
  { mode: 'symbols', label: 'Incidents and emergencies', groups: ['Emergency management'] },
  { mode: 'symbols', label: 'Points on the map', groups: GRAPHIC_GROUPS },
  { mode: 'symbols', label: 'Air', groups: ['Air'] },
  { mode: 'symbols', label: 'Sea', groups: ['Sea surface', 'Subsurface'] },
  { mode: 'symbols', label: 'Space', groups: ['Space'] },
  { mode: 'symbols', label: 'Intelligence', groups: ['Signals intelligence'] },
  { mode: 'symbols', label: 'Civil and stability', groups: ['Stability operations'] },
  { mode: 'graphics', label: 'Arrows', groups: GRAPHIC_GROUPS, test: (e) => ARROW.test(e[1]) },
  { mode: 'graphics', label: 'Tasks', groups: ['Tasks'] },
  {
    mode: 'graphics',
    label: 'Lines',
    groups: ['Command, control and manoeuvre', 'Other graphics'],
    test: (e) => e[3] === 'L' && !ARROW.test(e[1])
  },
  {
    mode: 'graphics',
    label: 'Areas',
    groups: ['Command, control and manoeuvre', 'Other graphics'],
    test: (e) => e[3] === 'A'
  },
  {
    mode: 'graphics',
    label: 'Shapes',
    groups: ['Command, control and manoeuvre', 'Other graphics'],
    test: (e) => e[3] === 'M' && !ARROW.test(e[1])
  },
  { mode: 'graphics', label: 'Obstacles', groups: ['Mobility and survivability'] },
  { mode: 'graphics', label: 'Fire support', groups: ['Fire support'] },
  { mode: 'graphics', label: 'Logistics', groups: ['Combat service support'] }
]
