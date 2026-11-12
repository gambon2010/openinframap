// Fork: "My layers": layers people make on the map, saved in the database
// (web-backend/src/fork/userdata.py) with a history that can be played back.
// They can hold military and emergency symbols (MIL-STD-2525C, as in ODINv2),
// pictures, markers, drawings, and copies of map features, which are drawn like
// the originals and stay visible when the originals are hidden.
import { onLive } from '../../services/live.ts'
import { ForkModule } from '../../types.ts'
import { Store } from './state/store.ts'
import { Renderer } from './map/render.ts'
import { Tools } from './map/tools.ts'
import { copyFeature } from './map/tools/copy.ts'
import { addDetailsExtra } from '../../ui/details.ts'
import { el, mount } from 'redom'
import { t } from '../../core/i18n.ts'
import { Workspace } from './ui/workspace.ts'
import { Interactions } from './map/interactions.ts'
import { addLegend } from '../../services/legend.ts'
import { userLegend } from './map/legend.ts'
import { mapMode } from '../../services/map-mode.ts'
import { layerOrder, sortLayers } from './ui/outliner/order.ts'
import { LngLatBounds } from 'maplibre-gl'

const userlayers: ForkModule = {
  init: ({ map, primaryLayers }) => {
    const store = new Store()
    const renderer = new Renderer(map, primaryLayers)
    // The layers are drawn in the list's order (yours: state/personal.ts).
    renderer.orderOf = () => layerOrder([...store.layers.values()], store.personal)
    const tools = new Tools(map, store, renderer, primaryLayers)
    const workspace = new Workspace(map, store, tools, renderer)
    map.addControl(workspace, 'top-right')
    new Interactions(map, store, tools, renderer, () => workspace.isOpen)

    // Clicks My layers handles (its features, or a tool in use) don't open
    // upstream's info popups.
    mapMode.claimClicks((e) => tools.capturesClick(e))

    // A map feature's details (a line, a substation, a building...): copy it into
    // the layer you draw into, as the copy tool does.
    addDetailsExtra((feature, content) => {
      if (!feature.sourceLayer || feature.layer.id.startsWith('user_')) return
      const active = store.activeLayer ? store.layers.get(store.activeLayer) : undefined
      const into = active && store.view.canEdit(active) ? active.name : null
      const button = el(
        'button.oim-button',
        into
          ? t('userlayers.copy.into', 'Copy into “{{layer}}”', { layer: into })
          : t('userlayers.copy.into-new', 'Copy into My layers'),
        { type: 'button', title: t('userlayers.copy.into-help', 'Into the layer you draw into (My layers)') }
      ) as HTMLButtonElement
      button.disabled = !tools.enabled
      button.onclick = async () => {
        const done = await copyFeature(tools, feature)
        const layer = store.layers.get(tools.activeLayer())
        button.textContent =
          done === 'already'
            ? t('userlayers.copy.already-in', 'Already in “{{layer}}”', { layer: layer?.name ?? '' })
            : t('userlayers.copy.copied-into', 'Copied into “{{layer}}”', { layer: layer?.name ?? '' })
        button.disabled = true
      }
      mount(content, el('div.oim-route-buttons', button))
    })

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
    // Others' saved changes, as they come (docs/plans/sync.md, phase 4).
    onLive('changes', () => void store.refresh())
    onLive('access', () => void store.refresh())
  }
}

export default userlayers
