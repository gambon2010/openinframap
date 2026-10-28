// Fork: the images "My layers" draws, added to the map before any feature uses
// them (upstream's SymbolLoader would report unknown ones as missing icons):
// - milsym:<code>: a MIL-STD-2525C symbol, drawn by @syncpoint/signs (MIT), the
//   library ODINv2 uses. It's big (3.5 MB), so it's only loaded when needed.
// - userimg:<id>: a picture uploaded to the backend.
// - user-marker:<colour>: a plain pin.
import { Map } from 'maplibre-gl'
import { imageUrl } from './api.ts'
import { FeatureProps } from './model.ts'

type Signs = typeof import('@syncpoint/signs')
let signs: Promise<Signs> | undefined

const loading = new globalThis.Map<string, Promise<void>>()
const ratio = Math.min(Math.round(window.devicePixelRatio || 1), 2)

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
async function symbolImage(sidc: string): Promise<ImageData> {
  const { Symbol } = await (signs ??= import('@syncpoint/signs'))
  const symbol = new Symbol(sidc, { size: 30 })
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
async function pictureImage(id: string): Promise<{ image: HTMLImageElement; pixelRatio: number }> {
  const image = await loadImage(imageUrl(id))
  return { image, pixelRatio: Math.max(image.naturalWidth / 64, 0.1) }
}

function markerImage(color: string): ImageData {
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

/** The image name a point feature is drawn with. */
export function iconName(p: FeatureProps, layerColor: string): string | null {
  if (p.kind === 'symbol' && p.sidc) return `milsym:${p.sidc}`
  if (p.kind === 'image' && p.image) return `userimg:${p.image}`
  if (p.kind === 'marker') return `user-marker:${p.color ?? layerColor}`
  return null
}

/** Add an image to the map if it isn't there yet (once, however often it's asked for). */
export function ensureImage(map: Map, name: string): Promise<void> {
  if (map.hasImage(name)) return Promise.resolve()
  let promise = loading.get(name)
  if (!promise) {
    promise = ensureImageNow(map, name).finally(() => loading.delete(name))
    loading.set(name, promise)
  }
  return promise
}

async function ensureImageNow(map: Map, name: string) {
  const [type, ...rest] = name.split(':')
  const value = rest.join(':')
  try {
    if (type === 'milsym') {
      const data = await symbolImage(value)
      if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio: ratio })
    } else if (type === 'userimg') {
      const { image, pixelRatio } = await pictureImage(value)
      if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio })
    } else if (type === 'user-marker') {
      if (!map.hasImage(name)) map.addImage(name, markerImage(value), { pixelRatio: ratio })
    }
  } catch (e) {
    console.warn('My layers: could not draw', name, e)
  }
}
