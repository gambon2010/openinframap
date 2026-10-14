/*
 * Layer switcher that can grey out layers which can't load right now, e.g. the
 * online-only night-lights background when there's no internet connection.
 */
import { LayerSwitcher, Layer } from '@russss/maplibregl-layer-switcher'

export default class OIMLayerSwitcher extends LayerSwitcher {
  // Layer id -> why it's unavailable. Not initialised as a class field: the
  // parent constructor can draw the list before field initialisers run.
  _unavailable?: Record<string, string>

  /** Mark a layer unavailable (with a reason) or available again (null). */
  setUnavailable(layerId: string, reason: string | null) {
    this._unavailable = { ...this._unavailable }
    if (reason) {
      this._unavailable[layerId] = reason
      // If it was selected (e.g. from a saved link), fall back to another
      // layer of the same radio group.
      const layer = this.getLayers().find((l) => l.id === layerId)
      if (layer && this._visible.includes(layerId)) {
        this.setVisibility(layerId, false)
        const fallback = this.getLayers().find(
          (l) => l.groupId && l.groupId === layer.groupId && !this._unavailable?.[l.id]
        )
        if (fallback) this.setVisibility(fallback.id, true)
      }
    } else {
      delete this._unavailable[layerId]
    }
    this._updateList()
  }

  _getLayerElement(item: Parameters<LayerSwitcher['_getLayerElement']>[0]): Node {
    const element = super._getLayerElement(item)
    const reason = item instanceof Layer ? this._unavailable?.[item.id] : undefined
    if (reason && element instanceof HTMLElement) {
      element.classList.add('layer-switcher-unavailable')
      element.title = reason
      const input = element.querySelector('input')
      if (input) input.disabled = true
      const note = document.createElement('span')
      note.className = 'layer-switcher-note'
      note.textContent = ` (${reason})`
      element.querySelector('label')?.appendChild(note)
    }
    return element
  }
}

/** Resolves true if the image at `url` loads within `timeoutMs`. */
export function imageLoads(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = window.setTimeout(() => {
      image.src = ''
      resolve(false)
    }, timeoutMs)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve(true)
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      resolve(false)
    }
    image.src = url
  })
}
