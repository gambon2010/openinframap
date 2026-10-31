// Fork: statuses of map features (docs/plans/feature-status.md, step 1): set in a
// feature's details (details.ts), shown on the map when they're a problem (map.ts).
// Backend: web-backend/src/fork/userdata/status.py.
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import { addDetailsExtra } from '../../ui/details.ts'
import { StatusMap, badgeImage, statusLayers, statusSources } from './map.ts'
import { StatusSection, featureKey } from './details.ts'
import { PROBLEMS, statusLook } from './statuses.ts'
import './status.css'

function badgeSwatch(status: (typeof PROBLEMS)[number]): HTMLElement {
  const image = badgeImage(status)
  if (!image) return el('span')
  const canvas = el('canvas', { width: image.width, height: image.height }) as HTMLCanvasElement
  canvas.getContext('2d')?.putImageData(image, 0, 0)
  canvas.style.width = canvas.style.height = '18px'
  return canvas
}

const status: ForkModule = {
  sources: statusSources,
  layers: statusLayers,

  switcherGroups: () => [
    new LayerGroup(t('layers.status-group', 'Statuses'), [
      new Layer('K', t('layers.status', 'Damage and threats'), 'status_', true)
    ])
  ],

  init: (ctx) => {
    // The statuses are drawn over features: a click goes to the feature underneath.
    for (const layer of statusLayers()) delete ctx.clickRouter.handlers[layer.id]
    const statusMap = new StatusMap(ctx.map)
    const load = () => void statusMap.refresh()
    if (ctx.map.isStyleLoaded()) load()
    else ctx.map.once('load', load)

    addDetailsExtra(async (feature, content) => {
      const key = featureKey(feature)
      if (!key) return
      const section = new StatusSection(key.layer, key.id, feature.properties['name'], load)
      if (!(await section.load()) || !content.isConnected) return
      content.insertBefore(section.el, content.querySelector('.oim-info-footer'))
    })
  },

  key: async () => [
    {
      title: t('layers.status', 'Damage and threats'),
      rows: PROBLEMS.map((s) => [statusLook(s).label, badgeSwatch(s)])
    }
  ]
}

export default status
