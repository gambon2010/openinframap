// Fork: upstream's "Selected circuit" panel (circuit/circuitinspector.ts), opened
// with "View" in a substation's circuits, goes in the left column below the
// details instead of the bottom right corner, and the details stay open. If both
// don't fit, the details shrink (they scroll) to leave the circuit room
// (--oim-circuit-height, details.css). Showing another feature's details closes it.
import type { CircuitInspector } from '../../../circuit/circuitinspector.ts'
import { DetailsPanel } from '../../ui/details.ts'
import { LEFT_ORDER, leftColumn } from '../../ui/left-column.ts'
import './circuit.css'

export function circuitBelowDetails(inspector: CircuitInspector, details: DetailsPanel) {
  const map = inspector._map.getContainer()
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      map.style.setProperty('--oim-circuit-height', `${(entry.target as HTMLElement).offsetHeight}px`)
    }
  })

  // Upstream mounts and unmounts its panel on the map's container: put it back
  // there before upstream removes it.
  const giveBack = () => {
    const panel = inspector._container?.el
    if (panel && panel.parentNode !== map) {
      resize.unobserve(panel)
      map.style.removeProperty('--oim-circuit-height')
      map.appendChild(panel)
    }
  }

  const show = inspector.show.bind(inspector)
  inspector.show = async (id: number) => {
    giveBack()
    await show(id)
    const panel = inspector._container?.el
    if (!panel) return
    panel.classList.add('maplibregl-ctrl', 'oim-circuit-panel')
    leftColumn.add(panel, LEFT_ORDER.circuit)
    resize.observe(panel)
  }

  const hide = inspector.hide.bind(inspector)
  inspector.hide = () => {
    giveBack()
    hide()
  }

  details.onShow(() => {
    if (inspector._container) inspector.hide()
  })
}
