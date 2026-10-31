// Fork: the left column, under the search box (or under the header when the
// search box is in the top bar): panels stacked in a fixed order, whichever
// module adds them and whenever. Also the one details panel and the highlight
// that go with it, for every module (details.ts, highlight.ts).
//
//   leftColumn.add(element, order)       a panel at its place (lower = higher up)
//   leftColumn.details / .highlight      show something in the details panel
//
// Places: 10 My layers' sidebar, 20 the details panel, 22 the features picked with
// Shift-click, 25 the selected circuit, 30 the grid route.
import { IControl, Map } from 'maplibre-gl'
import { DetailsPanel } from './details.ts'
import { FeatureHighlight } from './highlight.ts'

export const LEFT_ORDER = { sidebar: 10, details: 20, selection: 22, circuit: 25, route: 30 } as const

class LeftColumn {
  private map?: Map
  private _details?: DetailsPanel
  private _highlight?: FeatureHighlight

  /** Once the map exists (fork/index.ts, before the modules start). */
  attach(map: Map) {
    this.map = map
    this._details = new DetailsPanel()
    this.addControl(this._details, LEFT_ORDER.details)
    this._highlight = new FeatureHighlight(map)
  }

  get details(): DetailsPanel {
    if (!this._details) throw new Error('leftColumn.attach() first')
    return this._details
  }

  get highlight(): FeatureHighlight {
    if (!this._highlight) throw new Error('leftColumn.attach() first')
    return this._highlight
  }

  /** A map control (IControl) in the column, at its place. */
  addControl(control: IControl, order: number) {
    this.map!.addControl(control, 'top-left')
    const container = (control as unknown as { _container?: HTMLElement })._container
    if (container) this.add(container, order)
  }

  /** An element in the column, at its place. */
  add(element: HTMLElement, order: number) {
    const column = this.map?.getContainer().querySelector('.maplibregl-ctrl-top-left')
    if (!column) return
    element.dataset.leftOrder = String(order)
    // Before the first panel that goes lower; elements without a place (the
    // search box on narrow screens) stay on top.
    const next = [...column.children].find(
      (child) => child !== element && Number((child as HTMLElement).dataset.leftOrder ?? -1) > order
    )
    column.insertBefore(element, next ?? null)
  }
}

export const leftColumn = new LeftColumn()
