// Fork: an item's right-click menu, the same on the map (interactions.ts) and in the
// list (outliner/rows/item.ts): a line of sight's profile, its identity and present /
// planned (symbols and graphics), rename, duplicate, copy, move to another layer, lock, delete. Built from
// the shared context menu's entries (ui/context-menu.ts).
import { identityIcon } from '../ui/identity-icons.ts'
import { t } from '../../../core/i18n.ts'
import type { MenuEntry, MenuItem } from '../../../ui/context-menu.ts'
import type { Store } from '../state/store.ts'
import type { UserFeature } from '../model/model.ts'
import { status, withIdentity, withStatus } from '../model/sidc.ts'
import { identityOptions } from '../model/labels.ts'
import { toolIcon } from '../ui/tool-icons.ts'
import { openSightPanel } from '../measure/sight-panel.ts'

/** A line of sight's profile, as its card's "Open the profile" opens it. */
function sightEntries(
  feature: UserFeature,
  update: (changes: Partial<UserFeature['properties']>) => void
): MenuItem[] {
  const isSight = feature.properties.kind === 'measure' && feature.properties.measure === 'sight'
  if (!isSight) return []
  return [
    {
      label: t('userlayers.sight-open', 'Open the profile'),
      icon: toolIcon('measure-sight', 16),
      run: () => openSightPanel(feature.id, update)
    },
    'separator'
  ]
}

/** What the menu's entries do beyond changing the item (interactions.ts has them). */
export interface ItemMenuActions {
  store: Store
  /** Opens its card with the name ready to type. */
  rename: (id: string) => void
  /** A copy beside it, in the same layer. */
  duplicate: (feature: UserFeature, layerId: string) => void
  /** Keeps a copy to paste (Ctrl+V). */
  copy: (feature: UserFeature) => void
}

export function itemMenu(a: ItemMenuActions, feature: UserFeature, layerId: string): MenuItem[] {
  const { store } = a
  const layer = store.layers.get(layerId)
  const locked = !store.view.canEditItem(layer, feature)
  const update = (changes: Partial<UserFeature['properties']>) =>
    store.updateFeature(layerId, { ...feature, properties: { ...feature.properties, ...changes } })
  const items: MenuItem[] = [...sightEntries(feature, update), ...codeEntries(feature, locked, update)]
  items.push(
    { label: t('userlayers.rename', 'Rename'), run: () => a.rename(feature.id), disabled: locked },
    { label: t('userlayers.duplicate', 'Duplicate'), run: () => a.duplicate(feature, layerId) },
    { label: t('userlayers.copy-item', 'Copy (Ctrl+C)'), run: () => a.copy(feature) }
  )
  const others = [...store.layers.values()].filter((l) => l.id !== layerId && store.view.canEdit(l))
  if (others.length && !locked) {
    items.push({
      label: t('userlayers.move-to', 'Move to layer'),
      entries: others.map((l): MenuEntry => ({
        label: l.name,
        run: () => store.moveFeature(feature.id, l.id)
      }))
    })
  }
  // Lock or unlock this one item (whoever may change its layer).
  if (store.view.canEdit(layer)) {
    items.push(
      feature.properties.locked
        ? {
            label: t('userlayers.unlock-item', 'Unlock'),
            icon: toolIcon('unlock', 16),
            run: () => update({ locked: undefined })
          }
        : {
            label: t('userlayers.lock-item', 'Lock'),
            icon: toolIcon('lock', 16),
            run: () => update({ locked: true })
          }
    )
  }
  items.push('separator', {
    label: t('userlayers.delete', 'Delete'),
    danger: true,
    disabled: locked,
    run: () => store.deleteFeatures([feature.id])
  })
  return items
}

/** A symbol's or graphic's identity (a submenu, its frame before each) and present /
 * planned; nothing for other items. */
function codeEntries(
  feature: UserFeature,
  locked: boolean,
  update: (changes: Partial<UserFeature['properties']>) => void
): MenuItem[] {
  const sidc = feature.properties.sidc
  if (!sidc) return []
  const identity = {
    label: t('userlayers.identity', 'Identity'),
    disabled: locked,
    entries: identityOptions().map(([code, label]): MenuEntry => ({
      label,
      icon: identityIcon(code, 16),
      run: () => update({ sidc: withIdentity(sidc, code) }),
      disabled: sidc[1] === code
    }))
  }
  const planned = status(sidc) === 'A'
  const presence = planned
    ? {
        label: t('userlayers.make-present', 'Mark as present'),
        run: () => update({ sidc: withStatus(sidc, 'P') })
      }
    : {
        label: t('userlayers.make-planned', 'Mark as planned'),
        run: () => update({ sidc: withStatus(sidc, 'A') })
      }
  return [identity, { ...presence, disabled: locked }, 'separator']
}
