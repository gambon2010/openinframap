// Plain labels on tactical graphics (graphic-labels.ts), through the real renderer:
// every graphic in the catalogue, in English and French.
import { beforeAll, describe, expect, test } from 'vitest'
import { SQUARE, graphicsLibrary, isAxis, mapScale, pointCount, renderGraphic } from './graphics.ts'
import { samplePoints } from './svg.ts'
import { GRAPHIC_LABELS, LabelLanguage, graphicKey, graphicName, labelOf, plainLabel } from './labels.ts'
import catalogue from '../model/symbols-2525c.json'
import tta from './tta106-sigles.json'

type Lib = Awaited<ReturnType<typeof graphicsLibrary>>
let lib: Lib

/** Each graphic with text: its key, name, and the standard's texts. */
const graphics: { key: string; sidc: string; name: string; texts: string[] }[] = []

beforeAll(async () => {
  lib = await graphicsLibrary()
  for (const group of (catalogue as { groups: { symbols: unknown[][] }[] }).groups) {
    for (const symbol of group.symbols) {
      const [code, name, , geometry] = symbol as [string, string, number, string?]
      if (!geometry) continue
      const sidc = code.replace(/\*/g, (_, i) => (i === 1 ? 'F' : 'P'))
      const count = pointCount(lib, sidc)
      if (!count) continue
      try {
        const points = samplePoints(sidc, count, isAxis(lib, sidc), SQUARE[graphicKey(sidc)])
        const pieces = renderGraphic(lib, { sidc, points, scale: mapScale(13, 0), language: null })
        const texts = pieces.filter((p) => p.properties?.label).map((p) => String(p.properties!.label))
        if (texts.length) graphics.push({ key: graphicKey(sidc), sidc, name, texts })
      } catch {
        // Not drawable: no label.
      }
    }
  }
}, 120_000)

// Graphics that are the same thing, and may share a label.
const SAME = [
  ['G*G*PM', 'G*G*PY'], // decoy mined area, fenced or not
  ['G*F*ATS', 'G*F*LTS'], // smoke, an area or a line
  ['G*S*LRM', 'G*S*LRO', 'G*S*LRW'], // main supply route, its traffic either way
  ['G*G*SAA'] // airhead
]
const sameAs = (a: string, b: string) => a === b || SAME.some((g) => g.includes(a) && g.includes(b))

// French labels that are TTA 106's own, meaning the same there.
const TTA_SAME = new Set([
  'CATK',
  'COUV',
  'TEN',
  'TDP',
  'L BO',
  'LD',
  'L CTC',
  'LPDO',
  'LRCL',
  'LIA',
  'FLOT',
  'FEBA',
  'ZRA',
  'ATK',
  'OBJ',
  'ZE',
  'ZA',
  'ZIR',
  'ZIO',
  'ZLO',
  'ZR',
  'W',
  'M',
  'G',
  'RETAR',
  'FSCL'
])

describe('plain labels on tactical graphics', () => {
  test('the catalogue was drawn', () => {
    expect(graphics.length).toBeGreaterThan(100)
  })

  test('every graphic in the table is in the catalogue, and every text it replaces is written', () => {
    for (const [key, labels] of Object.entries(GRAPHIC_LABELS)) {
      const graphic = graphics.find((g) => g.key === key)
      expect(graphic, key).toBeDefined()
      for (const language of ['en', 'fr'] as const) {
        for (const text of Object.keys(labels[language] ?? {})) {
          expect(
            graphic!.texts.map((x) => x.trim()),
            `${key} ${language} ${text}`
          ).toContain(text)
        }
      }
    }
  })

  test.each(['en', 'fr'] as LabelLanguage[])('in %s, no two different graphics share a label', (language) => {
    const by = new Map<string, string[]>()
    for (const g of graphics) {
      const label = labelOf(g.sidc, g.texts, language)
      if (label) by.set(label, [...(by.get(label) ?? []), g.key])
    }
    const shared = [...by].filter(([, keys]) => keys.some((k) => !sameAs(k, keys[0])))
    expect(shared).toEqual([])
  })

  test('no French label means something else in French doctrine (TTA 106)', () => {
    const sigles = new Map<string, string>()
    for (const [sigle, meaning] of (tta as unknown as { sigles: [string, string][] }).sigles)
      sigles.set(sigle, meaning)
    const clashes: string[] = []
    for (const g of graphics) {
      const label = labelOf(g.sidc, g.texts, 'fr')
      if (label && sigles.has(label) && !TTA_SAME.has(label))
        clashes.push(`${g.key} ${label}: TTA 106 "${sigles.get(label)}"`)
    }
    expect(clashes).toEqual([])
  })

  test('the agreed examples', () => {
    expect(plainLabel('GFTPWP---------', 'WP', 'en')).toBe('WUP')
    expect(plainLabel('GFTPWP---------', 'WP', 'fr')).toBe('RSP')
    expect(plainLabel('GFTPH----------', 'B', 'en')).toBe('BREACH')
    expect(plainLabel('GFTPB----------', 'B', 'en')).toBe('B')
    expect(labelOf('GFTPJ----------', ['C', 'ENY'], 'en')).toBe('CNTN')
    expect(plainLabel('GFTPWP---------', 'WP', null)).toBe('WP') // the standard's
    expect(graphicName('GFTPWP---------', 'Withdraw under pressure', 'fr')).toBe('Repli sous la pression')
    expect(graphicName('GFTPWP---------', 'Withdraw under pressure', 'en')).toBe('Withdraw under pressure')
  })

  test('on the map: replaced, and a text replaced by nothing is not drawn', () => {
    const pieces = renderGraphic(lib, {
      sidc: 'GFTPJ----------',
      points: samplePoints('GFTPJ----------', { min: 3, max: 3 }, false, SQUARE['G*T*J']),
      scale: mapScale(13, 0),
      language: 'fr'
    })
    expect(pieces.filter((p) => p.properties?.label).map((p) => p.properties!.label)).toEqual(['CNTN'])
  })
})
