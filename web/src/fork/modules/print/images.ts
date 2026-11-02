// Fork: the pictures in a printed map: the map itself, drawn again sharper, and
// symbols (SVG) as PNG, which jsPDF needs.
import type { Map } from 'maplibre-gl'

export interface Picture {
  url: string
  width: number
  height: number
}

export /** The map as an image, drawn again at `ratio` times the screen's pixels. */
async function capture(map: Map, ratio: number): Promise<Picture> {
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
