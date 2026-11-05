// Fork: a printed map as a PDF (jsPDF, loaded only when used). The map fills the
// page but the printers' margins: the part of the screen inside the print frame
// (frame.ts), drawn again sharper; a box over its bottom-right corner has the
// title, when and by whom, the legend (ui/legend.ts), the scale and its bar, the
// centre's position and grid reference, and the map's credits. The page's parts:
// parts.ts; where they go: layout.ts; the pictures: images.ts.
import type { Map } from 'maplibre-gl'
import { legendSections } from '../../services/legend.ts'
import {
  Orientation,
  Paper,
  infoWidth,
  mapBox,
  pageSize,
  printRatio,
  printedArea,
  scaleOf
} from './layout.ts'
import { capture, maxCanvasSide } from './images.ts'
import { drawInfo, drawMap } from './parts.ts'

export interface PrintOptions {
  title: string
  paper: Paper
  orientation: Orientation
  legend: boolean
  author: string
}

/** Make the PDF of the map as it is now, and download it. */
export async function printMap(map: Map, options: PrintOptions) {
  const page = pageSize(options.paper, options.orientation)
  const box = mapBox(page)
  const canvas = map.getCanvas()
  const screen = { w: canvas.clientWidth, h: canvas.clientHeight }
  const area = printedArea(screen.w, screen.h, box)
  const ratio = printRatio(area, screen, box, maxCanvasSide(map))
  const [{ jsPDF }, picture, sections] = await Promise.all([
    import('jspdf'),
    capture(map, area, ratio),
    options.legend ? legendSections(map, area) : Promise.resolve([])
  ])
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'mm', format: options.paper })
  const now = new Date()

  drawMap(pdf, box, picture, map.getBearing())
  // The scale at the printed area's centre (where the screen's centre is).
  const centre = map.getCenter()
  const when = now.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
  await drawInfo(pdf, box, infoWidth(page), box.h * 0.7, {
    title: options.title,
    byline: options.author ? `${when} · ${options.author}` : when,
    sections,
    scale: scaleOf(centre.lat, map.getZoom(), area.w, box.w),
    centre,
    credits: document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent?.trim() ?? ''
  })

  const stamp = now.toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')
  pdf.save(`${options.title.replace(/[\\/:*?"<>|]+/g, '_')} ${stamp}.pdf`)
}
