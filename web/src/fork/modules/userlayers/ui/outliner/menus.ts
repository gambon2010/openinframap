// Fork: My layers' list (outliner/index.ts): the right-click menus of layers and folders, and what they do: folders, export.
import { t, tn } from '../../../../core/i18n.ts'
import type { UserLayer } from '../../model/model.ts'
import { openSharing } from '../sharing.ts'
import type { MenuEntry, MenuItem } from '../../../../ui/context-menu.ts'
import { FORMATS } from './constants.ts'
import { freeName, startEditing } from './editing.ts'
import type { OutlinerContext } from './types.ts'

/** The file formats, each downloading the layers given. */
export function exportEntries(c: OutlinerContext, layers: () => UserLayer[]): MenuEntry[] {
  return FORMATS.map(([format, label]) => ({
    label,
    run: () => c.actions.exportLayers(layers(), format)
  }))
}

/** The folders there are, sorted. */
export function folderNames(c: OutlinerContext): string[] {
  const names = new Set(c.personal.data.empty)
  for (const l of c.store.layers.values()) {
    const folder = c.folderOf(l)
    if (folder) names.add(folder)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Put a layer in a folder (null: in none): for you only, nothing to save. */
export function moveToFolder(c: OutlinerContext, layer: UserLayer, folder: string | null) {
  if (c.folderOf(layer) === folder) return
  c.personal.setFolder(layer.id, folder)
  c.actions.update()
  c.actions.reordered()
}

/** "Move to folder": the folders there are, a new one, or out of its folder. */
export function folderEntries(c: OutlinerContext, layer: UserLayer): MenuEntry[] {
  const current = c.folderOf(layer)
  return [
    ...folderNames(c)
      .filter((f) => f !== current)
      .map((f) => ({ label: `📁 ${f}`, run: () => moveToFolder(c, layer, f) })),
    {
      label: `+ ${t('userlayers.new-folder-dots', 'New folder…')}`,
      run: () => {
        const name = freeName(t('userlayers.new-folder-name', 'New folder'), folderNames(c))
        moveToFolder(c, layer, name)
        startEditing(c, 'folder', name)
      }
    },
    ...(current
      ? [
          {
            label: t('userlayers.out-of-folder', 'Out of the folder'),
            run: () => moveToFolder(c, layer, null)
          }
        ]
      : [])
  ]
}

/** A layer's right-click menu: draw into it, zoom, rename, lock, share, folder,
 * export, delete. */
export function layerMenu(
  c: OutlinerContext,
  layer: UserLayer,
  owner: boolean,
  changeable: boolean
): MenuItem[] {
  const store = c.store
  const locked = Boolean(layer.style.locked)
  const items: MenuItem[] = [{ heading: layer.name }]
  if (changeable) {
    items.push({
      label: t('userlayers.draw-here', 'Draw into this layer'),
      run: () => store.setActive(layer.id),
      disabled: layer.id === store.activeLayer
    })
  } else items.push({ heading: t('userlayers.view-only', 'Shared with you to view only') })
  if (layer.features.size)
    items.push({
      label: t('userlayers.zoom-to-layer', 'Zoom to its items'),
      run: () => c.actions.zoomToLayer(layer)
    })
  if (changeable)
    items.push({ label: t('userlayers.rename', 'Rename'), run: () => startEditing(c, 'layer', layer.id) })
  // Only its owner locks or unlocks it.
  if (owner && changeable)
    items.push({
      label: locked
        ? t('userlayers.unlock', '🔓 Unlock')
        : t('userlayers.lock', '🔒 Lock (no changes to its items)'),
      run: () => store.updateLayer(layer.id, { style: { ...layer.style, locked: !locked || undefined } })
    })
  if (owner && layer.access !== undefined)
    items.push({ label: t('userlayers.share', 'Share…'), run: () => openSharing(layer) })
  // Your own folders: even a layer you may only view goes in one.
  if (store.view.live)
    items.push({
      label: t('userlayers.move-to-folder-menu', 'Move to folder'),
      entries: folderEntries(c, layer)
    })
  items.push({ label: t('userlayers.export-as', 'Export as'), entries: exportEntries(c, () => [layer]) })
  if (owner) {
    items.push('separator', {
      label: t('userlayers.delete', 'Delete'),
      danger: true,
      run: () => {
        const message = tn(
          'userlayers.delete-layer',
          'Delete the layer "{{name}}" and its item?',
          'Delete the layer "{{name}}" and its {{count}} items?',
          layer.features.size,
          { name: layer.name }
        )
        if (window.confirm(message)) store.deleteLayer(layer.id)
      }
    })
  }
  return items
}

/** A folder's right-click menu: a new layer in it, rename, lock, export, remove. */
export function folderMenu(
  c: OutlinerContext,
  folder: string,
  layers: UserLayer[],
  lockable: UserLayer[],
  allLocked: boolean
): MenuItem[] {
  const store = c.store
  const live = store.view.live
  const items: MenuItem[] = [{ heading: `📁 ${folder}` }]
  if (live) {
    items.push(
      {
        label: t('userlayers.folder-new-layer', 'New layer in this folder'),
        run: () => c.actions.newLayer(folder)
      },
      { label: t('userlayers.rename', 'Rename'), run: () => startEditing(c, 'folder', folder) }
    )
  }
  // Only a layer's owner locks it: the folder's lock acts on those.
  if (lockable.length)
    items.push({
      label: allLocked
        ? t('userlayers.folder-unlock', '🔓 Unlock its layers')
        : t('userlayers.folder-lock', '🔒 Lock its layers (yours)'),
      run: () =>
        lockable.forEach((l) =>
          store.updateLayer(l.id, { style: { ...l.style, locked: !allLocked || undefined } })
        )
    })
  if (layers.length)
    items.push({ label: t('userlayers.export-as', 'Export as'), entries: exportEntries(c, () => layers) })
  if (live)
    items.push('separator', {
      label: t('userlayers.remove-folder', 'Remove the folder (its layers stay)'),
      run: () => {
        c.personal.toggle('empty', folder, false)
        for (const l of layers) c.personal.setFolder(l.id, null)
        c.actions.update()
        c.actions.reordered()
      }
    })
  return items
}
