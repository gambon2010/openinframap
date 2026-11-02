// Fork: a printed map as a PDF (jsPDF, loaded only when used): the title, when and
// by whom, the map as on screen (sharper: drawn again at twice the resolution),
// the legend (ui/legend.ts), the scale and its bar, north, the centre's position
// and grid reference, and the map's credits. The page's parts: parts.ts; where
// they go: layout.ts; the pictures: images.ts.
import type { Map } from 'maplibre-gl'
import { legendSections } from '../../ui/legend.ts'
import { Orientation, Paper, pageLayout, pageSize, scaleOf } from './layout.ts'
import { capture } from './images.ts'
import { drawFooter, drawHeader, drawLegend, drawMap } from './parts.ts'

export interface PrintOptions {
  title: string
  paper: Paper
  orientation: Orientation
  legend: boolean
  author: string
}

/** Make the PDF of the map as it is now, and download it. */
export async function printMap(map: Map, options: PrintOptions) {
  const [{ jsPDF }, picture, sections] = await Promise.all([
    import('jspdf'),
    capture(map, Math.max(2, window.devicePixelRatio)),
    options.legend ? legendSections(map) : Promise.resolve([])
  ])
  const page = pageSize(options.paper, options.orientation)
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'mm', format: options.paper })
  const layout = pageLayout(page, sections.length > 0)
  const now = new Date()

  drawHeader(pdf, page, options.title, options.author, now)
  const placed = drawMap(pdf, layout.map, picture, map.getBearing())
  if (layout.legend) await drawLegend(pdf, layout.legend, sections)
  const centre = map.getCenter()
  drawFooter(pdf, page, {
    scale: scaleOf(centre.lat, map.getZoom(), map.getCanvas().clientWidth, placed.w),
    centre,
    credits: document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent?.trim() ?? ''
  })

  const stamp = now.toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')
  pdf.save(`${options.title.replace(/[\\/:*?"<>|]+/g, '_')} ${stamp}.pdf`)
}
