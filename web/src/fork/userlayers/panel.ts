// Fork: the "My layers" panel, docked on the right (fork/ui/dock.ts): tabs Layers /
// Add / History, and a save bar while there are unsaved changes. Around the map: a
// hint at the bottom while a tool is in use, the history timeline at the bottom
// while playing back, and the selected item's details in the left side panel
// (editor.ts).
import { tt } from './i18n.ts'
import { dock } from '../ui/dock.ts'
import { el } from 'redom'
import { IControl, Map } from 'maplibre-gl'
import { Store } from './store.ts'
import { Tools } from './tools.ts'
import { Renderer } from './render.ts'
import { Palette, Pick, PaletteMode, symbolName } from './palette.ts'
import { Playback } from './history.ts'
import { uploadImage } from './api.ts'
import { DEFAULT_COLOR, UserFeature } from './model.ts'
import { buildEditor } from './editor.ts'
import { graphicsLibrary, isAxis, pointCount } from './graphics.ts'
import { getLabelLevel, setLabelLevel } from './symbols.ts'
import { LabelLevel } from './fields.ts'
import { sidePanel } from '../grid/index.ts'
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

type Tab = 'layers' | 'add' | 'history'

/** What a feature is, in a few words (the layer's item list). */
function featureLabel(feature: UserFeature): string {
  const p = feature.properties
  const name = p.modifiers?.['T'] || p.name
  const what =
    p.kind === 'symbol' || p.kind === 'graphic'
      ? (symbolName(p.sidc ?? '') ?? p.sidc ?? '')
      : p.kind === 'copy'
        ? tt('userlayers.copy-of-short', 'Copy: {{layer}}', { layer: p.copy?.layer ?? '' })
        : tt(`userlayers.kind.${p.kind}`, p.kind)
  return name ? `${name} · ${what}` : what
}

export class Panel implements IControl {
  private map: Map
  private store: Store
  private tools: Tools
  private renderer: Renderer
  private playback: Playback
  private container!: HTMLElement
  private button!: HTMLButtonElement
  private panel: HTMLElement
  private tabs: HTMLElement
  private body: HTMLElement
  private footer: HTMLElement
  private toast: HTMLElement
  private timeline: HTMLElement
  private palette: Palette
  private fileInput: HTMLInputElement
  private tab: Tab = 'layers'
  private paletteMode: PaletteMode | null = null
  private expanded = new Set<string>()
  private inPlayback = false
  private follow = true
  private busy = ''
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
    this.tabs = el('.oim-ul-tabs', { role: 'tablist' })
    this.body = el('.oim-ul-body')
    this.footer = el('.oim-ul-footer')
    const close = el('button.oim-ul-close', '×', {
      type: 'button',
      title: tt('userlayers.close', 'Close'),
      'aria-label': tt('userlayers.close', 'Close')
    })
    close.onclick = () => this.toggle(false)
    this.panel = el(
      '.oim-ul-panel',
      el('.oim-ul-header', el('h2', tt('userlayers.title', 'My layers')), close),
      this.tabs,
      this.body,
      this.footer,
      this.fileInput
    )
    this.toast = el('.oim-ul-toast', { role: 'status' })
    this.timeline = el('.oim-ul-timeline')
    store.onChange(() => this.update())
    tools.onChange(() => this.update())
  }

  onAdd(): HTMLElement {
    this.button = el('button.maplibregl-ctrl-icon.oim-ul-control', {
      title: tt('userlayers.title', 'My layers'),
      ariaLabel: tt('userlayers.title', 'My layers')
    }) as HTMLButtonElement
    this.container = el('div.maplibregl-ctrl.maplibregl-ctrl-group', this.button)
    this.map.getContainer().append(this.toast, this.timeline)
    // Opens next to the buttons on the right, like the layers and the key.
    dock.add(this.button, this.panel, () => this.update())
    this.update()
    return this.container
  }

  onRemove() {
    this.container.remove()
    this.panel.remove()
    this.toast.remove()
    this.timeline.remove()
  }

  toggle(open = !this.panel.classList.contains('visible')) {
    this.panel.classList.toggle('visible', open)
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
    void this.syncEditor()
    if (!this.panel.classList.contains('visible')) return
    this.updateTabs()
    this.updateFooter()
    const body = this.body
    body.textContent = ''
    if (!this.store.loaded) {
      body.append(el('p.oim-ul-hint', tt('userlayers.loading', 'Loading...')))
      return
    }
    if (this.store.error) {
      body.append(
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
    if (this.tab === 'layers') body.append(this.layersTab())
    else if (this.tab === 'add') body.append(this.addTab())
    else body.append(this.historyTab())
  }

  // --- Tabs -------------------------------------------------------------------

  private updateTabs() {
    this.tabs.textContent = ''
    const labels: [Tab, string][] = [
      ['layers', tt('userlayers.tab.layers', 'Layers')],
      ['add', tt('userlayers.tab.add', 'Add')],
      ['history', tt('userlayers.tab.history', 'History')]
    ]
    for (const [tab, label] of labels) {
      const button = el(`button.oim-ul-tab${tab === this.tab ? '.active' : ''}`, label, {
        type: 'button',
        role: 'tab',
        'aria-selected': String(tab === this.tab),
        disabled: this.inPlayback && tab !== 'history'
      }) as HTMLButtonElement
      button.onclick = () => {
        this.tab = tab
        if (tab !== 'add') this.paletteMode = null
        this.update()
      }
      this.tabs.append(button)
    }
  }

  // --- Layers tab -------------------------------------------------------------

  private layersTab(): HTMLElement {
    const list = el('ul.oim-ul-layers')
    for (const layer of this.store.layers.values()) {
      const hidden = this.store.hidden.has(layer.id)
      const eye = this.action(hidden ? '◌' : '◉', () => this.store.setHidden(layer.id, !hidden), {
        title: hidden ? tt('userlayers.show', 'Show on the map') : tt('userlayers.hide', 'Hide from the map'),
        className: 'oim-ul-icon'
      })
      const color = el('input.oim-ul-color', {
        type: 'color',
        value: layer.style.color ?? DEFAULT_COLOR,
        title: tt('userlayers.layer-color', 'Colour of its drawings and markers')
      }) as HTMLInputElement
      color.onchange = () =>
        this.store.updateLayer(layer.id, { style: { ...layer.style, color: color.value } })
      const active = layer.id === this.store.activeLayer
      const name = el(
        'button.oim-ul-layer-name',
        el('span', layer.name),
        active ? el('small.oim-ul-active-tag', tt('userlayers.active', 'adding here')) : '',
        {
          type: 'button',
          title: tt('userlayers.make-active', 'Add new items to this layer')
        }
      )
      name.onclick = () => this.store.setActive(layer.id)
      const open = this.expanded.has(layer.id)
      const expand = this.action(
        `${open ? '▾' : '▸'} ${layer.features.size}`,
        () => {
          if (open) this.expanded.delete(layer.id)
          else this.expanded.add(layer.id)
          this.update()
        },
        { title: tt('userlayers.items', 'Show its items'), className: 'oim-ul-count' }
      )
      const menu = el(
        'details.oim-ul-menu',
        el('summary', '⋯', { title: tt('userlayers.more', 'More') }),
        el(
          '.oim-ul-menu-items',
          this.action(tt('userlayers.rename', 'Rename'), () => {
            const value = window.prompt(tt('userlayers.rename', 'Rename'), layer.name)
            if (value && value.trim() && value.trim() !== layer.name)
              this.store.updateLayer(layer.id, { name: value.trim() })
          }),
          this.action(tt('userlayers.delete', 'Delete'), () => {
            const message = tt(
              'userlayers.delete-layer',
              'Delete the layer "{{name}}" and its {{count}} item(s)?',
              {
                name: layer.name,
                count: layer.features.size
              }
            )
            if (window.confirm(message)) {
              this.tools.select(null)
              this.store.deleteLayer(layer.id)
            }
          })
        )
      )
      const items = open
        ? el(
            'ul.oim-ul-items',
            [...layer.features.values()].map((f) => {
              const item = el(
                `li${f.id === this.tools.selected ? '.selected' : ''}`,
                el('button', featureLabel(f), { type: 'button' })
              )
              item.onclick = () => {
                this.tools.select(f.id)
                this.zoomTo(f)
              }
              return item
            })
          )
        : ''
      list.append(
        el(`li${active ? '.active' : ''}`, el('.oim-ul-layer-row', eye, color, name, expand, menu), items)
      )
    }
    const create = this.action(`+ ${tt('userlayers.new-layer', 'New layer')}`, () => {
      const value = window.prompt(
        tt('userlayers.layer-name', 'Layer name'),
        tt('userlayers.default-name', 'My layer')
      )
      if (value && value.trim()) this.store.createLayer(value.trim())
    })
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
    return el(
      'div',
      this.store.layers.size
        ? list
        : el(
            'p.oim-ul-hint',
            tt('userlayers.no-layers', 'No layer yet: make one, or just start adding things.')
          ),
      el('.oim-ul-row', create),
      el('label.oim-ul-field.oim-ul-labels', el('span', tt('userlayers.labels', 'Labels on the map')), level)
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

  // --- Add tab ----------------------------------------------------------------

  private addTab(): HTMLElement {
    const mode = this.tools.tool.mode
    const kind = this.tools.tool.mode === 'place' ? this.tools.tool.properties.kind : null
    const tool = (glyph: string, label: string, active: boolean, onclick: () => void, title = '') =>
      this.action(`${glyph} ${label}`, onclick, { active, title, className: 'oim-ul-tool' })
    const stop = () => {
      this.paletteMode = null
      this.tools.setTool({ mode: 'select' })
    }
    const openPalette = (paletteMode: PaletteMode) => {
      const closing = this.paletteMode === paletteMode
      stop()
      if (!closing) {
        this.paletteMode = paletteMode
        void this.palette.open(paletteMode)
      }
      this.update()
    }
    const tools = el(
      '.oim-ul-toolgrid',
      tool(
        '⬚',
        tt('userlayers.tool.symbol', 'Symbol'),
        this.paletteMode === 'symbols' || kind === 'symbol',
        () => openPalette('symbols'),
        tt('userlayers.tool.symbol-title', 'Military and emergency symbols (as in ODIN)')
      ),
      tool(
        '➚',
        tt('userlayers.tool.graphic', 'Graphic'),
        this.paletteMode === 'graphics' || mode === 'graphic',
        () => openPalette('graphics'),
        tt('userlayers.tool.graphic-title', 'Tactical graphics: axes, phase lines, areas, tasks...')
      ),
      tool(
        '🖼',
        tt('userlayers.tool.image', 'Picture'),
        kind === 'image',
        () => this.fileInput.click(),
        tt('userlayers.tool.image-title', 'Put your own picture or icon on the map')
      ),
      tool('📍', tt('userlayers.tool.marker', 'Marker'), kind === 'marker', () => {
        stop()
        this.tools.setTool(
          { mode: 'place', properties: { kind: 'marker' } },
          tt('userlayers.marker-hint', 'Click the map to put a marker there.')
        )
      }),
      tool('╱', tt('userlayers.tool.line', 'Line'), mode === 'line', () => {
        stop()
        this.tools.setTool(
          { mode: 'line', points: [] },
          tt('userlayers.draw-hint', 'Click to add points; double-click or Enter to finish.')
        )
      }),
      tool('▱', tt('userlayers.tool.area', 'Area'), mode === 'area', () => {
        stop()
        this.tools.setTool(
          { mode: 'area', points: [] },
          tt('userlayers.draw-hint', 'Click to add points; double-click or Enter to finish.')
        )
      }),
      tool(
        '⧉',
        tt('userlayers.tool.copy', 'Copy from map'),
        mode === 'copy',
        () => {
          stop()
          this.tools.setTool(
            { mode: 'copy' },
            tt(
              'userlayers.copy-hint',
              'Click lines, substations, sites... to copy them into the layer. They stay visible when their kind is hidden.'
            )
          )
        },
        tt(
          'userlayers.tool.copy-title',
          'Copy map features (power lines, substations, sites...) into the layer'
        )
      )
    )
    // Where new items go.
    const target = el(
      'select',
      [...this.store.layers.values()].map((l) =>
        el('option', l.name, { value: l.id, selected: l.id === this.store.activeLayer })
      ),
      el('option', `+ ${tt('userlayers.new-layer', 'New layer')}`, { value: '' })
    ) as HTMLSelectElement
    target.onchange = () => {
      if (target.value) {
        this.store.setActive(target.value)
        return
      }
      const value = window.prompt(
        tt('userlayers.layer-name', 'Layer name'),
        tt('userlayers.default-name', 'My layer')
      )
      if (value && value.trim()) this.store.createLayer(value.trim())
      else this.update()
    }
    return el(
      'div',
      this.store.layers.size
        ? el('label.oim-ul-field', el('span', tt('userlayers.add-to', 'Add to')), target)
        : el('p.oim-ul-hint', tt('userlayers.first-layer', 'A layer is made for the first thing you add.')),
      tools,
      this.paletteMode ? this.palette.el : ''
    )
  }

  private async picked(pick: Pick) {
    this.paletteMode = null
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
      // Arrows: the path from tail to tip; the width follows (and has a handle).
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
          '"{{name}}": click where the arrow starts, then along its path, and double-click (or Enter) where it points to. Its width follows its length.',
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

  // --- Hint on the map --------------------------------------------------------

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

  // --- Save bar ---------------------------------------------------------------

  private updateFooter() {
    const pending = this.store.pending.length
    this.footer.textContent = ''
    this.footer.classList.toggle('visible', Boolean(pending || this.busy) && !this.inPlayback)
    if (!pending && !this.busy) return
    const save = this.action(
      tt('userlayers.save', 'Save'),
      () => void this.run(tt('userlayers.saving', 'Saving'), () => this.store.save()),
      {
        primary: true,
        disabled: !pending || !!this.busy,
        title: tt('userlayers.save-title', 'Send your changes to the database (they can then be played back)')
      }
    )
    const discard = this.action(
      tt('userlayers.discard', 'Discard'),
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
    this.footer.append(
      el(
        'span.oim-ul-status',
        this.busy || tt('userlayers.unsaved', '{{count}} unsaved change(s)', { count: pending })
      ),
      discard,
      save
    )
  }

  // --- Details of the selected item (left side panel) ---------------------------

  private async syncEditor() {
    const panel = sidePanel()
    if (!panel) return
    const id = this.inPlayback ? null : this.tools.selected
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
      remove: () => this.tools.deleteSelected(),
      done: () => this.tools.select(null)
    })
    if (this.editorKey !== key) return // something newer
    panel.show(editor, () => {
      // Closed (×, Esc) or replaced by another feature's details: deselect.
      if (this.editorKey === key) {
        this.editorKey = null
        this.tools.select(null)
      }
    })
    if (focused) editor.querySelector<HTMLElement>(`[data-field="${CSS.escape(focused)}"]`)?.focus()
  }

  // --- History ----------------------------------------------------------------

  private historyTab(): HTMLElement {
    const author = el('input.oim-ul-author', {
      type: 'text',
      value: this.store.author,
      placeholder: tt('userlayers.author', 'Your name')
    }) as HTMLInputElement
    author.onchange = () => (this.store.author = author.value.trim())
    const authorRow = el('label.oim-ul-field', el('span', tt('userlayers.author-label', 'Saved as')), author)
    if (this.inPlayback) {
      return el(
        'div',
        el(
          'p.oim-ul-hint',
          tt('userlayers.playing', 'Playing back the history: use the bar at the bottom of the map.')
        ),
        this.action(tt('userlayers.history-exit', 'Back to now'), () => this.closePlayback(), {
          primary: true
        })
      )
    }
    return el(
      'div',
      el(
        'p',
        tt(
          'userlayers.history-intro',
          'Every saved change is kept. Play them back step by step to see how the layers came to be.'
        )
      ),
      this.action(tt('userlayers.history-open', 'Play back the history'), () => void this.openPlayback(), {
        primary: true
      }),
      authorRow
    )
  }

  private async openPlayback() {
    if (this.store.pending.length) {
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
