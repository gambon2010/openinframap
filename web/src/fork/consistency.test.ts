// Checks that catch a feature added only half-way: a tile layer nothing draws, a
// map layer the layer switcher can't turn off, a satellite source without its
// credit line.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import extra from './extra/index.ts'
import sites from './sites/index.ts'
import satellite from './satellite/index.ts'
import { attributionFor } from './satellite/index.ts'

const MODULES = [extra, sites, satellite]

/** Layer names defined in a Tegola layers file (the "  - name:" entries). */
function tegolaLayers(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/^ {2}- name: (\w+)$/gm)].map((m) => m[1])
}

const forkStyleLayers = MODULES.flatMap((m) => m.layers?.() ?? [])

test("every tile layer the fork adds is drawn, and every style draws one that's served", () => {
  const forkTiles = tegolaLayers('../tegola/layers.fork.yml')
  const allTiles = new Set([...forkTiles, ...tegolaLayers('../tegola/layers.yml')])
  const used = new Set(
    forkStyleLayers.map((l) => ('source-layer' in l ? l['source-layer'] : undefined)).filter(Boolean)
  )
  expect(forkTiles.length).toBeGreaterThan(5) // the files were read
  expect(forkTiles.filter((name) => !used.has(name))).toEqual([])
  expect([...used].filter((name) => !allTiles.has(name as string))).toEqual([])
})

test('every fork map layer can be turned off in the layer switcher', () => {
  const prefixes = MODULES.flatMap((m) => m.switcherGroups?.() ?? []).flatMap((g: LayerGroup | Layer) =>
    'layers' in g ? g.layers.map((l) => l.prefix) : [(g as Layer).prefix]
  )
  expect(prefixes.length).toBeGreaterThan(5)
  // Background imagery is chosen in Settings, not in the layer switcher.
  const unswitched = forkStyleLayers
    .filter((l) => !l.id.startsWith('satellite'))
    .filter((l) => !prefixes.some((prefix) => l.id.startsWith(prefix)))
    .map((l) => l.id)
  expect(unswitched).toEqual([])
})

test('every aerial photo source has its credit line', () => {
  const sources = JSON.parse(
    execFileSync('python3', ['-I', '../scripts/satellite.py', 'sources'], { encoding: 'utf8' })
  )
  for (const source of sources as { id: string; attribution: string }[]) {
    expect(attributionFor(`http://x/area.sat-detailed-${source.id}/{z}/{x}/{y}.jpg`)).toBe(source.attribution)
  }
})
