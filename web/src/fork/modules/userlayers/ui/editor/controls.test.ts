import { beforeEach, describe, expect, test } from 'vitest'
import type { Field } from '../../model/fields.types.ts'
import { detailRow, identityChoice } from './controls.ts'

const speed: Field = { key: 'Z', label: 'Speed', input: 'number', quantity: 'speed', kinds: ['unit'] }
const direction: Field = { key: 'Q', label: 'Direction', input: 'number', quantity: 'angle', kinds: ['unit'] }
const date: Field = { key: 'W', label: 'Date-time group', input: 'datetime', kinds: ['unit'] }

/** A row built and in the page, and what it set. */
function rowFor(field: Field, value: string, removable = false) {
  const set: string[] = []
  const row = detailRow(field, value, (v) => set.push(v), removable)
  document.body.replaceChildren(row)
  return { row, set }
}

const change = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  element.value = value
  element.dispatchEvent(new Event('change'))
}

describe("a detail's row on the card", () => {
  beforeEach(() => localStorage.clear())

  test('a speed kept with the unit chosen beside it', () => {
    const { row, set } = rowFor(speed, '')
    const [amount, unit] = row.querySelectorAll<HTMLInputElement & HTMLSelectElement>('input, select')
    change(unit, 'kn')
    change(amount, '30')
    expect(set.at(-1)).toBe('30 kn')
  })

  test('a speed kept before units could be chosen shows in km/h', () => {
    const { row } = rowFor(speed, '30')
    expect(row.querySelector('select')?.value).toBe('km/h')
    expect(row.querySelector('input')?.value).toBe('30')
  })

  test('a direction kept in degrees, typed and shown in mils', () => {
    const { row, set } = rowFor(direction, '90')
    const input = row.querySelector('input')!
    change(row.querySelector('select')!, 'mils')
    expect(input.value).toBe('1600')
    change(input, '3200')
    expect(set.at(-1)).toBe('180')
  })

  test('a date in words, its input when clicked, words again when left', () => {
    const { row } = rowFor(date, '301200ZOCT26')
    const words = row.querySelector<HTMLButtonElement>('.oim-ul-detail-value')!
    words.click()
    const input = row.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    expect(input).not.toBeNull()
    input.dispatchEvent(new Event('blur'))
    expect(row.querySelector('input[type="datetime-local"]')).toBeNull()
    expect(row.querySelector('.oim-ul-detail-value')).toBe(words)
  })

  test("× removes a detail added by mistake; a kind's own empty one has none", () => {
    const added = rowFor(speed, ' ', true)
    added.row.querySelector<HTMLButtonElement>('.oim-ul-row-remove')!.click()
    expect(added.set).toEqual([''])
    expect(rowFor(date, '', false).row.querySelector('.oim-ul-row-remove')).toBeNull()
  })
})

describe('an identity chosen with its frame', () => {
  test('shows the one chosen, and lists the others with theirs', () => {
    const chosen: string[] = []
    const button = identityChoice('F', (v) => chosen.push(v), 'identity')
    document.body.replaceChildren(button)
    expect(button.textContent).toContain('Friend')
    expect(button.querySelector('svg')).not.toBeNull()
    button.click()
    const lines = [...document.querySelectorAll<HTMLButtonElement>('.oim-context-menu button')]
    expect(lines.every((line) => line.querySelector('svg'))).toBe(true)
    lines.find((line) => line.textContent?.includes('Hostile'))!.click()
    expect(chosen).toEqual(['H'])
  })

  test('several different: says so, no frame', () => {
    const button = identityChoice('', () => {}, 'bulk-identity', '(mixed)')
    expect(button.textContent).toContain('(mixed)')
    expect(button.querySelector('svg')).toBeNull()
  })
})
