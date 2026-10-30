// Fork: pictures people put on the map, made ready for the backend: at most
// MAX_IMAGE_SIZE on their longest side, as WebP (keeps transparency, small).

// Pictures are kept this big (longest side): enough to stay sharp at the largest
// size on the map (8×64 px, on a high-density screen).
export const MAX_IMAGE_SIZE = 1024

/** How much to scale a picture: down to MAX_IMAGE_SIZE; vector images (SVG) up to it too. */
export function imageScale(width: number, height: number, vector: boolean): number {
  const longest = Math.max(width, height, 1)
  return vector ? MAX_IMAGE_SIZE / longest : Math.min(1, MAX_IMAGE_SIZE / longest)
}

/** A picture, at most 1024 px, as WebP (keeps transparency, small) in base64 for the backend. */
export async function prepareImage(file: File): Promise<{ mime: string; data: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = imageScale(img.naturalWidth, img.naturalHeight, file.type === 'image/svg+xml')
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let dataUrl = canvas.toDataURL('image/webp', 0.9)
    // Browsers without WebP encoding give PNG back.
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png')
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
    return { mime, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  } finally {
    URL.revokeObjectURL(url)
  }
}
