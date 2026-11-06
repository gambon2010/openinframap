// Fork: drawing the images of My layers' items (the kinds, kinds/, name them and
// map/icons.ts adds them to the map):
// - a MIL-STD-2525C symbol with its labels, drawn by @syncpoint/signs (MIT), the
//   library ODINv2 uses. It's big (3.5 MB), so it's only loaded when needed;
// - a picture uploaded to the backend;
// - a plain pin (marker).
import { imageUrl } from '../state/api.ts'
import { LabelLevel } from '../model/fields.types.ts'
import { readText, writeText } from '../../../core/storage.ts'

type Signs = typeof import('@syncpoint/signs')
let signs: Promise<Signs> | undefined

export const ratio = Math.min(Math.round(window.devicePixelRatio || 1), 2)

/** The symbol for a code, as an SVG string (for the palette and the popup). */
export async function symbolSvg(sidc: string, size = 30): Promise<string> {
  const { Symbol } = await (signs ??= import('@syncpoint/signs'))
  return new Symbol(sidc, { size }).asSVG()
}

/** The same synchronously, once the library is loaded (palette previews). */
export async function symbolRenderer(): Promise<(sidc: string, size?: number) => string> {
  const { Symbol } = await (signs ??= import('@syncpoint/signs'))
  return (sidc, size = 30) => new Symbol(sidc, { size }).asSVG()
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

function canvas(width: number, height: number) {
  const c = document.createElement('canvas')
  c.width = Math.ceil(width * ratio)
  c.height = Math.ceil(height * ratio)
  const ctx = c.getContext('2d')!
  ctx.scale(ratio, ratio)
  return { c, ctx }
}

/** A symbol with its anchor (e.g. the frame's centre, not counting labels) in the middle. */
export async function symbolImage(sidc: string, modifiers: Record<string, string>): Promise<ImageData> {
  const { Symbol } = await (signs ??= import('@syncpoint/signs'))
  const symbol = new Symbol(sidc, { size: 30, modifiers })
  const { width, height } = symbol.getSize()
  const anchor = symbol.getAnchor()
  const w = 2 * Math.max(anchor.x, width - anchor.x)
  const h = 2 * Math.max(anchor.y, height - anchor.y)
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(symbol.asSVG()))
  const { c, ctx } = canvas(w, h)
  ctx.drawImage(img, w / 2 - anchor.x, h / 2 - anchor.y, width, height)
  return ctx.getImageData(0, 0, c.width, c.height)
}

/** A picture, scaled so it's 64 px wide on the map at size 1. */
export async function pictureImage(id: string): Promise<{ image: HTMLImageElement; pixelRatio: number }> {
  const image = await loadImage(imageUrl(id))
  return { image, pixelRatio: Math.max(image.naturalWidth / 64, 0.1) }
}

export function markerImage(color: string): ImageData {
  const { c, ctx } = canvas(24, 34)
  ctx.beginPath()
  ctx.moveTo(12, 33)
  ctx.bezierCurveTo(12, 33, 2, 19, 2, 12)
  ctx.arc(12, 12, 10, Math.PI, 0)
  ctx.bezierCurveTo(22, 19, 12, 33, 12, 33)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(12, 12, 4, 0, 2 * Math.PI)
  ctx.fillStyle = '#fff'
  ctx.fill()
  return ctx.getImageData(0, 0, c.width, c.height)
}

/** How much of the symbols' labels the map shows (a map setting, per browser). */
let labelLevel: LabelLevel = (readText('oim-userlayers-labels') as LabelLevel) || 'name'

export function getLabelLevel(): LabelLevel {
  return labelLevel
}

export function setLabelLevel(level: LabelLevel) {
  labelLevel = level
  writeText('oim-userlayers-labels', level)
}

/** The image name of a symbol: its code, and the labels drawn with it (sorted). */
export function symbolImageName(sidc: string, modifiers: Record<string, string>): string {
  const keys = Object.keys(modifiers).sort()
  if (!keys.length) return `milsym:${sidc}`
  return `milsym:${sidc}|${JSON.stringify(Object.fromEntries(keys.map((k) => [k, modifiers[k]])))}`
}
