// Fork: My layers' icons, drawn as the app's other line icons (ui/icons.ts: 24-unit
// outlines, 2 wide, round ends): the toolbar's (each tool a picture of what it makes,
// the symbol tool a friendly infantry frame, the graphic tool an attack arrow), the
// list's pictures of items (kinds/), the padlock.
import { icon } from '../../../ui/icons.ts'

const PATHS: Record<string, string[]> = {
  select: ['M5 3l6.5 17 2.6-7.4L21.5 10z'],
  // A friendly infantry unit: its rectangle and cross.
  symbol: ['M3 6h18v12H3z', 'M3 6l18 12', 'M21 6L3 18'],
  // An attack arrow bending towards its objective.
  graphic: ['M4 20c3-7 7-11 15-13', 'M14 4l5 3-3 5'],
  line: ['M5 19L19 5', 'M5 19h.01', 'M19 5h.01'],
  area: ['M4 8l7-5 9 4-2 12-11 1z'],
  marker: [
    'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z',
    'M12 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'
  ],
  image: ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M15.5 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2z'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  'measure-distance': ['M3 17L17 3l4 4L7 21z', 'M7.5 12.5l2 2', 'M10.5 9.5l2 2', 'M13.5 6.5l2 2'],
  'measure-area': ['M4 4h16v16H4z', 'M4 9h3', 'M17 4v3', 'M20 15h-3', 'M7 20v-3'],
  'measure-rings': [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 12h.01'
  ],
  'measure-sight': ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  undo: ['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h3'],
  history: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
  // Where new items go: the list's "you draw here" pencil.
  into: ['M15 4l5 5L9 20H4v-5z'],
  building: ['M3 21h18', 'M5 21V9l7-5 7 5v12', 'M10 21v-6h4v6'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.9-1']
}

/** A tool's (or a toolbar button's) icon by its id. */
export function toolIcon(id: string, size = 18): SVGSVGElement {
  return icon(PATHS[id] ?? PATHS.select, size)
}
