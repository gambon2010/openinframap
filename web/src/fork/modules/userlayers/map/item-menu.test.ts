import { describe, expect, test, vi } from 'vitest'
import type { MenuEntry, MenuItem } from '../../../ui/context-menu.ts'
import type { UserFeature } from '../model/model.ts'
import type { Store } from '../state/store.ts'
import { itemMenu } from './item-menu.ts'

const opened = vi.hoisted(() => [] as string[])
vi.mock('../measure/sight-panel.ts', () => ({ openSightPanel: (id: string) => opened.push(id) }))

// Only what the menu reads of the store: the layer and whether it can be changed.
const store = {
  layers: new Map([['layer', { id: 'layer', name: 'My layer' }]]),
  view: { canEditItem: () => true, canEdit: () => true }
} as unknown as Store
const actions = { store, rename: () => {}, duplicate: () => {}, copy: () => {} }

const item = (properties: UserFeature['properties']): UserFeature => ({
  type: 'Feature',
  id: 'item',
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [1, 1]
    ]
  },
  properties
})
const labels = (items: MenuItem[]) =>
  items.filter((i): i is MenuEntry => typeof i === 'object' && 'label' in i).map((i) => i.label)

describe("an item's right-click menu", () => {
  test('a line of sight: its profile first, opened from there', () => {
    const menu = itemMenu(actions, item({ kind: 'measure', measure: 'sight' }), 'layer')
    expect(labels(menu)[0]).toBe('Open the profile')
    ;(menu[0] as MenuEntry).run?.()
    expect(opened).toEqual(['item'])
  })

  test('another measurement: no profile', () => {
    const menu = itemMenu(actions, item({ kind: 'measure', measure: 'distance' }), 'layer')
    expect(labels(menu)).not.toContain('Open the profile')
  })
})
