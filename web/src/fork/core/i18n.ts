// Fork: the fork's strings. t(key, English text, values): the English is
// collected into locales/en.json (npm run fork-strings), other languages come from
// i18next. Values are never HTML-escaped: the fork puts strings on the page as text
// (el(), textContent), so a name with "&" or quotes shows as typed. Never put a
// string with values from data into innerHTML.
import i18next from 'i18next'

// Without the English text (keys made at run time): the text in en.json.
export function t(key: string, fallback?: string, values: Record<string, unknown> = {}): string {
  return i18next.t(key, {
    ...values,
    ...(fallback !== undefined ? { defaultValue: fallback } : {}),
    interpolation: { escapeValue: false }
  }) as string
}

/**
 * A text that depends on a number: tn(key, one, other, n), e.g. the English
 * "{{count}} layer" and "{{count}} layers". i18next picks the form for the language (English: key_one / key_other in
 * en.json; others may have more forms); the English forms are the fallback.
 */
export function tn(
  key: string,
  one: string,
  other: string,
  count: number,
  values: Record<string, unknown> = {}
): string {
  return i18next.t(key, {
    ...values,
    count,
    defaultValue_one: one,
    defaultValue_other: other,
    defaultValue: other,
    interpolation: { escapeValue: false }
  }) as string
}
