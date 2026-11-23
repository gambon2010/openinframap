// Fork: each identity as a small frame of its shape and colour (MIL-STD-2525C):
// friends a rectangle, hostiles a diamond, neutrals a square, the unknown a
// four-lobed frame, filled with the standard's light colours. For My layers' identity
// choices (the card, several items at once, the right-click menu), where a full
// symbol would be too big and an emoji doesn't fit the app's look.
import { IDENTITY_FILLS } from '../map/scale.constants.ts'

const SVG = 'http://www.w3.org/2000/svg'
// Outlines in 24 units, as the app's line icons (ui/icons.ts).
const FRAMES = {
  friend: 'M3 6h18v12H3z',
  hostile: 'M12 2l10 10-10 10L2 12z',
  neutral: 'M4 4h16v16H4z',
  // Four lobes meeting at the corners of a square around the centre.
  unknown:
    'M8.5 8.5A4.95 4.95 0 1 1 15.5 8.5A4.95 4.95 0 1 1 15.5 15.5A4.95 4.95 0 1 1 8.5 15.5A4.95 4.95 0 1 1 8.5 8.5z'
}
const SHAPES: Record<string, keyof typeof FRAMES> = {
  F: 'friend',
  A: 'friend',
  D: 'friend',
  M: 'friend',
  H: 'hostile',
  S: 'hostile',
  J: 'hostile',
  K: 'hostile',
  N: 'neutral',
  L: 'neutral'
}

/** An identity's frame (its code, the SIDC's second letter), `size` pixels. */
export function identityIcon(code: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('aria-hidden', 'true')
  const frame = document.createElementNS(SVG, 'path')
  frame.setAttribute('d', FRAMES[SHAPES[code] ?? 'unknown'])
  frame.setAttribute('fill', IDENTITY_FILLS[code] ?? IDENTITY_FILLS.U)
  frame.setAttribute('stroke', 'currentColor')
  frame.setAttribute('stroke-width', '1.5')
  frame.setAttribute('stroke-linejoin', 'round')
  svg.append(frame)
  return svg
}
