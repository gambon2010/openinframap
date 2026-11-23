import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// The fork's colour tokens (panel.css's :root): a token defined by itself is empty,
// and everything painted with it goes transparent (the main buttons did, 2026-11-23).
// Tests run from web/ (as structure.test.ts reads src/fork).
const css = readFileSync('src/fork/ui/panel.css', 'utf8')
const tokens = [...css.matchAll(/(--oim-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => ({ name, value }))

describe("the fork's colour tokens", () => {
  test('are found', () => {
    expect(tokens.map((token) => token.name)).toContain('--oim-primary')
  })

  test('none defined by itself', () => {
    const selfDefined = tokens.filter(({ name, value }) => value.includes(`var(${name})`)).map((t) => t.name)
    expect(selfDefined).toEqual([])
  })
})
