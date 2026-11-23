// Fork: ? shows every keyboard shortcut in a window (ui/panel.ts showModal), as the
// modules list them (their `shortcuts`), by group, in the order they come.
import { el } from 'redom'
import { t } from '../core/i18n.ts'
import type { Shortcut } from '../types.ts'
import { showModal } from './panel.ts'

/** Keys that work everywhere (the map's own, the menus'). */
export function generalShortcuts(): Shortcut[] {
  const group = t('shortcuts.everywhere', 'Everywhere')
  return [
    { keys: '?', does: t('shortcuts.this-list', 'This list'), group },
    { keys: t('shortcuts.arrows', 'Arrows'), does: t('shortcuts.pan', 'Move the map'), group },
    { keys: '+ / −', does: t('shortcuts.zoom', 'Zoom in or out'), group },
    {
      keys: t('shortcuts.menu-key', 'Menu key, Shift+F10'),
      does: t('shortcuts.menu', 'The right-click menu of what has the focus'),
      group
    },
    { keys: 'Esc', does: t('shortcuts.escape', 'Close a menu or a window, stop a tool'), group }
  ]
}

/** ? (not while typing): the list. */
export function listShortcutsOnKey(e: KeyboardEvent, shortcuts: () => Shortcut[]) {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
  if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return
  e.preventDefault()
  showShortcuts(shortcuts())
}

function showShortcuts(shortcuts: Shortcut[]) {
  const groups = new Map<string, Shortcut[]>()
  for (const shortcut of shortcuts)
    groups.set(shortcut.group, [...(groups.get(shortcut.group) ?? []), shortcut])
  const sections = [...groups].map(([group, keys]) =>
    el(
      'section.oim-shortcuts',
      el('h3', group),
      el(
        'table',
        keys.map((s) => el('tr', el('th', el('kbd', s.keys)), el('td', s.does)))
      )
    )
  )
  showModal(t('shortcuts.title', 'Keyboard shortcuts'), ...sections)
}
