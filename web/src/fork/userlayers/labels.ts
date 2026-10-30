// Fork: an item of My layers in a few words, for lists (outliner) and messages.
import { tt } from './i18n.ts'
import { UserFeature } from './model.ts'
import { symbolName } from './palette.ts'
import { IDENTITIES, status } from './sidc.ts'
import { fromDtg, relativeTime } from './fields.ts'

/** name: its designation or name; what: its type; detail: identity, planned, when seen. */
export function featureLabelParts(
  feature: UserFeature,
  now = new Date()
): { name: string; what: string; detail: string } {
  const p = feature.properties
  const name = (p.modifiers?.['T'] || p.name || '').trim()
  const what =
    p.kind === 'symbol' || p.kind === 'graphic'
      ? (symbolName(p.sidc ?? '') ?? p.sidc ?? '')
      : p.kind === 'copy'
        ? tt('userlayers.copy-of-short', 'Copy: {{layer}}', { layer: p.copy?.layer ?? '' })
        : tt(`userlayers.kind.${p.kind}`, p.kind)
  const detail: string[] = []
  if (p.sidc) {
    const id = IDENTITIES.find(([c]) => c === p.sidc![1])?.[1]
    if (id) detail.push(tt(`userlayers.affiliation.${p.sidc[1]}`, id))
    if (status(p.sidc) === 'A') detail.push(tt('userlayers.status.A', 'Planned').toLowerCase())
  }
  const seen = p.modifiers?.['W'] ? fromDtg(p.modifiers['W']) : null
  if (seen) detail.push(relativeTime(seen, now))
  return { name, what, detail: detail.join(' · ') }
}

/** "2nd Bn · Infantry", or just the type. */
export function featureLabel(feature: UserFeature): string {
  const { name, what } = featureLabelParts(feature)
  return name ? `${name} · ${what}` : what
}
