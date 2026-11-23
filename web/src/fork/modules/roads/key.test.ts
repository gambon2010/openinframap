import { describe, expect, it } from 'vitest'
import { roadsKey } from './key.ts'
import { roadLayers } from './layers.ts'

const names = { roads: 'Roads', railways: 'Railways', transit: 'Trams and metro' }
const ids = roadLayers().layers.map((l) => l.id)

describe('the roads’ key', () => {
  it('a section per Data layers entry, named as it (it unfolds there)', () => {
    expect(roadsKey(names).map((s) => s.title)).toEqual(['Roads', 'Railways', 'Trams and metro'])
  })

  it('each row hides layers that exist; every bold layer in some row', () => {
    const prefixes = roadsKey(names).flatMap((s) =>
      s.rows.flatMap(([, , hide]) => (hide && 'layers' in hide ? hide.layers : []))
    )
    for (const prefix of prefixes)
      expect(
        ids.some((id) => id.startsWith(prefix)),
        prefix
      ).toBe(true)
    const bold = ids.filter((id) => !id.startsWith('boundaries_'))
    expect(bold.filter((id) => !prefixes.some((p) => id.startsWith(p)))).toEqual([])
  })

  it('sidings, yards and depots hidden at first', () => {
    const hiddenAtFirst = roadsKey(names).flatMap((s) => s.rows.filter((row) => row[3]?.hiddenAtFirst))
    expect(hiddenAtFirst.map(([, , hide]) => hide)).toEqual([
      { layers: ['railways_sidings_'] },
      { layers: ['transit_sidings_'] }
    ])
  })
})
