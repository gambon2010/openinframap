// The fork's folder rules (docs/ARCHITECTURE.md):
// - modules/<name>/ may import core/, ui/, the root files and its own files, never
//   another module;
// - ui/ imports only core/ and the root files (types.ts, config.ts);
// - core/ imports nothing else of the fork;
// - upstream files import only fork/index.ts, fork/types.ts and fork/config.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { expect, test } from 'vitest'

const SRC = 'src'
const FORK = 'src/fork'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.ts$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

/** The fork files a file imports (relative imports only), as paths from src/fork. */
function forkImports(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
    .map((m) => normalize(join(dirname(file), m[1])))
    .filter((path) => path.startsWith(FORK + '/'))
    .map((path) => relative(FORK, path))
}

const area = (path: string) => {
  const [top, name] = path.split('/')
  if (top === 'modules') return `modules/${name}`
  return ['core', 'ui', 'locales'].includes(top) ? top : 'root'
}

test('modules never import each other; ui and core stay below them', () => {
  const broken: string[] = []
  for (const file of files(FORK).filter((f) => !f.endsWith('.test.ts'))) {
    const from = area(relative(FORK, file))
    for (const target of forkImports(file).map(area)) {
      const allowed =
        from === 'root' ||
        target === from ||
        target === 'core' ||
        (target === 'root' && from !== 'core') ||
        (target === 'ui' && from.startsWith('modules/')) ||
        (target === 'locales' && from === 'root')
      if (!allowed) broken.push(`${relative(FORK, file)} -> ${target}`)
    }
  }
  // Until the left column is shared (docs/plans/refactor.md, step 5).
  const pending = ['modules/userlayers/panel.ts -> modules/grid']
  expect(broken.filter((b) => !pending.includes(b))).toEqual([])
})

test('upstream files import only index.ts, types.ts and config.ts of the fork', () => {
  const upstream = files(SRC).filter((f) => !f.startsWith(FORK + '/'))
  const used = new Set(upstream.flatMap(forkImports))
  expect([...used].sort()).toEqual(['config.ts', 'index.ts', 'types.ts'].filter((f) => used.has(f)))
  expect(used.size).toBeGreaterThan(0)
})
