// Fork: a printed map as a PDF (jsPDF, loaded only when used): the title, when and
// by whom, the map as on screen (sharper: drawn again at twice the resolution),
// the legend (ui/legend.ts), the scale and its bar, north, the centre's position
// and grid reference, and the map's credits.
import type { Map } from 'maplibre-gl'
import type { jsPDF } from 'jspdf'
import { formatLatLng, toMgrs } from '../../core/mgrs.ts'
import { t } from '../../core/i18n.ts'
import { LegendSection, legendSections } from '../../ui/legend.ts'
import {
  Box,
  FOOTER,
  MARGIN,
  Orientation,
  Paper,
  fit,
  formatScale,
  pageLayout,
  pageSize,
  scaleBar,
  scaleOf
} from './layout.ts'

export interface PrintOptions {
  title: string
  paper: Paper
  orientation: Orientation
  legend: boolean
  author: string
}

/** The map as an image, drawn again at `ratio` times the screen's pixels. */
async function capture(map: Map, ratio: number): Promise<{ url: string; width: number; height: number }> {
  const before = map.getPixelRatio()
  map.setPixelRatio(ratio)
  try {
    await new Promise<void>((resolve) => {
      map.once('idle', () => resolve())
      map.triggerRepaint()
    })
    // The picture is only there while a frame is being drawn.
    const url = await new Promise<string>((resolve) => {
      map.once('render', () => resolve(map.getCanvas().toDataURL('image/jpeg', 0.92)))
      map.triggerRepaint()
    })
    const canvas = map.getCanvas()
    return { url, width: canvas.width, height: canvas.height }
  } finally {
    map.setPixelRatio(before)
  }
}

/** An SVG as a PNG (jsPDF takes no SVG), with its size. */
function svgToPng(svg: string): Promise<{ url: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth * 2
      canvas.height = img.naturalHeight * 2
      const ctx = canvas.getContext('2d')
      if (!ctx || !canvas.width) return resolve(null)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve({ url: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => resolve(null)
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  })
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [120, 120, 120]
}

async function drawLegend(pdf: jsPDF, box: Box, sections: LegendSection[]) {
  let y = box.y + 4
  const bottom = box.y + box.h
  pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0)
  pdf.text(t('print.legend', 'Legend'), box.x, y)
  y += 5
  for (const [s, section] of sections.entries()) {
    if (y > bottom - 10) {
      const left = sections.slice(s).reduce((n, x) => n + x.entries.length, 0)
      pdf.setFont('helvetica', 'italic').setFontSize(8)
      pdf.text(t('print.legend-more', '…and {{count}} more', { count: left }), box.x, y)
      return
    }
    pdf.setFont('helvetica', 'bold').setFontSize(9)
    pdf.text(section.title, box.x, y + 1)
    y += 4.5
    pdf.setFont('helvetica', 'normal').setFontSize(8)
    for (const [i, entry] of section.entries.entries()) {
      const lines: string[] = pdf.splitTextToSize(entry.label, box.w - 10)
      const h = Math.max(5, lines.length * 3.4 + 1.5)
      if (y + h > bottom) {
        pdf.setFont('helvetica', 'italic')
        const left =
          section.entries.length - i + sections.slice(s + 1).reduce((n, x) => n + x.entries.length, 0)
        pdf.text(t('print.legend-more', '…and {{count}} more', { count: left }), box.x, y + 3)
        return
      }
      const mid = y + h / 2
      if (entry.svg) {
        const png = await svgToPng(entry.svg)
        if (png) {
          const size = fit({ x: box.x, y: mid - 3, w: 7, h: 6 }, png.width, png.height)
          pdf.addImage(png.url, 'PNG', size.x, size.y, size.w, size.h)
        }
      } else if (entry.colour) {
        const [r, g, b] = rgb(entry.colour)
        pdf.setDrawColor(r, g, b).setFillColor(r, g, b)
        if (entry.shape === 'line') {
          pdf.setLineWidth(0.9).line(box.x, mid, box.x + 7, mid)
        } else if (entry.shape === 'dot') {
          pdf.circle(box.x + 3.5, mid, 1.5, 'F')
        } else {
          pdf.setLineWidth(0.4).rect(box.x, mid - 2, 7, 4, 'FD')
        }
      }
      pdf.setTextColor(30)
      pdf.text(lines, box.x + 9, y + 3.2)
      y += h
    }
    y += 2.5
  }
}

/** North, as the map is turned. */
function drawNorth(pdf: jsPDF, x: number, y: number, bearing: number) {
  const a = (-bearing * Math.PI) / 180
  const point = (dx: number, dy: number): [number, number] => [
    x + dx * Math.cos(a) - dy * Math.sin(a),
    y + dx * Math.sin(a) + dy * Math.cos(a)
  ]
  const [tx, ty] = point(0, -5)
  const [lx, ly] = point(-2.2, 3)
  const [rx, ry] = point(2.2, 3)
  pdf.setFillColor(255, 255, 255).setDrawColor(0).setLineWidth(0.3)
  pdf.circle(x, y, 6.5, 'FD')
  pdf.setFillColor(0, 0, 0).triangle(tx, ty, lx, ly, x, y, 'F')
  pdf.setFillColor(255, 255, 255).triangle(tx, ty, rx, ry, x, y, 'FD')
  pdf.setFont('helvetica', 'bold').setFontSize(7).setTextColor(0)
  const [nx, ny] = point(0, -7.8)
  pdf.text('N', nx, ny + 1, { align: 'center' })
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

  // Header: the title; when, by whom.
  const now = new Date()
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(0)
  pdf.text(options.title, MARGIN, MARGIN + 6, { maxWidth: page.w - 2 * MARGIN - 70 })
  pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60)
  const when = now.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
  pdf.text(options.author ? `${when} · ${options.author}` : when, page.w - MARGIN, MARGIN + 6, {
    align: 'right'
  })

  // The map, with a frame and north.
  const placed = fit(layout.map, picture.width, picture.height)
  pdf.addImage(picture.url, 'JPEG', placed.x, placed.y, placed.w, placed.h)
  pdf.setDrawColor(0).setLineWidth(0.3).rect(placed.x, placed.y, placed.w, placed.h)
  drawNorth(pdf, placed.x + placed.w - 9, placed.y + 10, map.getBearing())

  if (layout.legend && sections.length) await drawLegend(pdf, layout.legend, sections)

  // Footer: the scale and its bar, the centre, the credits.
  const centre = map.getCenter()
  const cssWidth = map.getCanvas().clientWidth
  const scale = scaleOf(centre.lat, map.getZoom(), cssWidth, placed.w)
  const bar = scaleBar(scale, 40)
  const y = page.h - MARGIN - FOOTER + 5
  pdf.setFont('helvetica', 'bold').setFontSize(9).setTextColor(0)
  pdf.text(formatScale(scale), MARGIN, y)
  const barX = MARGIN + 25
  pdf.setLineWidth(0.3).setDrawColor(0)
  for (let i = 0; i < 4; i++) {
    const shade = i % 2 ? 255 : 0
    pdf.setFillColor(shade, shade, shade).rect(barX + (i * bar.mm) / 4, y - 2.5, bar.mm / 4, 1.8, 'FD')
  }
  pdf.setFont('helvetica', 'normal').setFontSize(8)
  pdf.text('0', barX, y + 2.5, { align: 'center' })
  const label = bar.metres >= 1000 ? `${bar.metres / 1000} km` : `${bar.metres} m`
  pdf.text(label, barX + bar.mm, y + 2.5, { align: 'center' })
  const mgrs = toMgrs(centre.lng, centre.lat)
  pdf.text(
    t('print.centre', 'Centre: {{position}}', {
      position: formatLatLng(centre.lng, centre.lat) + (mgrs ? ` · MGRS ${mgrs}` : '')
    }),
    page.w - MARGIN,
    y,
    { align: 'right' }
  )
  const credits = document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent?.trim() ?? ''
  pdf.setFontSize(7).setTextColor(90)
  pdf.text(credits, page.w - MARGIN, y + 4.5, { align: 'right', maxWidth: page.w - 2 * MARGIN - 80 })

  const stamp = now.toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')
  pdf.save(`${options.title.replace(/[\\/:*?"<>|]+/g, '_')} ${stamp}.pdf`)
}
