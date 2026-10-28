// Fork: translations for My layers. Everything is put on the page as text (never
// as HTML), so values aren't HTML-escaped: a name with quotes shows as typed.
import { t } from 'i18next'

export function tt(key: string, fallback: string, values: Record<string, unknown> = {}): string {
  return t(key, fallback, { ...values, interpolation: { escapeValue: false } }) as string
}
