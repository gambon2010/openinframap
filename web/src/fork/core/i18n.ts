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
