// Fork: "My layers": layers people make on the map, saved in the database
// (web-backend/src/fork/userdata.py) with a history that can be played back.
// They can hold military and emergency symbols (MIL-STD-2525C, as in ODINv2),
// pictures, markers, drawings, and copies of map features, which are drawn like
// the originals and stay visible when the originals are hidden.
import { userLayersShortcuts } from './shortcuts.ts'
import { onLive } from '../../services/live.ts'
import { connectSightPanel } from './measure/sight-panel.ts'
import { findFeature } from './state/reconcile.ts'
import { ForkModule } from '../../types.ts'
import { Store } from './state/store.ts'
import { Renderer } from './map/render.ts'
import { Tools } from './map/tools.ts'
import { Workspace } from './ui/workspace.ts'
import { Interactions } from './map/interactions.ts'
import { addLegend } from '../../services/legend.ts'
import { userLegend } from './map/legend.ts'
import { mapMode } from '../../services/map-mode.ts'
import { layerOrder, sortLayers } from './ui/outliner/order.ts'
import { LngLatBounds } from 'maplibre-gl'

const userlayers: ForkModule = {
  shortcuts: userLayersShortcuts,
  init: ({ map, primaryLayers }) => {
    const store = new Store()
    connectSightPanel(map, {
      item: (id) => findFeature(store.layers, id)?.feature,
      onChange: (listener) => store.onChange(listener)
    })
    const renderer = new Renderer(map, primaryLayers)
    // The layers are drawn in the list's order (yours: state/personal.ts).
    renderer.orderOf = () => layerOrder([...store.layers.values()], store.personal)
    renderer.canEditItem = (feature) => store.view.canEditItem(store.layerOf(feature.id), feature)
    const tools = new Tools(map, store, renderer, primaryLayers)
    const workspace = new Workspace(map, store, tools, renderer)
    map.addControl(workspace, 'top-right')
    const interactions = new Interactions(map, store, tools, renderer, () => workspace.isOpen)
    workspace.itemMenu = (feature, layerId) => interactions.itemMenu(feature, layerId)

    // Clicks My layers handles (its features, or a tool in use) don't open
    // upstream's info popups.
    mapMode.claimClicks((e) => tools.capturesClick(e))

    store.onChange(() => {
      // While the past is shown (history, a situation), the live layers wait.
      renderer.conflicted = new Set(
        store.conflicts.filter((c) => c.key.startsWith('feature:')).map((c) => c.key.slice('feature:'.length))
      )
      if (store.view.live) void renderer.render(store.layers, store.hidden)
      // The selection may have been deleted or changed.
      tools.refreshSelection()
    })
    // On a printed map: each layer shown, with what of it is in the printed area
    // (in the list's order).
    addLegend((map, area) => {
      const corners = [
        map.unproject([area.x, area.y]),
        map.unproject([area.x + area.w, area.y]),
        map.unproject([area.x, area.y + area.h]),
        map.unproject([area.x + area.w, area.y + area.h])
      ]
      const bounds = new LngLatBounds(corners[0], corners[0])
      for (const c of corners) bounds.extend(c)
      const layers = sortLayers(
        [...(store.view.past ?? store.layers).values()].filter(
          (l) => store.view.past || !store.hidden.has(l.id)
        ),
        layerOrder([...store.layers.values()], store.personal)
      )
      return userLegend(layers, bounds)
    })
    void store.load()
    void store.personal.load()
    // Others' saved changes, as they come (docs/plans/archive/sync.md, phase 4).
    onLive('changes', () => void store.refresh())
    onLive('access', () => void store.refresh())
  }
}

export default userlayers
