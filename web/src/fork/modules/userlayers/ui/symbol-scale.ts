// Fork: a layer's symbol scale (its menu: "Symbol scale…"): a slider in fixed steps,
// the same size at every zoom at its left end, then the map scales of SCALE_STEPS
// (map/scale.ts draws them). Opened on a layer drawn the same size at every zoom, it
// turns it to scale at once, on the step nearest the map's scale now. Each step chosen
// is one change of the layer (undoable, shared).
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { showModal } from '../../../ui/panel.ts'
import type { UserLayer } from '../model/model.ts'
import type { Store } from '../state/store.ts'
import { nearestStep, scaleLabel } from '../map/scale.ts'
import { SCALE_STEPS } from '../map/scale.constants.ts'

/** Opens the slider for a layer; `mapScale`: the map's scale now (1:n). */
export function openSymbolScale(store: Store, layer: UserLayer, mapScale: number) {
  const scale = layer.style.symbolScale ?? nearestStep(mapScale)
  const choose = (symbolScale: number | undefined) =>
    store.updateLayer(layer.id, { style: { ...layer.style, symbolScale } })
  if (layer.style.symbolScale === undefined) choose(scale)
  // Position 0: the same size at every zoom; then each step.
  const slider = el('input.oim-ul-scale-slider', {
    type: 'range',
    min: 0,
    max: SCALE_STEPS.length,
    step: 1,
    value: SCALE_STEPS.indexOf(scale) + 1,
    'aria-label': t('userlayers.symbol-scale', 'Symbol scale')
  }) as HTMLInputElement
  const shown = el('strong.oim-ul-scale-value')
  const describe = () => {
    const position = Number(slider.value)
    shown.textContent =
      position === 0
        ? t('userlayers.scale-none', 'Same size at every zoom')
        : t('userlayers.scale-at', 'As their size at {{scale}}', {
            scale: scaleLabel(SCALE_STEPS[position - 1])
          })
  }
  describe()
  slider.oninput = describe
  slider.onchange = () => {
    const position = Number(slider.value)
    choose(position === 0 ? undefined : SCALE_STEPS[position - 1])
  }
  const ticks = el(
    '.oim-ul-scale-ticks',
    el('span', t('userlayers.scale-tick-off', 'Off')),
    ...SCALE_STEPS.map((step) => el('span', scaleLabel(step).replace(' 000', 'k')))
  )
  showModal(
    t('userlayers.symbol-scale-of', 'Symbol scale: {{layer}}', { layer: layer.name }),
    el(
      'p.oim-ul-hint',
      t(
        'userlayers.symbol-scale-help',
        'To scale, its symbols shrink as you zoom out and grow as you zoom in (up to 8 times), as on a paper map at that scale; too small, they become dots. The map is at {{now}}.',
        { now: scaleLabel(Math.round(mapScale)) }
      )
    ),
    shown,
    slider,
    ticks
  )
}
