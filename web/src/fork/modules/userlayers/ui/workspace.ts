// Fork: the "My layers" workspace (docs/plans/my-layers-v3.md), opened by its button
// on the right. It puts together:
// - the sidebar in the left column (sidebar.ts: situations, the list of layers and
//   items, settings); the details panel below it shows the selected item's card
//   (inspector.ts);
// - the toolbar at the top of the map (toolbar.ts) and the symbol picker under it;
// - the hint at the bottom while a tool is in use (toast.ts), the history timeline
//   (timeline.ts) and the banner while a situation is shown (situations.ts);
// - the keyboard shortcuts.
// What's shown and what may be changed is the store's view (state/view.ts).
import { el } from 'redom'
import { IControl, Map } from 'maplibre-gl'
import { t } from '../../../core/i18n.ts'
import { LEFT_ORDER, leftColumn } from '../../../ui/left-column.ts'
import { Store } from '../state/store.ts'
import { Tools } from '../map/tools.ts'
import { Renderer } from '../map/render.ts'
import { Playback } from '../state/playback.ts'
import { Inspector } from './inspector.ts'
import { Sidebar } from './sidebar.ts'
import { Situations } from './situations.ts'
import { Timeline } from './timeline.ts'
import { Toast } from './toast.ts'
import { TOOLS, Toolbar } from './toolbar.ts'
import './userlayers.css'

const OPEN_KEY = 'oim-userlayers-open'

export class Workspace implements IControl {
  readonly map: Map
  readonly store: Store
  readonly tools: Tools
  readonly renderer: Renderer
  readonly playback: Playback
  readonly toolbar: Toolbar
  readonly sidebar: Sidebar
  readonly situations: Situations
  readonly timeline: Timeline
  private toast: Toast
  private inspector: Inspector
  private container!: HTMLElement
  private button!: HTMLButtonElement
  /** What's being done ("Saving"), shown on the Save button. */
  busy = ''
  isOpen = false

  constructor(map: Map, store: Store, tools: Tools, renderer: Renderer) {
    this.map = map
    this.store = store
    this.tools = tools
    this.renderer = renderer
    this.playback = new Playback(map)
    this.toolbar = new Toolbar(this)
    this.situations = new Situations(this)
    this.timeline = new Timeline(this)
    this.sidebar = new Sidebar(this)
    this.toast = new Toast(this)
    this.inspector = new Inspector(this)
    store.onChange(() => this.update())
    tools.onChange(() => this.update())
    document.addEventListener('keydown', (e) => this.keydown(e))
  }

  onAdd(): HTMLElement {
    this.button = el('button.maplibregl-ctrl-icon.oim-ul-control', {
      type: 'button',
      title: t('userlayers.title', 'My layers'),
      'aria-label': t('userlayers.title', 'My layers')
    }) as HTMLButtonElement
    this.button.onclick = () => this.toggle()
    this.container = el('div.maplibregl-ctrl.maplibregl-ctrl-group', this.button)
    const toolbar = this.toolbar.el
    this.map
      .getContainer()
      .append(toolbar, this.toolbar.picker, this.toast.el, this.timeline.el, this.situations.banner)
    // Its half width, so the CSS can keep it clear of the search box.
    new ResizeObserver(() =>
      this.map
        .getContainer()
        .style.setProperty('--oim-ul-toolbar-half', `${Math.ceil(toolbar.offsetWidth / 2)}px`)
    ).observe(toolbar)
    // In the left column, above the details panel.
    leftColumn.add(this.sidebar.el, LEFT_ORDER.sidebar)
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
    for (const e of [
      this.container,
      this.sidebar.el,
      this.toolbar.el,
      this.toolbar.picker,
      this.toast.el,
      this.timeline.el,
      this.situations.banner
    ])
      e.remove()
  }

  toggle(open = !this.isOpen) {
    this.isOpen = open
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    } catch {
      // Not remembered.
    }
    // Shift-click selects several items (and, closed, map features: modules/status),
    // so the map's Shift-drag zoom, which would swallow it, stays off.
    this.map.boxZoom.disable()
    this.button.classList.toggle('oim-dock-active', open)
    this.button.setAttribute('aria-pressed', String(open))
    if (!open) {
      this.situations.backToLive()
      this.toolbar.closePicker()
      if (this.tools.tool.mode !== 'select') this.tools.setTool({ mode: 'select' })
    }
    this.update()
  }

  /** Run a task with its name on the Save button; an error is shown to the user. */
  async run(label: string, task: () => Promise<void>) {
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

  /** Draw everything again from the store and the tools. */
  update() {
    this.toast.update()
    this.timeline.update()
    this.situations.updateBanner()
    void this.inspector.sync()
    this.toolbar.update()
    this.sidebar.update()
  }

  /** Ask for a name and make a layer (in a folder). */
  newLayer(folder?: string) {
    const value = window.prompt(
      t('userlayers.layer-name', 'Layer name'),
      t('userlayers.default-name', 'My layer')
    )
    if (value && value.trim()) this.store.createLayer(value.trim(), folder)
    else this.update()
  }

  private keydown(e: KeyboardEvent) {
    if (!this.isOpen || !this.store.view.live) return
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
      this.toolbar.chooseTool(tool[0])
    }
  }
}
