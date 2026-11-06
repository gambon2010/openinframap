// Fork: an item of My layers in a few words, for lists (outliner) and messages.
import { t } from '../../../core/i18n.ts'
import { UserFeature } from './model.ts'
import { kindOf } from '../kinds/index.ts'
import { IDENTITIES } from './sidc.constants.ts'
import { status } from './sidc.ts'
import { fromDtg, relativeTime } from './fields.ts'

/** name: its designation or name; what: its type; detail: identity, planned, when seen. */
export function featureLabelParts(
  feature: UserFeature,
  now = new Date()
): { name: string; what: string; detail: string } {
  const p = feature.properties
  const name = (p.modifiers?.['T'] || p.name || '').trim()
  const what = kindOf(p).what(feature)
  const detail: string[] = []
  if (p.sidc) {
    const id = IDENTITIES.find(([c]) => c === p.sidc![1])?.[1]
    if (id) detail.push(t(`userlayers.affiliation.${p.sidc[1]}`, id))
    if (status(p.sidc) === 'A') detail.push(t('userlayers.status.A', 'Planned').toLowerCase())
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
