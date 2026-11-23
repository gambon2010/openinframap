// Fork: while the Print window is open, a frame on the map shows what will be printed
// (layout.ts printedArea: the paper's map's shape, as big as fits); the rest is
// dimmed. The map can still be moved and zoomed under it.
import type { Map } from 'maplibre-gl'
import { el } from 'redom'
import { Box } from './layout.ts'

export class PrintFrame {
  private el = el('.oim-print-frame')
  private map: Map
  private area: () => Box | null

  /** `area`: the printed area for the map's size now (null: no frame). */
  constructor(map: Map, area: (width: number, height: number) => Box | null) {
    this.map = map
    this.area = () => {
      const canvas = map.getCanvas()
      return area(canvas.clientWidth, canvas.clientHeight)
    }
    map.on('resize', () => this.update())
  }

  show() {
    if (!this.el.parentElement) this.map.getContainer().append(this.el)
    this.update()
  }

  hide() {
    this.el.remove()
  }

  update() {
    const box = this.area()
    if (!box || !this.el.parentElement) return
    Object.assign(this.el.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.w}px`,
      height: `${box.h}px`
    })
  }
}
