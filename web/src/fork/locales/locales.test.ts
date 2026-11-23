// The fork's English strings are all in en.json (scripts/fork-strings.mjs adds them:
// npm run fork-strings).
import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('every string in the code is in en.json, with no key clashes', () => {
  expect(() => execFileSync('node', ['scripts/fork-strings.mjs', '--check'], { stdio: 'pipe' })).not.toThrow()
})
