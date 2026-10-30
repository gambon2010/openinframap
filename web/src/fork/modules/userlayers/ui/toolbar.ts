// Fork: My layers' toolbar at the top of the map: the tools (keys V S A L R M P C),
// the layer new things go into, undo / redo, history and Save; the symbol picker
// opens under it, and pictures are picked from a file.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { Palette, Pick, PaletteMode } from '../palette.ts'
import { graphicsLibrary, isAxis, pointCount } from '../graphics.ts'
import { uploadImage } from '../api.ts'
import { action } from './buttons.ts'
import { prepareImage } from './images.ts'
import type { Workspace } from './workspace.ts'

/** The map toolbar's tools: [id, glyph, label, key]. */
export const TOOLS: [string, string, string, string][] = [
  ['select', '↖', 'Select and move', 'V'],
  ['symbol', '⬚', 'Symbol', 'S'],
  ['graphic', '➚', 'Arrow or graphic', 'A'],
  ['line', '╱', 'Line', 'L'],
  ['area', '▱', 'Area', 'R'],
  ['marker', '📍', 'Marker', 'M'],
  ['image', '🖼', 'Picture', 'P'],
  ['copy', '⧉', 'Copy from the map', 'C']
]

export class Toolbar {
  readonly el = el('.oim-ul-toolbar', { role: 'toolbar', 'aria-label': t('userlayers.title', 'My layers') })
  readonly picker: HTMLElement
  /** The picker open on symbols or graphics (null: closed). */
  paletteMode: PaletteMode | null = null
  readonly fileInput: HTMLInputElement
  private palette: Palette
  private ws: Workspace

  constructor(ws: Workspace) {
    this.ws = ws
    this.palette = new Palette((pick) => void this.picked(pick))
    this.picker = el('.oim-ul-picker', this.palette.el)
    this.fileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/svg+xml'
    }) as HTMLInputElement
    this.fileInput.style.display = 'none'
    this.fileInput.onchange = () => void this.pickedImage()
  }

  /** Close the symbol picker (another view, the workspace closed...). */
  closePicker() {
    this.paletteMode = null
  }

  private activeToolId(): string {
    const tool = this.ws.tools.tool
    if (this.paletteMode === 'symbols') return 'symbol'
    if (this.paletteMode === 'graphics') return 'graphic'
    if (tool.mode === 'place') return tool.properties.kind === 'symbol' ? 'symbol' : tool.properties.kind
    if (tool.mode === 'graphic') return 'graphic'
    return tool.mode
  }

  chooseTool(id: string) {
    const tools = this.ws.tools
    const again = this.activeToolId() === id && id !== 'select'
    this.paletteMode = null
    tools.setTool({ mode: 'select' })
    if (again) {
      this.ws.update()
      return
    }
    switch (id) {
      case 'symbol':
      case 'graphic':
        this.paletteMode = id === 'symbol' ? 'symbols' : 'graphics'
        void this.palette.open(this.paletteMode)
        break
      case 'line':
      case 'area':
        tools.setTool(
          { mode: id, points: [] },
          t('userlayers.draw-hint', 'Click to add points; double-click or Enter to finish.')
        )
        break
      case 'marker':
        tools.setTool(
          { mode: 'place', properties: { kind: 'marker' } },
          t('userlayers.marker-hint', 'Click the map to put a marker there.')
        )
        break
      case 'image':
        this.fileInput.click()
        break
      case 'copy':
        tools.setTool(
          { mode: 'copy' },
          t(
            'userlayers.copy-hint',
            'Click lines, substations, sites... to copy them into the layer. They stay visible when their kind is hidden.'
          )
        )
        break
    }
    this.ws.update()
  }

  update() {
    const { store, timeline } = this.ws
    const view = store.view
    const inPlayback = view.mode === 'playback'
    this.el.classList.toggle('visible', this.ws.isOpen)
    this.picker.classList.toggle('visible', this.ws.isOpen && this.paletteMode !== null && !inPlayback)
    if (!this.ws.isOpen) return
    const bar = this.el
    bar.textContent = ''
    const active = this.activeToolId()
    const tools = el(
      '.oim-ul-toolbar-group',
      TOOLS.map(([id, glyph, label, key]) => {
        const b = action(glyph, () => this.chooseTool(id), {
          title: `${t(`userlayers.tool.${id}`, label)} (${key})`,
          active: active === id,
          className: 'oim-ul-tool-icon'
        })
        b.setAttribute('aria-pressed', String(active === id))
        b.setAttribute('aria-label', t(`userlayers.tool.${id}`, label))
        b.disabled = !view.live
        return b
      })
    )
    // Where new items go.
    const target = el(
      'select.oim-ul-target',
      { title: t('userlayers.add-to', 'New items go into this layer'), disabled: inPlayback },
      [...store.layers.values()].map((l) =>
        // A locked layer takes nothing new.
        el('option', l.style.locked ? `🔒 ${l.name}` : l.name, {
          value: l.id,
          selected: l.id === store.activeLayer,
          disabled: !view.canEdit(l)
        })
      ),
      el('option', `+ ${t('userlayers.new-layer', 'New layer')}`, {
        value: '',
        selected: !store.layers.size
      })
    ) as HTMLSelectElement
    target.onchange = () => {
      if (target.value) {
        store.setActive(target.value)
        return
      }
      this.ws.newLayer()
    }
    const undo = action('↶', () => store.undo(), {
      title: t('userlayers.undo', 'Undo (Ctrl+Z)'),
      disabled: !store.canUndo || !view.live,
      className: 'oim-ul-tool-icon'
    })
    const redo = action('↷', () => store.redo(), {
      title: t('userlayers.redo', 'Redo (Ctrl+Shift+Z)'),
      disabled: !store.canRedo || !view.live,
      className: 'oim-ul-tool-icon'
    })
    const history = action('🕘', () => (inPlayback ? timeline.close() : void timeline.open()), {
      title: inPlayback
        ? t('userlayers.history-exit', 'Back to now')
        : t('userlayers.history-open', 'Play back the history'),
      active: inPlayback,
      className: 'oim-ul-tool-icon'
    })
    const pending = store.unsavedCount
    const busy = this.ws.busy
    const save = action(
      busy ||
        (pending
          ? t('userlayers.save-n', 'Save ({{count}})', { count: pending })
          : t('userlayers.saved', 'Saved')),
      () => void this.ws.run(t('userlayers.saving', 'Saving'), () => store.save()),
      {
        primary: pending > 0,
        disabled: !pending || !!busy || inPlayback,
        title: t('userlayers.save-title', 'Send your changes to the database (they can then be played back)')
      }
    )
    const more = el(
      'details.oim-ul-menu',
      el('summary', '⋯', { title: t('userlayers.more', 'More') }),
      el(
        '.oim-ul-menu-items',
        action(
          t('userlayers.discard', 'Discard unsaved changes'),
          () => {
            const message = t('userlayers.discard-confirm', 'Forget the {{count}} unsaved change(s)?', {
              count: pending
            })
            if (window.confirm(message)) {
              this.ws.tools.select(null)
              void this.ws.run(t('userlayers.discarding', 'Discarding'), () => store.discard())
            }
          },
          { disabled: !pending || !!busy }
        )
      )
    )
    bar.append(
      tools,
      el('.oim-ul-toolbar-group', el('span.oim-ul-toolbar-label', t('userlayers.into', 'Into')), target),
      el('.oim-ul-toolbar-group', undo, redo, history),
      el('.oim-ul-toolbar-group', save, more)
    )
  }

  private async picked(pick: Pick) {
    const tools = this.ws.tools
    this.paletteMode = null
    this.ws.update()
    if (!pick.geometry) {
      tools.setTool(
        { mode: 'place', properties: { kind: 'symbol', sidc: pick.sidc } },
        t('userlayers.place-hint', 'Click the map to put "{{name}}" there.', { name: pick.name })
      )
      return
    }
    const lib = await graphicsLibrary()
    const count = pointCount(lib, pick.sidc)
    if (!count) {
      window.alert(
        t('userlayers.graphic-unsupported', '"{{name}}" can\'t be drawn yet.', { name: pick.name })
      )
      this.ws.update()
      return
    }
    if (isAxis(lib, pick.sidc)) {
      // Arrows: the path from tail to tip; the width has its own handle.
      tools.setTool(
        {
          mode: 'graphic',
          properties: { kind: 'graphic', sidc: pick.sidc },
          points: [],
          min: 2,
          max: Infinity,
          axis: true
        },
        t(
          'userlayers.axis-hint',
          '"{{name}}": click where the arrow starts, then along its path, and double-click (or Enter) where it points to. Drag the blue handle to change its width.',
          { name: pick.name }
        )
      )
      return
    }
    const max = Number.isFinite(count.max) && count.max < 1000 ? count.max : Infinity
    const hint =
      count.min === max
        ? t('userlayers.graphic-hint-fixed', '"{{name}}": click {{n}} points on the map.', {
            name: pick.name,
            n: count.min
          })
        : t(
            'userlayers.graphic-hint',
            '"{{name}}": click at least {{n}} points; double-click or Enter to finish.',
            {
              name: pick.name,
              n: count.min
            }
          )
    tools.setTool(
      { mode: 'graphic', properties: { kind: 'graphic', sidc: pick.sidc }, points: [], min: count.min, max },
      hint
    )
  }

  private async pickedImage() {
    const file = this.fileInput.files?.[0]
    this.fileInput.value = ''
    if (!file) return
    await this.ws.run(t('userlayers.uploading', 'Uploading the picture'), async () => {
      const { mime, data } = await prepareImage(file)
      const id = await uploadImage(file.name, mime, data)
      this.paletteMode = null
      this.ws.tools.setTool(
        { mode: 'place', properties: { kind: 'image', image: id, name: '' } },
        t('userlayers.image-hint', 'Click the map to put the picture there.')
      )
    })
  }
}
