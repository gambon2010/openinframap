// Fork: "My layers": layers people make on the map, saved in the database
// (web-backend/src/fork/userdata.py) with a history that can be played back.
// They can hold military and emergency symbols (MIL-STD-2525C, as in ODINv2),
// pictures, markers, drawings, and copies of map features, which are drawn like
// the originals and stay visible when the originals are hidden.
import { MapMouseEvent } from 'maplibre-gl'
import { onLive } from '../../ui/live.ts'
import { ForkModule } from '../../types.ts'
import { Store } from './state/store.ts'
import { Renderer } from './map/render.ts'
import { Tools } from './map/tools.ts'
import { Workspace } from './ui/workspace.ts'
import { Interactions } from './map/interactions.ts'

const userlayers: ForkModule = {
  init: ({ map, clickRouter, primaryLayers }) => {
    const store = new Store()
    const renderer = new Renderer(map, primaryLayers)
    // Arrows drawn with four free points are turned into paths (an unsaved change each).
    renderer.onOldArrow = (layerId, feature) => {
      queueMicrotask(() => {
        if (store.layers.get(layerId)?.features.get(feature.id)?.properties.axis) return
        store.updateFeature(layerId, feature)
        if (tools.selected === feature.id) tools.select(feature.id)
      })
    }
    const tools = new Tools(map, store, renderer, primaryLayers)
    const workspace = new Workspace(map, store, tools, renderer)
    map.addControl(workspace, 'top-right')
    new Interactions(map, store, tools, renderer, () => workspace.isOpen)

    // Clicks My layers handles (its features, or a tool in use) don't open
    // upstream's info popups. The click router calls handleClick for every click
    // on its layers; wrapping it here keeps click-router.ts as upstream has it.
    const router = clickRouter as unknown as { handleClick: (e: MapMouseEvent) => void }
    const handleClick = router.handleClick.bind(clickRouter)
    router.handleClick = (e) => {
      if (!tools.capturesClick(e)) handleClick(e)
    }

    store.onChange(() => {
      // While the past is shown (history, a situation), the live layers wait.
      renderer.conflicted = new Set(
        store.conflicts.filter((c) => c.key.startsWith('feature:')).map((c) => c.key.slice('feature:'.length))
      )
      if (store.view.live) void renderer.render(store.layers, store.hidden)
      // The selection may have been deleted or changed.
      tools.refreshSelection()
    })
    void store.load()
    // Others' saved changes, as they come (docs/plans/sync.md, phase 4).
    onLive('changes', () => void store.refresh())
    onLive('access', () => void store.refresh())
  }
}

export default userlayers
