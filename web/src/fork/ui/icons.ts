// Fork: small line icons drawn in the text's colour (currentColor), for buttons
// that need a picture rather than a character: the eye (shown / hidden).
const SVG = 'http://www.w3.org/2000/svg'

function icon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: '16',
    height: '16',
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
