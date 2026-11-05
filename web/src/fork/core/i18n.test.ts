import i18next from 'i18next'
import { beforeAll, expect, test } from 'vitest'
import { t, tn } from './i18n.ts'

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: {
      en: {
        translation: { known: { key: 'From en.json', n_one: '{{count}} thing', n_other: '{{count}} things' } }
      }
    }
  })
})

test('the English given is used when the key is missing', () => {
  expect(t('missing.key', 'Hello {{name}}', { name: 'Ann' })).toBe('Hello Ann')
})

test('values are not HTML-escaped: they go on the page as text', () => {
  expect(t('missing.key', 'Line to {{to}}', { to: 'Rhône & "Co"' })).toBe('Line to Rhône & "Co"')
})

test('without English text, the key is looked up', () => {
  expect(t('known.key')).toBe('From en.json')
})

test('plurals: the form for the number, from en.json or the English given', () => {
  expect(tn('known.n', 'x', 'y', 1)).toBe('1 thing')
  expect(tn('known.n', 'x', 'y', 3)).toBe('3 things')
  expect(tn('missing.n', '{{count}} layer', '{{count}} layers', 1)).toBe('1 layer')
  expect(tn('missing.n', '{{count}} layer', '{{count}} layers', 0)).toBe('0 layers')
  expect(tn('missing.n', 'its item', 'its {{count}} items of {{name}}', 2, { name: 'A' })).toBe(
    'its 2 items of A'
  )
})
