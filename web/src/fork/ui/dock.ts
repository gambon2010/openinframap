// Fork: the panels opened from the buttons on the right of the map (layers, key,
// My layers) open on click, next to the buttons rather than over them, and one
// at a time. A panel is open when it has the class "visible", whoever sets it
// (its button, its own close button), so upstream's panels need no changes.
import { Map } from 'maplibre-gl'
import { el } from 'redom'
import './panel.css'

interface Docked {
  button: HTMLElement
  panel: HTMLElement
  onOpen?: () => void
}

class Dock {
  el: HTMLElement = el('.oim-dock')
  private docked: Docked[] = []
  private map?: Map

  attach(map: Map) {
    this.map = map
    map.getContainer().append(this.el)
    // Leave room for the buttons on the right (their column can change width).
    const place = () => {
      const column = map.getContainer().querySelector('.maplibregl-ctrl-top-right')
      if (column) this.el.style.right = `${column.getBoundingClientRect().width + 6}px`
    }
    map.on('resize', place)
    requestAnimationFrame(place)
  }

  /** Dock a panel: its button opens and closes it. */
  add(button: HTMLElement, panel: HTMLElement, onOpen?: () => void) {
    const entry = { button, panel, onOpen }
    this.docked.push(entry)
    // The panel's own inline position (upstream sets one) no longer applies.
    panel.style.top = panel.style.right = panel.style.left = ''
    this.el.append(panel)
    // Capture phase, so upstream's own click handler on the button doesn't run first.
    button.addEventListener(
      'click',
      (event) => {
        event.stopImmediatePropagation()
        event.preventDefault()
        this.toggle(entry)
      },
      true
    )
    new MutationObserver(() => this.sync(entry)).observe(panel, {
      attributes: true,
      attributeFilter: ['class']
    })
    this.sync(entry)
  }

  private toggle(entry: Docked) {
    entry.panel.classList.toggle('visible')
  }

  private sync(entry: Docked) {
    const open = entry.panel.classList.contains('visible')
    entry.button.classList.toggle('oim-dock-active', open)
    entry.button.setAttribute('aria-expanded', String(open))
    if (!open) return
    for (const other of this.docked) {
      if (other !== entry) other.panel.classList.remove('visible')
    }
    if (this.map) entry.panel.style.maxHeight = `${this.map.getContainer().clientHeight - 20}px`
    entry.onOpen?.()
  }
}

export const dock = new Dock()
