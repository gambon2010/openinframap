// Fork: the parts of a printed map's page (pdf.ts puts them together): the header,
// the map with its frame and north, the legend, the footer (scale, bar, centre,
// credits). Millimetres; where things go: layout.ts.
import type { jsPDF } from 'jspdf'
import { formatLatLng, toMgrs } from '../../core/mgrs.ts'
import { t } from '../../core/i18n.ts'
import type { LegendSection } from '../../ui/legend.ts'
import { Box, FOOTER, MARGIN, fit, formatScale, scaleBar } from './layout.ts'
import { Picture, svgToPng } from './images.ts'

type Page = { w: number; h: number }

/** The title on the left; when and by whom on the right. */
export function drawHeader(pdf: jsPDF, page: Page, title: string, author: string, now: Date) {
  pdf.setFont('helvetica', 'bold').setFontSize(16).setTextColor(0)
  pdf.text(title, MARGIN, MARGIN + 6, { maxWidth: page.w - 2 * MARGIN - 70 })
  pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60)
  const when = now.toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
  pdf.text(author ? `${when} · ${author}` : when, page.w - MARGIN, MARGIN + 6, { align: 'right' })
}

/** The map, fitted in its box, framed, with north: where it went. */
export function drawMap(pdf: jsPDF, box: Box, picture: Picture, bearing: number): Box {
  const placed = fit(box, picture.width, picture.height)
  pdf.addImage(picture.url, 'JPEG', placed.x, placed.y, placed.w, placed.h)
  pdf.setDrawColor(0).setLineWidth(0.3).rect(placed.x, placed.y, placed.w, placed.h)
  drawNorth(pdf, placed.x + placed.w - 9, placed.y + 10, bearing)
  return placed
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

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [120, 120, 120]
}

/** The legend in its column; what doesn't fit: "…and N more". */
export async function drawLegend(pdf: jsPDF, box: Box, sections: LegendSection[]) {
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

/** The scale and a bar on the left; the centre and the credits on the right. */
export function drawFooter(
  pdf: jsPDF,
  page: Page,
  { scale, centre, credits }: { scale: number; centre: { lng: number; lat: number }; credits: string }
) {
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
  pdf.setFontSize(7).setTextColor(90)
  pdf.text(credits, page.w - MARGIN, y + 4.5, { align: 'right', maxWidth: page.w - 2 * MARGIN - 80 })
}
