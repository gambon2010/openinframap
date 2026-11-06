import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { jsPDF } from 'jspdf'
import { FONT, addFonts, base64 } from './fonts.ts'
import en from '../../locales/en.json'
import catalogue from '../userlayers/model/symbols-2525c.json'

// The tests run from web/.
const file = (name: string) => readFileSync(resolve('src/fork/modules/print/fonts', name))

/** Every string in a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

async function pdfWithFonts() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = url.includes('Bold')
        ? 'DejaVuSans-Bold'
        : url.includes('Oblique')
          ? 'DejaVuSans-Oblique'
          : 'DejaVuSans'
      const bytes = file(`${name}.ttf`)
      return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    })
  )
  const pdf = new jsPDF({ unit: 'mm' })
  await addFonts(pdf)
  vi.unstubAllGlobals()
  return pdf
}

describe("the PDF's font", () => {
  test('base64 of the bytes', () => {
    expect(base64(new TextEncoder().encode('Dejavu').buffer)).toBe(btoa('Dejavu'))
  })

  test('embedded: normal, bold and italic', async () => {
    const pdf = await pdfWithFonts()
    expect(pdf.getFontList()[FONT]).toEqual(expect.arrayContaining(['normal', 'bold', 'italic']))
    pdf.setFont(FONT, 'normal')
    pdf.text('≥ 220 kV · −5 · cœur · Жуковский → ⚠', 10, 10)
    expect(pdf.output()).toContain('DejaVuSans')
  })

  test('has every character the app writes (its strings, the symbols, ≥ ≤ → from the key)', async () => {
    const pdf = await pdfWithFonts()
    pdf.setFont(FONT, 'normal')
    const font = (
      pdf as unknown as {
        getFont(): { metadata: { cmap: { unicode: { codeMap: Record<number, number> } } } }
      }
    ).getFont()
    const has = font.metadata.cmap.unicode.codeMap
    const texts = [...strings(en), ...strings(catalogue), '≥≤→']
    // Emoji (🔒 on buttons) are drawn by the system's emoji font on screen; they aren't printed.
    const emoji = /\p{Extended_Pictographic}/u
    const missing = new Set(
      [...texts.join('')].filter((c) => c >= ' ' && !emoji.test(c) && !has[c.codePointAt(0)!])
    )
    expect([...missing].join('')).toBe('')
  })
})
