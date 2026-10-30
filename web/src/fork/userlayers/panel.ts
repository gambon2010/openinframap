// Fork: the "My layers" workspace (docs/plans/my-layers-v3.md), opened by its button
// on the right:
// - a sidebar on the left, between the search box and the details panel: the
//   layers and their items (the outliner); the details panel below it is the
//   inspector (editor.ts), for my items and map features alike;
// - a toolbar at the top of the map: the tools, the layer new things go into, undo /
//   redo, history and Save; the symbol picker opens under it;
// - a hint at the bottom of the map while a tool is in use, and the history
//   timeline at the bottom while playing back.
import { tt } from './i18n.ts'
import { el } from 'redom'
import { IControl, Map } from 'maplibre-gl'
import { Store } from './store.ts'
import { Tools } from './tools.ts'
import { Renderer, geometryCentre, translateGeometry } from './render.ts'
import { Palette, Pick, PaletteMode } from './palette.ts'
import { Playback } from './history.ts'
import { Situation, createSituation, deleteSituation, listSituations, uploadImage } from './api.ts'
import { situationLabel, situationPosition } from './situations.ts'
import { UserFeature, UserLayer } from './model.ts'
import { buildBulkCard, buildEditor } from './editor.ts'
import { Outliner } from './outliner.ts'
import { graphicsLibrary, isAxis, pointCount } from './graphics.ts'
import { getLabelLevel, setLabelLevel } from './symbols.ts'
import { LabelLevel } from './fields.ts'
import { foldRoute, sidePanel } from '../grid/index.ts'
import './userlayers.css'

// Pictures are kept this big (longest side): enough to stay sharp at the largest
// size on the map (8×64 px, on a high-density screen).
export const MAX_IMAGE_SIZE = 1024

/** How much to scale a picture: down to MAX_IMAGE_SIZE; vector images (SVG) up to it too. */
export function imageScale(width: number, height: number, vector: boolean): number {
  const longest = Math.max(width, height, 1)
  return vector ? MAX_IMAGE_SIZE / longest : Math.min(1, MAX_IMAGE_SIZE / longest)
}

/** A picture, at most 1024 px, as WebP (keeps transparency, small) in base64 for the backend. */
async function prepareImage(file: File): Promise<{ mime: string; data: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = imageScale(img.naturalWidth, img.naturalHeight, file.type === 'image/svg+xml')
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    let dataUrl = canvas.toDataURL('image/webp', 0.9)
    // Browsers without WebP encoding give PNG back.
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png')
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'))
    return { mime, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

const OPEN_KEY = 'oim-userlayers-open'

/** The map toolbar's tools: [id, glyph, label, key]. */
const TOOLS: [string, string, string, string][] = [
  ['select', '↖', 'Select and move', 'V'],
  ['symbol', '⬚', 'Symbol', 'S'],
  ['graphic', '➚', 'Arrow or graphic', 'A'],
  ['line', '╱', 'Line', 'L'],
  ['area', '▱', 'Area', 'R'],
  ['marker', '📍', 'Marker', 'M'],
  ['image', '🖼', 'Picture', 'P'],
  ['copy', '⧉', 'Copy from the map', 'C']
]

export class Panel implements IControl {
  private map: Map
  private store: Store
  private tools: Tools
  private renderer: Renderer
  private playback: Playback
  private container!: HTMLElement
  private button!: HTMLButtonElement
  private sidebar: HTMLElement
  private outline: HTMLElement
  private toolbar: HTMLElement
  private picker: HTMLElement
  private toast: HTMLElement
  private timeline: HTMLElement
  private palette: Palette
  private fileInput: HTMLInputElement
  private paletteMode: PaletteMode | null = null
  private outliner: Outliner
  private inPlayback = false
  private follow = true
  private busy = ''
  isOpen = false

  /** Showing the past (history playback or a situation): the live layers aren't drawn. */
  get showingPast(): boolean {
    return this.inPlayback || this.viewing !== null
  }
  // Situations: the saved ones, and the one being viewed (null: live).
  private situations: Situation[] = []
  private situationsLoaded = false
  private viewing: Situation | null = null
  private situationLine = el('.oim-ul-situation')
  private banner = el('.oim-ul-banner', { role: 'status' })
  // The editor in the side panel: which feature (and version) it shows.
  private editorKey: string | null = null

  constructor(map: Map, store: Store, tools: Tools, renderer: Renderer) {
    this.map = map
    this.store = store
    this.tools = tools
    this.renderer = renderer
    this.playback = new Playback(map)
    this.palette = new Palette((pick) => void this.picked(pick))
    this.fileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/svg+xml'
    }) as HTMLInputElement
    this.fileInput.style.display = 'none'
    this.fileInput.onchange = () => void this.pickedImage()
    this.outline = el('.oim-ul-outline')
    this.outliner = new Outliner(store, {
      update: () => this.update(),
      select: (feature, add) => {
        if (!this.viewing) {
          if (add) this.tools.toggle(feature.id)
          else this.tools.select(feature.id)
        }
        if (!add) this.zoomTo(feature)
      },
      isSelected: (id) => this.tools.selection().includes(id),
      newLayer: () => this.newLayer()
    })
    this.sidebar = el('.maplibregl-ctrl.oim-ul-sidebar', this.fileInput)
    this.toolbar = el('.oim-ul-toolbar', {
      role: 'toolbar',
      'aria-label': tt('userlayers.title', 'My layers')
    })
    this.picker = el('.oim-ul-picker', this.palette.el)
    this.toast = el('.oim-ul-toast', { role: 'status' })
    this.timeline = el('.oim-ul-timeline')
    store.onChange(() => this.update())
    tools.onChange(() => this.update())
    document.addEventListener('keydown', (e) => this.keydown(e))
  }

  onAdd(): HTMLElement {
    this.button = el('button.maplibregl-ctrl-icon.oim-ul-control', {
      type: 'button',
      title: tt('userlayers.title', 'My layers'),
      'aria-label': tt('userlayers.title', 'My layers')
    }) as HTMLButtonElement
    this.button.onclick = () => this.toggle()
    this.container = el('div.maplibregl-ctrl.maplibregl-ctrl-group', this.button)
    this.map.getContainer().append(this.toolbar, this.picker, this.toast, this.timeline, this.banner)
    // In the left column, between the search box and the details panel.
    const details = sidePanel()?._container
    if (details?.parentElement) details.parentElement.insertBefore(this.sidebar, details)
    else this.map.getContainer().querySelector('.maplibregl-ctrl-top-left')?.append(this.sidebar)
    let open = false
    try {
      open = localStorage.getItem(OPEN_KEY) === '1'
    } catch {
      // Closed by default.
    }
    this.toggle(open)
    return this.container
  }

  onRemove() {
    for (const e of [this.container, this.sidebar, this.toolbar, this.picker, this.toast, this.timeline])
      e.remove()
  }

  toggle(open = !this.isOpen) {
    this.isOpen = open
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    } catch {
      // Not remembered.
    }
    // Shift-click selects several items: the map's Shift-drag zoom would swallow it.
    if (open) this.map.boxZoom.disable()
    else this.map.boxZoom.enable()
    this.button.classList.toggle('oim-dock-active', open)
    this.button.setAttribute('aria-pressed', String(open))
    if (!open) {
      if (this.viewing) this.backToLive()
      this.paletteMode = null
      if (this.tools.tool.mode !== 'select') this.tools.setTool({ mode: 'select' })
    }
    this.update()
  }

  private action(
    label: string,
    onclick: () => void,
    options: {
      title?: string
      disabled?: boolean
      primary?: boolean
      active?: boolean
      className?: string
    } = {}
  ) {
    const button = el(
      `button.oim-ul-button${options.primary ? '.primary' : ''}${options.active ? '.active' : ''}${options.className ? '.' + options.className : ''}`,
      label,
      { type: 'button', title: options.title ?? '', disabled: options.disabled ?? false }
    ) as HTMLButtonElement
    button.onclick = onclick
    return button
  }

  private async run(label: string, task: () => Promise<void>) {
    this.busy = label
    this.update()
    try {
      await task()
    } catch (e) {
      window.alert(`${label}: ${(e as Error).message ?? e}`)
    } finally {
      this.busy = ''
      this.update()
    }
  }

  update() {
    this.updateToast()
    this.updateTimeline()
    this.updateBanner()
    void this.syncEditor()
    for (const e of [this.sidebar, this.toolbar]) e.classList.toggle('visible', this.isOpen)
    this.picker.classList.toggle('visible', this.isOpen && this.paletteMode !== null && !this.inPlayback)
    if (!this.isOpen) return
    this.updateToolbar()
    this.updateSidebar()
  }

  // --- Keyboard -------------------------------------------------------------------

  private keydown(e: KeyboardEvent) {
    if (!this.isOpen || this.inPlayback) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable]')) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.store.redo()
      else this.store.undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      this.store.redo()
      return
    }
    if (mod || e.altKey) return
    const tool = TOOLS.find(([, , , key]) => key === e.key.toUpperCase())
    if (tool) {
      e.preventDefault()
      this.chooseTool(tool[0])
    }
  }

  // --- Toolbar --------------------------------------------------------------------

  private activeToolId(): string {
    const tool = this.tools.tool
    if (this.paletteMode === 'symbols') return 'symbol'
    if (this.paletteMode === 'graphics') return 'graphic'
    if (tool.mode === 'place') return tool.properties.kind === 'symbol' ? 'symbol' : tool.properties.kind
    if (tool.mode === 'graphic') return 'graphic'
    return tool.mode
  }

  private chooseTool(id: string) {
    const again = this.activeToolId() === id && id !== 'select'
    this.paletteMode = null
    this.tools.setTool({ mode: 'select' })
    if (again) {
      this.update()
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
        this.tools.setTool(
          { mode: id, points: [] },
          tt('userlayers.draw-hint', 'Click to add points; double-click or Enter to finish.')
        )
        break
      case 'marker':
        this.tools.setTool(
          { mode: 'place', properties: { kind: 'marker' } },
          tt('userlayers.marker-hint', 'Click the map to put a marker there.')
        )
        break
      case 'image':
        this.fileInput.click()
        break
      case 'copy':
        this.tools.setTool(
          { mode: 'copy' },
          tt(
            'userlayers.copy-hint',
            'Click lines, substations, sites... to copy them into the layer. They stay visible when their kind is hidden.'
          )
        )
        break
    }
    this.update()
  }

  private updateToolbar() {
    const bar = this.toolbar
    bar.textContent = ''
    const active = this.activeToolId()
    const tools = el(
      '.oim-ul-toolbar-group',
      TOOLS.map(([id, glyph, label, key]) => {
        const b = this.action(glyph, () => this.chooseTool(id), {
          title: `${tt(`userlayers.tool.${id}`, label)} (${key})`,
          active: active === id,
          className: 'oim-ul-tool-icon'
        })
        b.setAttribute('aria-pressed', String(active === id))
        b.setAttribute('aria-label', tt(`userlayers.tool.${id}`, label))
        b.disabled = this.inPlayback || Boolean(this.viewing)
        return b
      })
    )
    // Where new items go.
    const target = el(
      'select.oim-ul-target',
      { title: tt('userlayers.add-to', 'New items go into this layer'), disabled: this.inPlayback },
      [...this.store.layers.values()].map((l) =>
        // A locked layer takes nothing new.
        el('option', l.style.locked ? `🔒 ${l.name}` : l.name, {
          value: l.id,
          selected: l.id === this.store.activeLayer,
          disabled: Boolean(l.style.locked)
        })
      ),
      el('option', `+ ${tt('userlayers.new-layer', 'New layer')}`, {
        value: '',
        selected: !this.store.layers.size
      })
    ) as HTMLSelectElement
    target.onchange = () => {
      if (target.value) {
        this.store.setActive(target.value)
        return
      }
      this.newLayer()
    }
    const undo = this.action('↶', () => this.store.undo(), {
      title: tt('userlayers.undo', 'Undo (Ctrl+Z)'),
      disabled: !this.store.canUndo || this.inPlayback,
      className: 'oim-ul-tool-icon'
    })
    const redo = this.action('↷', () => this.store.redo(), {
      title: tt('userlayers.redo', 'Redo (Ctrl+Shift+Z)'),
      disabled: !this.store.canRedo || this.inPlayback,
      className: 'oim-ul-tool-icon'
    })
    const history = this.action(
      '🕘',
      () => (this.inPlayback ? this.closePlayback() : void this.openPlayback()),
      {
        title: this.inPlayback
          ? tt('userlayers.history-exit', 'Back to now')
          : tt('userlayers.history-open', 'Play back the history'),
        active: this.inPlayback,
        className: 'oim-ul-tool-icon'
      }
    )
    const pending = this.store.unsavedCount
    const save = this.action(
      this.busy ||
        (pending
          ? tt('userlayers.save-n', 'Save ({{count}})', { count: pending })
          : tt('userlayers.saved', 'Saved')),
      () => void this.run(tt('userlayers.saving', 'Saving'), () => this.store.save()),
      {
        primary: pending > 0,
        disabled: !pending || !!this.busy || this.inPlayback,
        title: tt('userlayers.save-title', 'Send your changes to the database (they can then be played back)')
      }
    )
    const more = el(
      'details.oim-ul-menu',
      el('summary', '⋯', { title: tt('userlayers.more', 'More') }),
      el(
        '.oim-ul-menu-items',
        this.action(
          tt('userlayers.discard', 'Discard unsaved changes'),
          () => {
            const message = tt('userlayers.discard-confirm', 'Forget the {{count}} unsaved change(s)?', {
              count: pending
            })
            if (window.confirm(message)) {
              this.tools.select(null)
              void this.run(tt('userlayers.discarding', 'Discarding'), () => this.store.discard())
            }
          },
          { disabled: !pending || !!this.busy }
        )
      )
    )
    bar.append(
      tools,
      el('.oim-ul-toolbar-group', el('span.oim-ul-toolbar-label', tt('userlayers.into', 'Into')), target),
      el('.oim-ul-toolbar-group', undo, redo, history),
      el('.oim-ul-toolbar-group', save, more)
    )
  }

  private newLayer() {
    const value = window.prompt(
      tt('userlayers.layer-name', 'Layer name'),
      tt('userlayers.default-name', 'My layer')
    )
    if (value && value.trim()) this.store.createLayer(value.trim())
    else this.update()
  }

  private async picked(pick: Pick) {
    this.paletteMode = null
    this.update()
    if (!pick.geometry) {
      this.tools.setTool(
        { mode: 'place', properties: { kind: 'symbol', sidc: pick.sidc } },
        tt('userlayers.place-hint', 'Click the map to put "{{name}}" there.', { name: pick.name })
      )
      return
    }
    const lib = await graphicsLibrary()
    const count = pointCount(lib, pick.sidc)
    if (!count) {
      window.alert(
        tt('userlayers.graphic-unsupported', '"{{name}}" can\'t be drawn yet.', { name: pick.name })
      )
      this.update()
      return
    }
    if (isAxis(lib, pick.sidc)) {
      // Arrows: the path from tail to tip; the width has its own handle.
      this.tools.setTool(
        {
          mode: 'graphic',
          properties: { kind: 'graphic', sidc: pick.sidc },
          points: [],
          min: 2,
          max: Infinity,
          axis: true
        },
        tt(
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
        ? tt('userlayers.graphic-hint-fixed', '"{{name}}": click {{n}} points on the map.', {
            name: pick.name,
            n: count.min
          })
        : tt(
            'userlayers.graphic-hint',
            '"{{name}}": click at least {{n}} points; double-click or Enter to finish.',
            {
              name: pick.name,
              n: count.min
            }
          )
    this.tools.setTool(
      { mode: 'graphic', properties: { kind: 'graphic', sidc: pick.sidc }, points: [], min: count.min, max },
      hint
    )
  }

  private async pickedImage() {
    const file = this.fileInput.files?.[0]
    this.fileInput.value = ''
    if (!file) return
    await this.run(tt('userlayers.uploading', 'Uploading the picture'), async () => {
      const { mime, data } = await prepareImage(file)
      const id = await uploadImage(file.name, mime, data)
      this.paletteMode = null
      this.tools.setTool(
        { mode: 'place', properties: { kind: 'image', image: id, name: '' } },
        tt('userlayers.image-hint', 'Click the map to put the picture there.')
      )
    })
  }

  // --- Sidebar (outliner) ------------------------------------------------------------

  // The sidebar is built once (so the outliner's search box keeps its focus); each
  // update refreshes the message and the outliner.
  private sidebarBuilt = false
  private message = el('div')

  private buildSidebar() {
    const close = el('button.oim-panel-button', '×', {
      type: 'button',
      title: tt('userlayers.close', 'Close My layers'),
      'aria-label': tt('userlayers.close', 'Close My layers')
    })
    close.onclick = () => this.toggle(false)
    const level = el(
      'select',
      (
        [
          ['none', tt('userlayers.labels.none', 'None')],
          ['name', tt('userlayers.labels.name', 'Designation only')],
          ['all', tt('userlayers.labels.all', 'All fields')]
        ] as [LabelLevel, string][]
      ).map(([value, label]) => el('option', label, { value, selected: value === getLabelLevel() }))
    ) as HTMLSelectElement
    level.onchange = () => {
      setLabelLevel(level.value as LabelLevel)
      void this.renderer.render(this.store.layers, this.store.hidden)
    }
    const author = el('input.oim-ul-author', {
      type: 'text',
      value: this.store.author,
      placeholder: tt('userlayers.author', 'Your name')
    }) as HTMLInputElement
    author.onchange = () => (this.store.author = author.value.trim())
    this.outline.append(
      this.situationLine,
      this.message,
      this.outliner.el,
      el(
        'details.oim-ul-settings',
        el('summary', tt('userlayers.settings', 'Labels and name')),
        el('label.oim-ul-field', el('span', tt('userlayers.labels-on-map', 'Labels on the map')), level),
        el('label.oim-ul-field', el('span', tt('userlayers.author-label', 'Saved as')), author)
      )
    )
    this.sidebar.append(
      el('.oim-panel-header', el('h2', tt('userlayers.title', 'My layers')), close),
      this.outline,
      this.fileInput
    )
    this.sidebarBuilt = true
  }

  private updateSidebar() {
    if (!this.sidebarBuilt) this.buildSidebar()
    this.message.textContent = ''
    if (!this.store.loaded) {
      this.message.append(el('p.oim-ul-hint', tt('userlayers.loading', 'Loading...')))
      return
    }
    if (this.store.error) {
      this.message.append(
        el(
          'p.oim-ul-error',
          tt(
            'userlayers.error',
            "The backend can't be reached, so layers can't be loaded or saved: {{error}}",
            {
              error: this.store.error
            }
          )
        )
      )
    }
    this.updateSituationLine()
    this.outliner.draw()
  }

  // --- Situations -----------------------------------------------------------------------

  private async loadSituations() {
    try {
      this.situations = await listSituations()
    } catch {
      this.situations = []
    }
    this.situationsLoaded = true
    this.update()
  }

  private updateSituationLine() {
    if (!this.situationsLoaded) {
      this.situationsLoaded = true // once
      void this.loadSituations()
    }
    const options: HTMLElement[] = [
      el('option', tt('userlayers.live', 'Live (now)'), { value: 'live', selected: !this.viewing })
    ]
    for (const s of this.situations) {
      options.push(
        el('option', situationLabel(s), { value: String(s.id), selected: this.viewing?.id === s.id })
      )
    }
    options.push(
      el('option', `+ ${tt('userlayers.save-situation', 'Save now as a situation…')}`, { value: 'save' })
    )
    if (this.viewing)
      options.push(
        el('option', `🗑 ${tt('userlayers.delete-situation', 'Delete this situation')}`, { value: 'delete' })
      )
    const choice = el('select', options, {
      title: tt('userlayers.situation-title', 'A situation is a named moment: your layers as they were then')
    }) as HTMLSelectElement
    choice.onchange = () => void this.chooseSituation(choice.value)
    this.situationLine.replaceChildren(
      el('label', el('span', tt('userlayers.situation', 'Situation')), choice)
    )
  }

  private async chooseSituation(value: string) {
    if (value === 'live') {
      this.backToLive()
      return
    }
    if (value === 'save') {
      const name = window.prompt(
        tt('userlayers.situation-name', 'Name of the situation'),
        tt('userlayers.situation-default', 'Situation {{date}}', { date: new Date().toLocaleString() })
      )
      if (name && name.trim()) {
        // A situation is made of saved changes: offer to save the unsaved ones first.
        const pending = this.store.unsavedCount
        const includePending =
          pending > 0 &&
          window.confirm(
            tt(
              'userlayers.situation-include-pending',
              'Save your {{count}} unsaved change(s) first, so they are in the situation? (Cancel: leave them out.)',
              { count: pending }
            )
          )
        await this.run(tt('userlayers.saving', 'Saving'), async () => {
          if (includePending) await this.store.save()
          await createSituation(name.trim(), this.store.author)
          await this.loadSituations()
        })
      } else this.update()
      return
    }
    if (value === 'delete' && this.viewing) {
      const viewing = this.viewing
      if (
        window.confirm(
          tt(
            'userlayers.delete-situation-confirm',
            'Delete the situation "{{name}}"? (Your layers stay as they are.)',
            { name: viewing.name }
          )
        )
      ) {
        this.backToLive()
        await this.run(tt('userlayers.deleting', 'Deleting'), async () => {
          await deleteSituation(viewing.id)
          await this.loadSituations()
        })
      } else this.update()
      return
    }
    const situation = this.situations.find((s) => String(s.id) === value)
    if (situation) await this.view(situation)
  }

  /** Show the layers as they were at a situation, read-only. */
  private async view(situation: Situation) {
    // Unsaved changes stay as they are: they come back with "Back to live".
    if (this.inPlayback) this.closePlayback()
    await this.run(tt('userlayers.loading', 'Loading...'), async () => {
      await this.playback.load()
      this.playback.position = situationPosition(this.playback.changes, situation)
      const snapshot = this.playback.snapshot()
      this.viewing = situation
      this.tools.setTool({ mode: 'select' })
      this.tools.select(null)
      this.tools.enabled = false
      this.paletteMode = null
      this.outliner.view = snapshot
      await this.renderer.render(snapshot, new Set())
    })
  }

  private backToLive() {
    if (!this.viewing) return
    this.viewing = null
    this.outliner.view = null
    this.tools.enabled = true
    void this.renderer.render(this.store.layers, this.store.hidden)
    this.update()
  }

  private updateBanner() {
    this.banner.classList.toggle('visible', Boolean(this.viewing))
    if (!this.viewing) return
    const back = el('button.oim-ul-button.primary', tt('userlayers.back-to-live', 'Back to live'), {
      type: 'button'
    })
    back.onclick = () => this.backToLive()
    this.banner.replaceChildren(
      el(
        'span',
        '👁 ',
        tt('userlayers.viewing', 'Viewing'),
        ' ',
        el('strong', this.viewing.name),
        ` (${situationLabel(this.viewing).split(' · ').slice(1).join(' · ')}) · `,
        tt('userlayers.read-only', 'read-only')
      ),
      back
    )
  }

  private zoomTo(feature: UserFeature) {
    const coords: [number, number][] = []
    const add = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') coords.push(c as [number, number])
      else if (Array.isArray(c)) c.forEach(add)
    }
    add((feature.geometry as GeoJSON.Point).coordinates)
    if (!coords.length) return
    if (coords.length === 1) {
      this.map.easeTo({ center: coords[0], zoom: Math.max(this.map.getZoom(), 13) })
      return
    }
    const lons = coords.map((c) => c[0])
    const lats = coords.map((c) => c[1])
    this.map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)]
      ],
      { padding: 80, maxZoom: 15 }
    )
  }

  // --- Hint on the map --------------------------------------------------------------

  private updateToast() {
    const tool = this.tools.tool
    let text = this.tools.message
    if (tool.mode === 'graphic' && tool.points.length) {
      text += ' ' + tt('userlayers.points-so-far', '({{n}} so far)', { n: tool.points.length })
    }
    const active = tool.mode !== 'select' && Boolean(text)
    this.toast.textContent = ''
    if (active) {
      const stop = el('button', tt('userlayers.stop', 'Stop (Esc)'), { type: 'button' })
      stop.onclick = () => this.tools.setTool({ mode: 'select' })
      this.toast.append(el('span', text), stop)
    }
    this.toast.classList.toggle('visible', active)
  }

  // --- Inspector: details of the selected item (the left details panel) ----------------

  private async syncEditor() {
    const panel = sidePanel()
    if (!panel) return
    // Several items: one card for all of them.
    const ids = this.inPlayback || this.viewing ? [] : this.tools.selection()
    if (ids.length > 1) {
      const items = ids
        .map((i) => {
          const layer = this.store.layerOf(i)
          const feature = layer?.features.get(i)
          return layer && feature ? { layer, feature } : null
        })
        .filter((x): x is { layer: UserLayer; feature: UserFeature } => x !== null)
      const key = `bulk:${JSON.stringify(items.map((i) => [i.layer.id, i.feature]))}`
      if (key === this.editorKey) return
      this.editorKey = key
      const card = buildBulkCard(items, [...this.store.layers.values()], {
        updateEach: (change) =>
          this.store.updateFeatures(
            items
              .filter((i) => !i.layer.style.locked)
              .map((i) => ({
                layerId: i.layer.id,
                feature: { ...i.feature, properties: change(i.feature.properties) }
              }))
              .filter((c): c is { layerId: string; feature: UserFeature } => c.feature.properties !== null)
          ),
        moveTo: (layerId) =>
          this.store.moveFeatures(
            items.filter((i) => !i.layer.style.locked && i.layer.id !== layerId).map((i) => i.feature.id),
            layerId
          ),
        remove: () => {
          if (
            window.confirm(
              tt('userlayers.delete-n', 'Delete these {{count}} items?', { count: items.length })
            )
          )
            this.tools.deleteSelected()
        },
        clear: () => this.tools.select(null)
      })
      panel.show(card, () => {
        if (this.editorKey === key) {
          this.editorKey = null
          this.tools.select(null)
        }
      })
      foldRoute()
      return
    }
    const id = this.inPlayback || this.viewing ? null : this.tools.selected
    const layer = id ? this.store.layerOf(id) : undefined
    const feature = id ? layer?.features.get(id) : undefined
    if (!id || !layer || !feature) {
      if (this.editorKey) {
        this.editorKey = null
        panel.close()
      }
      return
    }
    const key = `${id}:${layer.id}:${JSON.stringify(feature)}`
    if (key === this.editorKey) return
    this.editorKey = key
    // Keep the focus where it was (each change rebuilds the editor).
    const focused = (document.activeElement as HTMLElement | null)?.getAttribute?.('data-field')
    const editor = await buildEditor(feature, layer, [...this.store.layers.values()], {
      update: (properties) => this.store.updateFeature(layer.id, { ...feature, properties }),
      moveTo: (layerId) => this.store.moveFeature(id, layerId),
      duplicate: () => this.duplicate(layer.id, feature),
      remove: () => this.tools.deleteSelected(),
      done: () => this.tools.select(null)
    })
    if (this.editorKey !== key) return // something newer
    if (layer.style.locked) {
      // A locked layer's items can be looked at, not changed.
      editor
        .querySelectorAll<HTMLButtonElement | HTMLInputElement>('input, select, textarea, button')
        .forEach((c) => {
          if (!c.classList.contains('primary')) c.disabled = true
        })
      editor.insertBefore(
        el(
          'p.oim-ul-locked-note',
          tt('userlayers.locked-note', '🔒 In a locked layer: unlock it in the list to change this.')
        ),
        editor.children[1] ?? null
      )
    }
    panel.show(editor, () => {
      // Closed (×, Esc) or replaced by another feature's details: deselect.
      if (this.editorKey === key) {
        this.editorKey = null
        this.tools.select(null)
      }
    })
    foldRoute()
    if (focused) editor.querySelector<HTMLElement>(`[data-field="${CSS.escape(focused)}"]`)?.focus()
  }

  /** A copy of an item, a little to the side, selected. */
  private duplicate(layerId: string, feature: UserFeature) {
    // 24 px to the right and down, whatever the zoom.
    const centre = geometryCentre(feature.geometry)
    const p = this.map.project(centre)
    const moved = this.map.unproject([p.x + 24, p.y + 24])
    const geometry = translateGeometry(feature.geometry, moved.lng - centre[0], moved.lat - centre[1])
    const id = this.store.addFeature(layerId, geometry, structuredClone(feature.properties))
    this.tools.select(id)
  }

  // --- History ----------------------------------------------------------------------

  private async openPlayback() {
    if (this.store.unsavedCount) {
      window.alert(
        tt(
          'userlayers.history-save-first',
          'Save or discard your changes first: the history only has saved ones.'
        )
      )
      return
    }
    await this.run(tt('userlayers.history-loading', 'Loading the history'), async () => {
      await this.playback.load()
      this.inPlayback = true
      this.tools.setTool({ mode: 'select' })
      this.tools.select(null)
      this.tools.enabled = false
      this.paletteMode = null
      this.playback.position = 0
      await this.showStep()
    })
  }

  private async showStep() {
    const snapshot = this.playback.snapshot()
    await this.renderer.render(snapshot, new Set())
    this.renderer.select(this.playback.feature())
    if (this.follow) this.playback.follow()
    this.update()
  }

  private closePlayback() {
    this.playback.stop()
    this.inPlayback = false
    this.tools.enabled = true
    this.renderer.select(null)
    void this.renderer.render(this.store.layers, this.store.hidden)
    this.update()
  }

  private updateTimeline() {
    this.timeline.classList.toggle('visible', this.inPlayback)
    this.timeline.textContent = ''
    if (!this.inPlayback) return
    const pb = this.playback
    const total = pb.changes.length
    const go = (position: number) => () => {
      pb.stop()
      pb.position = Math.max(0, Math.min(total, position))
      void this.showStep()
    }
    const slider = el('input.oim-ul-slider', {
      type: 'range',
      min: '0',
      max: String(total),
      step: '1',
      value: String(pb.position),
      'aria-label': tt('userlayers.step', 'Step')
    }) as HTMLInputElement
    slider.oninput = () => go(Number(slider.value))()
    const play = this.action(
      pb.playing ? '⏸' : '▶',
      () => {
        if (pb.playing) pb.stop()
        else pb.play(() => void this.showStep())
        this.update()
      },
      { primary: true, title: pb.playing ? tt('userlayers.pause', 'Pause') : tt('userlayers.play', 'Play') }
    )
    const speed = el(
      'select',
      { title: tt('userlayers.speed', 'Speed') },
      [0.5, 1, 2, 4].map((s) => el('option', `${s}×`, { value: String(s), selected: s === pb.speed }))
    ) as HTMLSelectElement
    speed.onchange = () => {
      pb.speed = Number(speed.value)
      if (pb.playing) pb.play(() => void this.showStep())
    }
    const follow = el('input', { type: 'checkbox', checked: this.follow }) as HTMLInputElement
    follow.onchange = () => (this.follow = follow.checked)
    const close = this.action('×', () => this.closePlayback(), {
      title: tt('userlayers.history-exit', 'Back to now'),
      className: 'oim-ul-icon'
    })
    this.timeline.append(
      el(
        '.oim-ul-timeline-controls',
        this.action('⏮', go(0), { title: tt('userlayers.first', 'Start') }),
        this.action('◀', go(pb.position - 1), { title: tt('userlayers.previous', 'Previous change') }),
        play,
        this.action('▶|', go(pb.position + 1), { title: tt('userlayers.next', 'Next change') }),
        this.action('⏭', go(total), { title: tt('userlayers.last', 'Now') }),
        speed,
        slider,
        close
      ),
      el(
        '.oim-ul-timeline-text',
        el(
          'span.oim-ul-step',
          total ? pb.describe(pb.snapshot()) : tt('userlayers.history-empty', 'Nothing saved yet.')
        ),
        el('label.oim-ul-inline', follow, tt('userlayers.follow', 'Follow on the map'))
      )
    )
  }
}
