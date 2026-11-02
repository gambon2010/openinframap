// Fork: a printed map's page, worked out (pure): paper sizes, where the map and the
// legend go, the scale and its bar. Millimetres throughout.
export type Paper = 'a4' | 'a3'
export type Orientation = 'landscape' | 'portrait'

const PAPERS: Record<Paper, [number, number]> = { a4: [297, 210], a3: [420, 297] }

export const MARGIN = 10
export const HEADER = 14
export const FOOTER = 14
export const LEGEND_WIDTH = 62

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

/** Where the map and the legend go on the page. */
export function pageLayout(
  page: { w: number; h: number },
  legend: boolean
): { map: Box; legend: Box | null } {
  const top = MARGIN + HEADER
  const h = page.h - top - FOOTER - MARGIN
  const w = page.w - 2 * MARGIN - (legend ? LEGEND_WIDTH + 5 : 0)
  return {
    map: { x: MARGIN, y: top, w, h },
    legend: legend ? { x: MARGIN + w + 5, y: top, w: LEGEND_WIDTH, h } : null
  }
}

/** An image fitted in a box, keeping its shape, centred. */
export function fit(box: Box, width: number, height: number): Box {
  const scale = Math.min(box.w / width, box.h / height)
  const w = width * scale
  const h = height * scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
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
