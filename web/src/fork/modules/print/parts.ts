// Fork: the parts of a printed map's page (pdf.ts puts them together): the map with
// its frame and north, and the box over its bottom-right corner with the title,
// when and by whom, the legend, the scale and its bar, the centre and the credits.
// Millimetres; where things go: layout.ts.
import type { jsPDF } from 'jspdf'
import { formatLatLng, toMgrs } from '../../core/mgrs.ts'
import { t } from '../../core/i18n.ts'
import type { LegendSection } from '../../ui/legend.ts'
import { Box, INFO_PADDING, fit, formatScale, infoBox, scaleBar } from './layout.ts'
import { Picture, svgToPng } from './images.ts'

/** The map, filling its box, framed, with north in its top-right corner. */
export function drawMap(pdf: jsPDF, box: Box, picture: Picture, bearing: number) {
  const placed = fit(box, picture.width, picture.height)
  pdf.addImage(picture.url, 'JPEG', placed.x, placed.y, placed.w, placed.h)
  pdf.setDrawColor(0).setLineWidth(0.3).rect(placed.x, placed.y, placed.w, placed.h)
  drawNorth(pdf, placed.x + placed.w - 9, placed.y + 10, bearing)
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

export interface InfoContent {
  title: string
  /** When, and by whom. */
  byline: string
  sections: LegendSection[]
  scale: number
  centre: { lng: number; lat: number }
  credits: string
}

/** Text the PDF's built-in fonts can write (they have no ≥, ≤, −...). */
export function printable(text: string): string {
  return text
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/−/g, '-')
    .replace(/[\u2009\u202f]/g, ' ')
}

/** Points to millimetres, for line heights. */
const PT = 0.3528

/**
 * The box over the map's bottom-right corner (`width` wide, no taller than
 * `maxHeight`): what doesn't fit of the legend becomes "…and N more".
 */
export async function drawInfo(pdf: jsPDF, map: Box, width: number, maxHeight: number, content: InfoContent) {
  // The legend's pictures first (the box is laid out twice: measured, then drawn).
  const pictures = new Map<string, Picture | null>()
  for (const section of content.sections) {
    for (const entry of section.entries) {
      if (entry.svg && !pictures.has(entry.svg)) pictures.set(entry.svg, await svgToPng(entry.svg))
    }
  }
  const height = layOutInfo(pdf, { x: 0, y: 0, w: width, h: maxHeight }, maxHeight, content, pictures, false)
  const box = infoBox(map, width, height)
  pdf.setFillColor(255, 255, 255).setDrawColor(0).setLineWidth(0.3).rect(box.x, box.y, box.w, box.h, 'FD')
  layOutInfo(pdf, box, maxHeight, content, pictures, true)
}

/** The box's contents from its top (drawn, or only measured): its height. */
function layOutInfo(
  pdf: jsPDF,
  box: Box,
  maxHeight: number,
  content: InfoContent,
  pictures: Map<string, Picture | null>,
  draw: boolean
): number {
  const x = box.x + INFO_PADDING
  const w = box.w - 2 * INFO_PADDING
  let y = box.y + INFO_PADDING
  const text = (lines: string[], size: number, style: string, colour: number, at = x) => {
    pdf.setFont('helvetica', style).setFontSize(size).setTextColor(colour)
    lines = lines.map(printable)
    if (draw) pdf.text(lines, at, y + size * PT * 0.8)
    y += lines.length * size * PT * 1.2
  }
  const rule = () => {
    y += 1.2
    if (draw)
      pdf
        .setDrawColor(180)
        .setLineWidth(0.2)
        .line(x, y, x + w, y)
    y += 1.8
  }

  // The title, and when and by whom.
  pdf.setFont('helvetica', 'bold').setFontSize(11)
  text(pdf.splitTextToSize(content.title, w), 11, 'bold', 0)
  pdf.setFont('helvetica', 'normal').setFontSize(7)
  text(pdf.splitTextToSize(content.byline, w), 7, 'normal', 80)

  // What's at the bottom, measured first: the legend gets the room that's left.
  const footer = 4 + 4 + 3 * 7 * PT * 1.2 + 6 * PT * 1.2 * 3
  // (The same when drawn as when measured: the box is only as tall as it needs.)
  const legendBottom = box.y + maxHeight - INFO_PADDING - footer

  if (content.sections.length) rule()
  for (const [s, section] of content.sections.entries()) {
    const rowsLeft = () =>
      section.entries.length + content.sections.slice(s + 1).reduce((n, x) => n + x.entries.length, 0)
    if (y + 8 > legendBottom) {
      text([t('print.legend-more', '…and {{count}} more', { count: rowsLeft() })], 7, 'italic', 60)
      break
    }
    text([section.title], 8, 'bold', 0)
    pdf.setFont('helvetica', 'normal').setFontSize(7)
    let cut = false
    for (const [i, entry] of section.entries.entries()) {
      // No swatch (a layer's name): the text from the left.
      const indent = (entry.svg && pictures.get(entry.svg)) || entry.colour ? 9 : 0
      const lines: string[] = pdf.splitTextToSize(printable(entry.label), w - indent)
      const h = Math.max(4.2, lines.length * 7 * PT * 1.2 + 1)
      if (y + h > legendBottom) {
        const left = rowsLeft() - i
        text([t('print.legend-more', '…and {{count}} more', { count: left })], 7, 'italic', 60)
        cut = true
        break
      }
      const mid = y + h / 2
      if (draw) {
        const png = entry.svg ? pictures.get(entry.svg) : null
        if (png) {
          const size = fit({ x, y: mid - 2.5, w: 7, h: 5 }, png.width, png.height)
          pdf.addImage(png.url, 'PNG', size.x, size.y, size.w, size.h)
        } else if (entry.colour) {
          const [r, g, b] = rgb(entry.colour)
          pdf.setDrawColor(r, g, b).setFillColor(r, g, b)
          if (entry.shape === 'line') pdf.setLineWidth(0.9).line(x, mid, x + 7, mid)
          else if (entry.shape === 'dot') pdf.circle(x + 3.5, mid, 1.4, 'F')
          else pdf.setLineWidth(0.4).rect(x, mid - 1.8, 7, 3.6, 'FD')
        }
        pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(30)
        pdf.text(lines, x + indent, mid - ((lines.length - 1) * 7 * PT * 1.2) / 2 + 7 * PT * 0.35)
      }
      y += h
    }
    if (cut) break
    y += 1
  }

  // The scale and its bar, the centre, the credits.
  rule()
  const bar = scaleBar(content.scale, Math.min(30, w - 22))
  pdf.setFont('helvetica', 'bold').setFontSize(8)
  if (draw) {
    pdf.setTextColor(0).text(formatScale(content.scale), x, y + 2.6)
    const barX = x + 21
    pdf.setLineWidth(0.2).setDrawColor(0)
    for (let i = 0; i < 4; i++) {
      const shade = i % 2 ? 255 : 0
      pdf.setFillColor(shade, shade, shade).rect(barX + (i * bar.mm) / 4, y + 0.6, bar.mm / 4, 1.4, 'FD')
    }
    pdf.setFont('helvetica', 'normal').setFontSize(6)
    pdf.text('0', barX, y + 4.6, { align: 'center' })
    const label = bar.metres >= 1000 ? `${bar.metres / 1000} km` : `${bar.metres} m`
    pdf.text(label, barX + bar.mm, y + 4.6, { align: 'center' })
  }
  y += 6
  // The written scale holds only printed at actual size ("fit to page" shrinks it;
  // the bar shrinks with the map and stays true).
  text([t('print.actual-size', 'Print at actual size (100 %) for this scale')], 6, 'italic', 90)
  const mgrs = toMgrs(content.centre.lng, content.centre.lat)
  text(
    [
      t('print.centre', 'Centre: {{position}}', {
        position: formatLatLng(content.centre.lng, content.centre.lat)
      }),
      ...(mgrs ? [`MGRS ${mgrs}`] : [])
    ],
    7,
    'normal',
    0
  )
  if (content.credits) {
    pdf.setFont('helvetica', 'normal').setFontSize(6)
    text(pdf.splitTextToSize(content.credits, w), 6, 'normal', 90)
  }
  return y - box.y + INFO_PADDING
}
