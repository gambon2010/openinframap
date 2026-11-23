// Fork: the pictures in a printed map: the printed part of the map, drawn again
// sharper, and symbols (SVG) as PNG, which jsPDF needs.
import type { Map } from 'maplibre-gl'
import type { Box } from './layout.ts'

export interface Picture {
  url: string
  width: number
  height: number
}

/** The most pixels a side the graphics card can draw (8192 if it doesn't say). */
export function maxCanvasSide(map: Map): number {
  const gl = map.painter?.context?.gl as WebGLRenderingContext | undefined
  const most = gl
    ? Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE))
    : 0
  // Some room below the limit: memory, and cards that claim more than they draw.
  return Math.min(most || 8192, 8192)
}

/** A part of the map (`area`, CSS px), drawn again at `ratio` times the screen's pixels. */
export async function capture(map: Map, area: Box, ratio: number): Promise<Picture> {
  const before = map.getPixelRatio()
  map.setPixelRatio(ratio)
  try {
    await new Promise<void>((resolve) => {
      map.once('idle', () => resolve())
      map.triggerRepaint()
    })
    // The picture is only there while a frame is being drawn: taken then, whole
    // (toDataURL: drawImage straight from the map's WebGL canvas swaps red and blue
    // with some graphics drivers: blue symbols came out yellow), then cropped.
    const whole = await new Promise<{ url: string; k: number }>((resolve) => {
      map.once('render', () => {
        const source = map.getCanvas()
        resolve({ url: source.toDataURL('image/png'), k: source.width / source.clientWidth })
      })
      map.triggerRepaint()
    })
    const image = new Image()
    image.src = whole.url
    await image.decode()
    const k = whole.k
    const out = document.createElement('canvas')
    out.width = Math.round(area.w * k)
    out.height = Math.round(area.h * k)
    out
      .getContext('2d')!
      .drawImage(image, area.x * k, area.y * k, out.width, out.height, 0, 0, out.width, out.height)
    return { url: out.toDataURL('image/jpeg', 0.92), width: out.width, height: out.height }
  } finally {
    map.setPixelRatio(before)
  }
}

export /** An SVG as a PNG (jsPDF takes no SVG), with its size. */
function svgToPng(svg: string): Promise<Picture | null> {
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
