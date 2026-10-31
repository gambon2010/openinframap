// Fork: the name people sign their changes with (My layers' Save, statuses),
// kept in this browser until there are accounts (docs/plans/sync.md).
const AUTHOR_KEY = 'oim-userlayers-author'

export function author(): string {
  try {
    const value = localStorage.getItem(AUTHOR_KEY)
    return value ? (JSON.parse(value) as string) : ''
  } catch {
    return ''
  }
}

export function setAuthor(name: string) {
  try {
    localStorage.setItem(AUTHOR_KEY, JSON.stringify(name))
  } catch {
    // Private window or storage blocked.
  }
}
