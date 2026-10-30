// Fork: playing back My layers' history (history.ts): a timeline at the bottom of
// the map, step by step or played, the map showing each step (read-only,
// store.view) and following the item it changed.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { action } from './buttons.ts'
import type { Workspace } from './workspace.ts'

export class Timeline {
  readonly el = el('.oim-ul-timeline')
  private follow = true
  private ws: Workspace

  constructor(ws: Workspace) {
    this.ws = ws
  }

  async open() {
    const { store, tools, playback } = this.ws
    if (store.unsavedCount) {
      window.alert(
        t(
          'userlayers.history-save-first',
          'Save or discard your changes first: the history only has saved ones.'
        )
      )
      return
    }
    await this.ws.run(t('userlayers.history-loading', 'Loading the history'), async () => {
      await playback.load()
      tools.setTool({ mode: 'select' })
      tools.select(null)
      store.view.showPlayback()
      this.ws.toolbar.closePicker()
      playback.position = 0
      await this.showStep()
    })
  }

  private async showStep() {
    const { playback, renderer } = this.ws
    const snapshot = playback.snapshot()
    await renderer.render(snapshot, new Set())
    renderer.select(playback.feature())
    if (this.follow) playback.follow()
    this.ws.update()
  }

  close() {
    const { store, renderer, playback } = this.ws
    playback.stop()
    store.view.goLive()
    renderer.select(null)
    void renderer.render(store.layers, store.hidden)
    this.ws.update()
  }

  update() {
    const inPlayback = this.ws.store.view.mode === 'playback'
    this.el.classList.toggle('visible', inPlayback)
    this.el.textContent = ''
    if (!inPlayback) return
    const pb = this.ws.playback
    const total = pb.changes.length
    const go = (position: number) => () => {
      pb.stop()
      pb.position = Math.max(0, Math.min(total, position))
      void this.showStep()
    }
    const slider = el('input.oim-ul-slider', {
      type: 'range',
      min: '0',
      max: String(total),
      step: '1',
      value: String(pb.position),
      'aria-label': t('userlayers.step', 'Step')
    }) as HTMLInputElement
    slider.oninput = () => go(Number(slider.value))()
    const play = action(
      pb.playing ? '⏸' : '▶',
      () => {
        if (pb.playing) pb.stop()
        else pb.play(() => void this.showStep())
        this.ws.update()
      },
      { primary: true, title: pb.playing ? t('userlayers.pause', 'Pause') : t('userlayers.play', 'Play') }
    )
    const speed = el(
      'select',
      { title: t('userlayers.speed', 'Speed') },
      [0.5, 1, 2, 4].map((s) => el('option', `${s}×`, { value: String(s), selected: s === pb.speed }))
    ) as HTMLSelectElement
    speed.onchange = () => {
      pb.speed = Number(speed.value)
      if (pb.playing) pb.play(() => void this.showStep())
    }
    const follow = el('input', { type: 'checkbox', checked: this.follow }) as HTMLInputElement
    follow.onchange = () => (this.follow = follow.checked)
    const close = action('×', () => this.close(), {
      title: t('userlayers.history-exit', 'Back to now'),
      className: 'oim-ul-icon'
    })
    this.el.append(
      el(
        '.oim-ul-timeline-controls',
        action('⏮', go(0), { title: t('userlayers.first', 'Start') }),
        action('◀', go(pb.position - 1), { title: t('userlayers.previous', 'Previous change') }),
        play,
        action('▶|', go(pb.position + 1), { title: t('userlayers.next', 'Next change') }),
        action('⏭', go(total), { title: t('userlayers.last', 'Now') }),
        speed,
        slider,
        close
      ),
      el(
        '.oim-ul-timeline-text',
        el(
          'span.oim-ul-step',
          total ? pb.describe(pb.snapshot()) : t('userlayers.history-empty', 'Nothing saved yet.')
        ),
        el('label.oim-ul-inline', follow, t('userlayers.follow', 'Follow on the map'))
      )
    )
  }
}
