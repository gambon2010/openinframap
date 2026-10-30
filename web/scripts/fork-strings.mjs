// Fork: collect the English strings of the fork's code into src/fork/locales/en.json.
// The code calls t('key', 'English text') / tt('key', 'English text'); the text is
// the fallback, and en.json is what translators (and i18next's debug log) see.
//   node scripts/fork-strings.mjs           add what's missing (keeps what's there)
//   node scripts/fork-strings.mjs --check   only report (exit 1 if anything is missing)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../src/fork/', import.meta.url).pathname
const localeFile = join(root, 'locales/en.json')
const check = process.argv.includes('--check')

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

// t('key', 'text') / tt('key', "text"), the text possibly split over lines.
const call = /\b(?:tt|t)\(\s*'([a-z0-9][\w.-]*)'\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
const found = new Map()
for (const file of files(root)) {
  for (const m of readFileSync(file, 'utf8').matchAll(call)) {
    const text = (m[2] ?? m[3]).replace(/\\(['"\\])/g, '$1')
    if (!found.has(m[1])) found.set(m[1], { text, file: file.slice(root.length) })
  }
}

const en = JSON.parse(readFileSync(localeFile, 'utf8'))
const problems = []
let added = 0
for (const [key, { text, file }] of found) {
  const parts = key.split('.')
  let node = en
  let ok = true
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1
    if (last) {
      if (typeof node[part] === 'object') {
        problems.push(`${key} (${file}): also has keys under it`)
        ok = false
      } else if (node[part] === undefined) {
        if (!check) node[part] = text
        added++
      }
    } else {
      if (typeof node[part] === 'string') {
        problems.push(`${key} (${file}): "${parts.slice(0, i + 1).join('.')}" is a string`)
        ok = false
        break
      }
      node[part] ??= {}
      node = node[part]
    }
  }
  if (!ok) continue
}
for (const p of problems) console.log('clash:', p)
console.log(`${found.size} strings in the code, ${added} ${check ? 'missing from' : 'added to'} en.json`)
if (!check) writeFileSync(localeFile, JSON.stringify(en, null, 2) + '\n')
process.exit(check && (added || problems.length) ? 1 : 0)
