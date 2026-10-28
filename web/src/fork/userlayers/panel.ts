// Fork: the "My layers" panel: layers, tools, the symbol palette, the selected
// feature, Save, and the history player.
import { tt } from './i18n.ts'
import { el } from 'redom'
import { IControl, Map } from 'maplibre-gl'
import { Store } from './store.ts'
import { Tools } from './tools.ts'
import { Renderer } from './render.ts'
import { Palette, symbolName } from './palette.ts'
import { Playback } from './history.ts'
import { uploadImage } from './api.ts'
import { DEFAULT_COLOR, FeatureProps } from './model.ts'
import './userlayers.css'

const MAX_IMAGE_SIZE = 256

/** A picture, scaled down to at most 256 px, as base64 (for the backend). */
async function prepareImage(file: File): Promise<{ mime: string; data: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    // Photos as JPEG; anything that may be transparent as PNG.
    const mime = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const dataUrl = canvas.toDataURL(mime, 0.85)
    return { mime, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  } finally {
    URL.revokeObjectURL(url)
  }
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
  private body: HTMLElement
  private palette: Palette
  private fileInput: HTMLInputElement
  private paletteOpen = false
  private inPlayback = false
  private follow = true
  private busy = ''

  constructor(map: Map, store: Store, tools: Tools, renderer: Renderer) {
    this.map = map
    this.store = store
    this.tools = tools
    this.renderer = renderer
    this.playback = new Playback(map)
    this.palette = new Palette((sidc, name) => {
      this.paletteOpen = false
      this.tools.setTool(
        { mode: 'place', properties: { kind: 'symbol', sidc, name: '' } },
        tt('userlayers.place-hint', 'Click the map to put "{{name}}" there.', { name })
      )
    })
    this.fileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/svg+xml'
    }) as HTMLInputElement
    this.fileInput.style.display = 'none'
    this.fileInput.onchange = () => void this.pickedImage()
    this.body = el('.oim-ul-body')
    const close = el('button.oim-ul-close', '×', { title: tt('userlayers.close', 'Close') })
    close.onclick = () => this.toggle(false)
    this.panel = el(
      '.oim-ul-panel',
      el('.oim-ul-header', el('h2', tt('userlayers.title', 'My layers')), close),
      this.body,
      this.fileInput
    )
    store.onChange(() => this.update())
    tools.onChange(() => this.update())
  }

  onAdd(): HTMLElement {
    this.button = el('button.maplibregl-ctrl-icon.oim-ul-control', {
      title: tt('userlayers.title', 'My layers'),
      ariaLabel: tt('userlayers.title', 'My layers')
    }) as HTMLButtonElement
    this.button.onclick = () => this.toggle()
    this.map.getContainer().append(this.panel)
    this.container = el('div.maplibregl-ctrl.maplibregl-ctrl-group', this.button)
    this.update()
    return this.container
  }

  onRemove() {
    this.container.remove()
    this.panel.remove()
  }

  toggle(open = !this.panel.classList.contains('visible')) {
    this.panel.classList.toggle('visible', open)
    this.button.classList.toggle('active', open)
    if (open) this.update()
  }

  private action(
    label: string,
    onclick: () => void,
    options: { title?: string; disabled?: boolean; primary?: boolean; active?: boolean } = {}
  ) {
    const button = el(
      `button.oim-ul-button${options.primary ? '.primary' : ''}${options.active ? '.active' : ''}`,
      label,
      {
        type: 'button',
        title: options.title ?? '',
        disabled: options.disabled ?? false
      }
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
    if (!this.panel.classList.contains('visible')) return
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
            { error: this.store.error }
          )
        )
      )
    }
    if (this.inPlayback) {
      body.append(this.playbackSection())
      return
    }
    body.append(this.saveSection(), this.layersSection())
    if (this.store.layers.size || this.store.activeLayer === null) body.append(this.toolsSection())
    if (this.paletteOpen) body.append(this.palette.el)
    const selected = this.selectedSection()
    if (selected) body.append(selected)
  }

  private saveSection(): HTMLElement {
    const pending = this.store.pending.length
    const status = this.busy
      ? this.busy
      : pending
        ? tt('userlayers.unsaved', '{{count}} unsaved change(s), kept in this browser until saved', {
            count: pending
          })
        : tt('userlayers.saved', 'Everything is saved')
    const author = el('input.oim-ul-author', {
      type: 'text',
      value: this.store.author,
      placeholder: tt('userlayers.author', 'Your name (saved with your changes)')
    }) as HTMLInputElement
    author.onchange = () => (this.store.author = author.value.trim())
    return el(
      '.oim-ul-section.oim-ul-savebar',
      el(
        '.oim-ul-row',
        this.action(
          tt('userlayers.save', 'Save'),
          () => void this.run(tt('userlayers.saving', 'Saving'), () => this.store.save()),
          {
            primary: true,
            disabled: !pending || !!this.busy,
            title: tt(
              'userlayers.save-title',
              'Send your changes to the database (they can then be played back)'
            )
          }
        ),
        this.action(
          tt('userlayers.discard', 'Discard'),
          () => {
            if (
              window.confirm(
                tt('userlayers.discard-confirm', 'Forget the {{count}} unsaved change(s)?', {
                  count: pending
                })
              )
            ) {
              void this.run(tt('userlayers.discarding', 'Discarding'), () => this.store.discard())
            }
          },
          { disabled: !pending || !!this.busy }
        ),
        this.action(tt('userlayers.history', 'History'), () => void this.openPlayback(), {
          title: tt('userlayers.history-title', 'Play back the saved changes, step by step')
        })
      ),
      el('p.oim-ul-status', status),
      author
    )
  }

  private layersSection(): HTMLElement {
    const list = el('ul.oim-ul-layers')
    for (const layer of this.store.layers.values()) {
      const visible = el('input', {
        type: 'checkbox',
        checked: !this.store.hidden.has(layer.id),
        title: tt('userlayers.show', 'Show on the map')
      }) as HTMLInputElement
      visible.onchange = () => this.store.setHidden(layer.id, !visible.checked)
      const color = el('input.oim-ul-color', {
        type: 'color',
        value: layer.style.color ?? DEFAULT_COLOR,
        title: tt('userlayers.layer-color', 'Colour of its drawings and markers')
      }) as HTMLInputElement
      color.onchange = () =>
        this.store.updateLayer(layer.id, { style: { ...layer.style, color: color.value } })
      const name = el('button.oim-ul-layer-name', `${layer.name} (${layer.features.size})`, {
        type: 'button',
        title: tt('userlayers.make-active', 'New features go into this layer')
      })
      name.onclick = () => this.store.setActive(layer.id)
      const rename = this.action(
        '✎',
        () => {
          const value = window.prompt(tt('userlayers.rename', 'Layer name'), layer.name)
          if (value && value.trim() && value.trim() !== layer.name)
            this.store.updateLayer(layer.id, { name: value.trim() })
        },
        { title: tt('userlayers.rename', 'Rename') }
      )
      const remove = this.action(
        '🗑',
        () => {
          if (
            window.confirm(
              tt('userlayers.delete-layer', 'Delete the layer "{{name}}" and its {{count}} feature(s)?', {
                name: layer.name,
                count: layer.features.size
              })
            )
          ) {
            this.tools.select(null)
            this.store.deleteLayer(layer.id)
          }
        },
        { title: tt('userlayers.delete', 'Delete') }
      )
      list.append(
        el(`li${layer.id === this.store.activeLayer ? '.active' : ''}`, visible, color, name, rename, remove)
      )
    }
    const create = this.action(`+ ${tt('userlayers.new-layer', 'New layer')}`, () => {
      const value = window.prompt(
        tt('userlayers.rename', 'Layer name'),
        tt('userlayers.default-name', 'My layer')
      )
      if (value && value.trim()) this.store.createLayer(value.trim())
    })
    return el(
      '.oim-ul-section',
      el('h3', tt('userlayers.layers', 'Layers')),
      this.store.layers.size
        ? list
        : el(
            'p.oim-ul-hint',
            tt('userlayers.no-layers', 'No layer yet: make one, or just start adding things.')
          ),
      create
    )
  }

  private toolsSection(): HTMLElement {
    const mode = this.tools.tool.mode
    const symbol = this.action(
      tt('userlayers.tool.symbol', 'Symbol'),
      () => {
        this.paletteOpen = !this.paletteOpen
        this.tools.setTool({ mode: 'select' })
        if (this.paletteOpen) void this.palette.open()
      },
      {
        active:
          this.paletteOpen ||
          (mode === 'place' &&
            this.tools.tool.mode === 'place' &&
            this.tools.tool.properties.kind === 'symbol'),
        title: tt('userlayers.tool.symbol-title', 'Military and emergency symbols (as in ODIN)')
      }
    )
    const picture = this.action(tt('userlayers.tool.image', 'Picture'), () => this.fileInput.click(), {
      title: tt('userlayers.tool.image-title', 'Put your own picture or icon on the map')
    })
    const marker = this.action(
      tt('userlayers.tool.marker', 'Marker'),
      () => {
        this.paletteOpen = false
        this.tools.setTool(
          { mode: 'place', properties: { kind: 'marker' } },
          tt('userlayers.marker-hint', 'Click the map to put a marker there.')
        )
      },
      {
        active:
          mode === 'place' && this.tools.tool.mode === 'place' && this.tools.tool.properties.kind === 'marker'
      }
    )
    const line = this.action(
      tt('userlayers.tool.line', 'Line'),
      () => {
        this.paletteOpen = false
        this.tools.setTool(
          { mode: 'line', points: [] },
          tt('userlayers.draw-hint', 'Click to add points; double-click or Enter to finish, Esc to cancel.')
        )
      },
      { active: mode === 'line' }
    )
    const area = this.action(
      tt('userlayers.tool.area', 'Area'),
      () => {
        this.paletteOpen = false
        this.tools.setTool(
          { mode: 'area', points: [] },
          tt('userlayers.draw-hint', 'Click to add points; double-click or Enter to finish, Esc to cancel.')
        )
      },
      { active: mode === 'area' }
    )
    const copy = this.action(
      tt('userlayers.tool.copy', 'Copy from map'),
      () => {
        this.paletteOpen = false
        this.tools.setTool(
          { mode: 'copy' },
          tt(
            'userlayers.copy-hint',
            'Click lines, substations, sites... to copy them into the layer (Esc to stop). They stay visible when their kind is hidden.'
          )
        )
      },
      {
        active: mode === 'copy',
        title: tt(
          'userlayers.tool.copy-title',
          'Copy map features (power lines, substations, sites...) into the layer'
        )
      }
    )
    const active = this.store.activeLayer ? this.store.layers.get(this.store.activeLayer)?.name : null
    return el(
      '.oim-ul-section',
      el(
        'h3',
        active ? tt('userlayers.add-to', 'Add to "{{name}}"', { name: active }) : tt('userlayers.add', 'Add')
      ),
      el('.oim-ul-tools', symbol, picture, marker, line, area, copy),
      this.tools.message ? el('p.oim-ul-hint', this.tools.message) : ''
    )
  }

  private async pickedImage() {
    const file = this.fileInput.files?.[0]
    this.fileInput.value = ''
    if (!file) return
    await this.run(tt('userlayers.uploading', 'Uploading the picture'), async () => {
      const { mime, data } = await prepareImage(file)
      const id = await uploadImage(file.name, mime, data)
      this.paletteOpen = false
      this.tools.setTool(
        { mode: 'place', properties: { kind: 'image', image: id, name: '' } },
        tt('userlayers.image-hint', 'Click the map to put the picture there.')
      )
    })
  }

  private selectedSection(): HTMLElement | null {
    const id = this.tools.selected
    if (!id) return null
    const layer = this.store.layerOf(id)
    const feature = layer?.features.get(id)
    if (!layer || !feature) return null
    const p = feature.properties
    const update = (changes: Partial<FeatureProps>) =>
      this.store.updateFeature(layer.id, { ...feature, properties: { ...p, ...changes } })

    const name = el('input', {
      type: 'text',
      value: p.name ?? '',
      placeholder: tt('userlayers.name', 'Name or label')
    }) as HTMLInputElement
    name.onchange = () => update({ name: name.value.trim() || undefined })
    const rows: (HTMLElement | string)[] = [el('label', tt('userlayers.name', 'Name or label'), name)]

    if (p.kind === 'symbol' || p.kind === 'image' || p.kind === 'marker') {
      const size = el('input', {
        type: 'range',
        min: '0.4',
        max: '3',
        step: '0.1',
        value: String(p.size ?? 1)
      }) as HTMLInputElement
      size.onchange = () => update({ size: Number(size.value) })
      rows.push(el('label', tt('userlayers.size', 'Size'), size))
    }
    if (p.kind === 'drawing' || p.kind === 'marker') {
      const color = el('input', {
        type: 'color',
        value: p.color ?? layer.style.color ?? DEFAULT_COLOR
      }) as HTMLInputElement
      color.onchange = () => update({ color: color.value })
      rows.push(el('label', tt('userlayers.color', 'Colour'), color))
    }
    if (p.kind === 'drawing' && feature.geometry.type !== 'Point') {
      const width = el('input', {
        type: 'range',
        min: '1',
        max: '12',
        step: '1',
        value: String(p.width ?? 3)
      }) as HTMLInputElement
      width.onchange = () => update({ width: Number(width.value) })
      rows.push(el('label', tt('userlayers.width', 'Line width'), width))
    }
    const what =
      p.kind === 'symbol'
        ? (symbolName(p.sidc ?? '') ?? p.sidc)
        : p.kind === 'copy'
          ? tt('userlayers.copy-of', 'Copy of a map feature ({{layer}})', { layer: p.copy?.layer })
          : tt(`userlayers.kind.${p.kind}`, p.kind)
    return el(
      '.oim-ul-section.oim-ul-selected',
      el('h3', tt('userlayers.selected', 'Selected')),
      el('p.oim-ul-what', String(what ?? '')),
      ...rows,
      feature.geometry.type === 'Point'
        ? el('p.oim-ul-hint', tt('userlayers.drag-hint', 'Drag it to move it.'))
        : '',
      el(
        '.oim-ul-row',
        this.action(tt('userlayers.delete', 'Delete'), () => this.tools.deleteSelected()),
        this.action(tt('userlayers.deselect', 'Done'), () => this.tools.select(null))
      )
    )
  }

  // History player

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
      this.paletteOpen = false
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

  private playbackSection(): HTMLElement {
    const pb = this.playback
    const total = pb.changes.length
    const slider = el('input.oim-ul-slider', {
      type: 'range',
      min: '0',
      max: String(total),
      step: '1',
      value: String(pb.position)
    }) as HTMLInputElement
    slider.oninput = () => {
      pb.stop()
      pb.position = Number(slider.value)
      void this.showStep()
    }
    const go = (position: number) => () => {
      pb.stop()
      pb.position = Math.max(0, Math.min(total, position))
      void this.showStep()
    }
    const play = this.action(
      pb.playing ? '⏸' : '▶',
      () => {
        if (pb.playing) {
          pb.stop()
          this.update()
        } else {
          pb.play(() => void this.showStep())
          this.update()
        }
      },
      { primary: true, title: pb.playing ? tt('userlayers.pause', 'Pause') : tt('userlayers.play', 'Play') }
    )
    const follow = el('input', { type: 'checkbox', checked: this.follow }) as HTMLInputElement
    follow.onchange = () => (this.follow = follow.checked)
    return el(
      '.oim-ul-section.oim-ul-playback',
      el('h3', tt('userlayers.history', 'History')),
      total
        ? el(
            'div',
            slider,
            el(
              '.oim-ul-row',
              this.action('⏮', go(0), { title: tt('userlayers.first', 'Start') }),
              this.action('◀', go(pb.position - 1), { title: tt('userlayers.previous', 'Previous change') }),
              play,
              this.action('▶|', go(pb.position + 1), { title: tt('userlayers.next', 'Next change') }),
              this.action('⏭', go(total), { title: tt('userlayers.last', 'Now') })
            ),
            el('p.oim-ul-step', pb.describe(pb.snapshot())),
            el('label.oim-ul-inline', follow, tt('userlayers.follow', 'Move the map to each change'))
          )
        : el('p.oim-ul-hint', tt('userlayers.history-empty', 'Nothing saved yet.')),
      this.action(tt('userlayers.history-exit', 'Back to now'), () => this.closePlayback(), {
        primary: !total
      })
    )
  }
}
