import { readJson, writeJson } from './storage.ts'
// Fork: the name people sign their changes with (My layers' Save, statuses),
// kept in this browser until there are accounts (docs/plans/sync.md).
const AUTHOR_KEY = 'oim-userlayers-author'

export function author(): string {
  return readJson(AUTHOR_KEY, '')
}

export function setAuthor(name: string) {
  writeJson(AUTHOR_KEY, name)
}
