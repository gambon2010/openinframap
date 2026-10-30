import i18next from 'i18next'
import { beforeAll, expect, test } from 'vitest'
import { t } from './i18n.ts'

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: { en: { translation: { known: { key: 'From en.json' } } } } })
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
