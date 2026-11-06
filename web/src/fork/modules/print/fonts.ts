// Fork: the PDF's font, DejaVu Sans (fonts/, free licence: fonts/LICENSE-DejaVu.txt),
// so any text prints as it is: accents, ≥ ≤ − →, œ, Greek, Cyrillic. jsPDF's
// built-in fonts only know Latin-1, and it can't switch fonts inside a text, so it's
// one font with everything the app writes (fonts.test.ts checks every string; Noto
// Sans, the map's, has no ≥ or →). Fetched when printing, from this app (offline too).
import type { jsPDF } from 'jspdf'
import regular from './fonts/DejaVuSans.ttf?url'
import bold from './fonts/DejaVuSans-Bold.ttf?url'
import italic from './fonts/DejaVuSans-Oblique.ttf?url'

export const FONT = 'DejaVuSans'

const FILES: [string, 'normal' | 'bold' | 'italic'][] = [
  [regular, 'normal'],
  [bold, 'bold'],
  [italic, 'italic']
]

/** A font file's bytes as base64 (what jsPDF takes). */
export function base64(bytes: ArrayBuffer): string {
  const array = new Uint8Array(bytes)
  let text = ''
  for (let i = 0; i < array.length; i += 0x8000) text += String.fromCharCode(...array.subarray(i, i + 0x8000))
  return btoa(text)
}

let loaded: Promise<[string, string][]> | null = null

/** Add DejaVu Sans (normal, bold, italic) to a PDF. */
export async function addFonts(pdf: jsPDF) {
  loaded ??= Promise.all(
    FILES.map(async ([url]) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`The PDF's font couldn't be loaded (${response.status})`)
      return [url, base64(await response.arrayBuffer())] as [string, string]
    })
  ).catch((e) => {
    loaded = null
    throw e
  })
  for (const [[, data], [, style]] of (await loaded).map((file, i) => [file, FILES[i]] as const)) {
    const name = `${FONT}-${style}.ttf`
    pdf.addFileToVFS(name, data)
    pdf.addFont(name, FONT, style)
  }
}
