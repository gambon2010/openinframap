// Fork: My layers' keyboard shortcuts, for the list ? shows (ui/shortcuts.ts): the
// tools' keys (toolbar.ts TOOLS) and the rest, as the code that handles them has them
// (workspace.ts, map/interactions.ts, map/tools.ts, timeline.ts, measure/sight-chart.ts).
import { t } from '../../core/i18n.ts'
import type { Shortcut } from '../../types.ts'
import { TOOLS } from './ui/toolbar.ts'

export function userLayersShortcuts(): Shortcut[] {
  return [...toolKeys(), ...itemKeys(), ...drawingKeys(), ...elsewhereKeys()]
}

function toolKeys(): Shortcut[] {
  const group = t('shortcuts.tools', 'My layers: tools')
  return TOOLS.map(([id, label, key]) => ({ keys: key, does: t(`userlayers.tool.${id}`, label), group }))
}

function itemKeys(): Shortcut[] {
  const group = t('shortcuts.items', 'My layers: items')
  return [
    { keys: 'Ctrl+Z', does: t('shortcuts.undo', 'Undo'), group },
    { keys: 'Ctrl+Shift+Z, Ctrl+Y', does: t('shortcuts.redo', 'Redo'), group },
    { keys: 'Ctrl+S', does: t('shortcuts.save', 'Save'), group },
    { keys: 'F2', does: t('shortcuts.rename', 'Rename the selected item'), group },
    { keys: 'Ctrl+D', does: t('shortcuts.duplicate', 'Duplicate it'), group },
    { keys: 'Ctrl+C, Ctrl+V', does: t('shortcuts.copy-paste', 'Copy it, paste under the pointer'), group },
    { keys: t('shortcuts.delete-keys', 'Delete'), does: t('shortcuts.delete', 'Delete it'), group },
    { keys: t('shortcuts.shift-scroll', 'Shift + scroll'), does: t('shortcuts.size', 'Its size'), group }
  ]
}

function drawingKeys(): Shortcut[] {
  const group = t('shortcuts.drawing', 'My layers: placing and drawing')
  return [
    {
      keys: t('shortcuts.shift-click', 'Shift + click'),
      does: t('shortcuts.place-several', 'Place several'),
      group
    },
    {
      keys: t('shortcuts.enter-double', 'Enter, double-click'),
      does: t('shortcuts.finish', 'Finish a line or an area'),
      group
    },
    {
      keys: t('shortcuts.backspace', 'Backspace'),
      does: t('shortcuts.take-back', 'Take back the last point'),
      group
    },
    {
      keys: t('shortcuts.right-click', 'Right-click'),
      does: t('shortcuts.drop', 'Drop what’s drawn; again: stop the tool'),
      group
    },
    {
      keys: t('shortcuts.shift-drag', 'Shift + drag'),
      does: t('shortcuts.copy-box', 'With Copy: everything in a box'),
      group
    }
  ]
}

function elsewhereKeys(): Shortcut[] {
  return [
    {
      keys: '← →',
      does: t('shortcuts.history-steps', 'The previous and next change'),
      group: t('shortcuts.history', 'My layers: history')
    },
    {
      keys: '← →',
      does: t('shortcuts.profile-steps', 'Along the line (Shift: finer)'),
      group: t('shortcuts.profile', 'Line of sight profile')
    }
  ]
}
