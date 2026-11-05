// Fork: a printed map's page, worked out (pure): paper sizes, where the map and the
// box with the title, legend and scale go, what part of the screen is printed, the
// scale and its bar. Millimetres on paper, CSS pixels on screen.
export type Paper = 'a4' | 'a3'
export type Orientation = 'landscape' | 'portrait'

const PAPERS: Record<Paper, [number, number]> = { a4: [297, 210], a3: [420, 297] }

/** What printers leave blank at the paper's edges: lasers about 4 mm, inkjets 3-5;
 * a quarter inch is what nearly all can print to, so printed at actual size
 * (100 %, which the written scale needs) nothing is cut off. */
export const MARGIN = 6.35
/** The box's padding, and its distance from the map's frame. */
export const INFO_PADDING = 3
/** The printed area's distance from the edges of the map on screen (CSS px). */
export const FRAME_INSET = 16
/** How sharp the printed map is (dots per inch). */
export const PRINT_DPI = 300

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The page's size, landscape or portrait. */
export function pageSize(paper: Paper, orientation: Orientation): { w: number; h: number } {
  const [long, short] = PAPERS[paper]
  return orientation === 'landscape' ? { w: long, h: short } : { w: short, h: long }
}

/** The map: the whole page but the printers' margins. */
export function mapBox(page: { w: number; h: number }): Box {
  return { x: MARGIN, y: MARGIN, w: page.w - 2 * MARGIN, h: page.h - 2 * MARGIN }
}

/** The width of the box over the map's corner: about a fifth of the page, 55-75 mm. */
export function infoWidth(page: { w: number; h: number }): number {
  return Math.round(Math.min(75, Math.max(55, page.w * 0.2)))
}

/** The box over the map's bottom-right corner, `height` tall. */
export function infoBox(map: Box, width: number, height: number): Box {
  return { x: map.x + map.w - width, y: map.y + map.h - height, w: width, h: height }
}

/** An image fitted in a box, keeping its shape, centred. */
export function fit(box: Box, width: number, height: number): Box {
  const scale = Math.min(box.w / width, box.h / height)
  const w = width * scale
  const h = height * scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

/** What's printed of the map on screen (`width` × `height` CSS px): the biggest
 * area of the paper's map's shape that fits, a little in from the edges, centred. */
export function printedArea(width: number, height: number, map: Box): Box {
  const inner = { x: FRAME_INSET, y: FRAME_INSET, w: width - 2 * FRAME_INSET, h: height - 2 * FRAME_INSET }
  const area = fit(inner, map.w, map.h)
  return { x: Math.round(area.x), y: Math.round(area.y), w: Math.round(area.w), h: Math.round(area.h) }
}

/**
 * How many times the screen's pixels to draw the map at, for the printed area to
 * reach `dpi` on paper: limited so the whole drawing stays under `maxSide` pixels
 * a side (what the graphics card can draw), and at least 1.
 */
export function printRatio(
  area: Box,
  screen: { w: number; h: number },
  map: Box,
  maxSide: number,
  dpi = PRINT_DPI
): number {
  const wanted = ((map.w / 25.4) * dpi) / area.w
  const most = maxSide / Math.max(screen.w, screen.h)
  return Math.max(1, Math.min(wanted, most))
}

/** Metres per screen pixel at a latitude and zoom (512-pixel tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** The scale on paper (1:N) of a map `pixels` wide printed `mm` wide. */
export function scaleOf(lat: number, zoom: number, pixels: number, mm: number): number {
  return (metresPerPixel(lat, zoom) * pixels * 1000) / mm
}

/** "1:25 000", rounded to 2 significant figures. */
export function formatScale(n: number): string {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1)
  const rounded = Math.round(n / magnitude) * magnitude
  return `1:${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

/** A scale bar no longer than `maxMm`: a round length (1, 2 or 5 × 10ⁿ m) and its length on paper. */
export function scaleBar(scale: number, maxMm: number): { metres: number; mm: number } {
  const maxMetres = (maxMm * scale) / 1000
  const power = 10 ** Math.floor(Math.log10(maxMetres))
  const metres = [5, 2, 1].map((f) => f * power).find((m) => m <= maxMetres) ?? power
  return { metres, mm: (metres * 1000) / scale }
}
