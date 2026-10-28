// Fork: "My layers": layers people make on the map, saved in the database
// (web-backend/src/fork/userdata.py) with a history that can be played back.
// They can hold military and emergency symbols (MIL-STD-2525C, as in ODINv2),
// pictures, markers, drawings, and copies of map features, which are drawn like
// the originals and stay visible when the originals are hidden.
import { MapMouseEvent } from 'maplibre-gl'
import { ForkModule } from '../types.ts'
import { Store } from './store.ts'
import { Renderer } from './render.ts'
import { Tools } from './tools.ts'
import { Panel } from './panel.ts'

const userlayers: ForkModule = {
  init: ({ map, clickRouter, primaryLayers }) => {
    const store = new Store()
    const renderer = new Renderer(map, primaryLayers)
    const tools = new Tools(map, store, renderer, primaryLayers)
    const panel = new Panel(map, store, tools, renderer)
    map.addControl(panel, 'top-right')

    // Clicks My layers handles (its features, or a tool in use) don't open
    // upstream's info popups. The click router calls handleClick for every click
    // on its layers; wrapping it here keeps click-router.ts as upstream has it.
    const router = clickRouter as unknown as { handleClick: (e: MapMouseEvent) => void }
    const handleClick = router.handleClick.bind(clickRouter)
    router.handleClick = (e) => {
      if (!tools.capturesClick(e)) handleClick(e)
    }

    store.onChange(() => {
      void renderer.render(store.layers, store.hidden)
      // The selection may have been deleted or changed.
      if (tools.selected) tools.select(store.layerOf(tools.selected) ? tools.selected : null)
    })
    void store.load()
  }
}

export default userlayers
