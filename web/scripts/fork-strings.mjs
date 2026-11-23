// Fork: collect the English strings of the fork's code into src/fork/locales/en.json.
// The code calls t('key', 'English text') (fork/core/i18n.ts); the text is
// the fallback, and en.json is what translators (and i18next's debug log) see.
//   node scripts/fork-strings.mjs           add what's missing, update what the code
//                                           now says differently
//   node scripts/fork-strings.mjs --check   only report (exit 1 if anything is missing,
//                                           different, or clashing)
// en.json's text is what's shown (i18next reads it first): a text changed in the code
// but not here would keep showing the old one.
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

// t('key', 'text') or t('key', "text"), the text possibly split over lines.
const call = /\bt\(\s*'([a-z0-9][\w.-]*)'\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
const found = new Map()
// One key with two different texts in the code: only one can be in en.json.
const twice = []
for (const file of files(root)) {
  for (const m of readFileSync(file, 'utf8').matchAll(call)) {
    const text = (m[2] ?? m[3]).replace(/\\(['"\\])/g, '$1')
    const rel = file.slice(root.length)
    const before = found.get(m[1])
    if (!before) found.set(m[1], { text, file: rel })
    else if (before.text !== text) twice.push(`${m[1]}: "${before.text}" (${before.file}) and "${text}" (${rel})`)
  }
}
// tn('key', 'one', 'other', n): two strings, key_one and key_other (English plurals).
const str = `(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)")`
const plural = new RegExp(`\\btn\\(\\s*'([a-z0-9][\\w.-]*)'\\s*,\\s*${str}\\s*,\\s*${str}`, 'g')
for (const file of files(root)) {
  for (const m of readFileSync(file, 'utf8').matchAll(plural)) {
    const unescape = (t) => t.replace(/\\(['"\\])/g, '$1')
    const rel = file.slice(root.length)
    if (!found.has(`${m[1]}_one`)) found.set(`${m[1]}_one`, { text: unescape(m[2] ?? m[3]), file: rel })
    if (!found.has(`${m[1]}_other`)) found.set(`${m[1]}_other`, { text: unescape(m[4] ?? m[5]), file: rel })
  }
}

// My layers' field names: their keys are built in the code (fieldName,
// model/fields.ts: userlayers.f.<stringKey or key>), so read from the field list.
const fieldsFile = 'modules/userlayers/model/fields.constants.ts'
const field = /\bkey: '(\w+)',\s*(?:stringKey: '([\w-]+)',\s*)?label: '((?:[^'\\]|\\.)*)'/g
for (const m of readFileSync(join(root, fieldsFile), 'utf8').matchAll(field)) {
  const key = `userlayers.f.${m[2] ?? m[1]}`
  const text = m[3].replace(/\\(['"\\])/g, '$1')
  const before = found.get(key)
  if (!before) found.set(key, { text, file: fieldsFile })
  else if (before.text !== text) twice.push(`${key}: "${before.text}" (${before.file}) and "${text}" (${fieldsFile})`)
}

const en = JSON.parse(readFileSync(localeFile, 'utf8'))
const problems = twice.map((p) => `${p}: one key, two texts`)
let added = 0
let changed = 0
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
      } else if (node[part] !== text) {
        console.log(`changed: ${key} (${file}): en.json "${node[part]}", the code "${text}"`)
        if (!check) node[part] = text
        changed++
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
console.log(
  `${found.size} strings in the code, ${added} ${check ? 'missing from' : 'added to'} en.json, ` +
    `${changed} ${check ? 'different in' : 'updated in'} en.json`
)
if (!check) writeFileSync(localeFile, JSON.stringify(en, null, 2) + '\n')
process.exit(check && (added || changed || problems.length) ? 1 : 0)
