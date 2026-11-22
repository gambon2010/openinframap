// Fork: small line icons drawn in the text's colour (currentColor), one set for
// every button that needs a picture rather than a character (docs/STYLE.md): the eye
// (shown / hidden), the map's buttons (Data layers, My layers, satellite imagery,
// print, settings, your account). 24-unit outlines, 2 wide, round ends, as Lucide's.
const SVG = 'http://www.w3.org/2000/svg'

/** A line icon from its paths (24-unit outlines), in the text's colour. */
export function icon(paths: string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: 'oim-icon'
  }))
    svg.setAttribute(name, value)
  for (const d of paths) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

/** An open eye (shown), or a closed one, crossed out (hidden). */
export function eyeIcon(open: boolean): SVGSVGElement {
  return open
    ? icon(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'])
    : icon([
        'M3 3l18 18',
        'M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5',
        'M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6',
        'M9.9 9.9a3 3 0 0 0 4.2 4.2'
      ])
}

/** A gear: settings. */
export function gearIcon(size = 20): SVGSVGElement {
  return icon(
    [
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'
    ],
    size
  )
}

/** A person: your account. */
export function personIcon(size = 20): SVGSVGElement {
  return icon(['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'], size)
}

/** A printer: print the map. */
export function printerIcon(size = 20): SVGSVGElement {
  return icon(
    [
      'M6 9V2h12v7',
      'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2',
      'M6 14h12v8H6z'
    ],
    size
  )
}

/** A stack of sheets: Data layers. */
export function layersIcon(size = 20): SVGSVGElement {
  return icon(['M12 2 2 7l10 5 10-5-10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'], size)
}

/** A pencil: My layers, what you draw. */
export function pencilIcon(size = 20): SVGSVGElement {
  return icon(
    [
      'M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z',
      'm15 5 4 4'
    ],
    size
  )
}

/** A satellite: satellite imagery under the map's data. */
export function satelliteIcon(size = 20): SVGSVGElement {
  return icon(
    ['M13 7 9 3 5 7l4 4', 'm17 11 4 4-4 4-4-4', 'm8 12 4 4 6-6-4-4z', 'm16 8 3-3', 'M9 21a6 6 0 0 0-6-6'],
    size
  )
}
