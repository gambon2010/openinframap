// Fork: situations in My layers' sidebar: a selector (live, a saved situation,
// save now as one, delete) and, while one is shown, a banner over the map with
// "Back to live". A situation is shown read-only (store.view).
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { Situation, createSituation, deleteSituation, listSituations } from '../state/api.ts'
import { situationLabel, situationPosition } from '../model/situations.ts'
import type { Workspace } from './workspace.ts'

export class Situations {
  /** The selector, in the sidebar. */
  readonly line = el('.oim-ul-situation')
  /** "Viewing … · read-only · Back to live", over the map. */
  readonly banner = el('.oim-ul-banner', { role: 'status' })
  private situations: Situation[] = []
  private loaded = false
  private ws: Workspace

  constructor(ws: Workspace) {
    this.ws = ws
  }

  private get viewing(): Situation | null {
    return this.ws.store.view.situation
  }

  private async load() {
    try {
      this.situations = await listSituations()
    } catch {
      this.situations = []
    }
    this.loaded = true
    this.ws.update()
  }

  updateLine() {
    if (!this.loaded) {
      this.loaded = true // once
      void this.load()
    }
    const options: HTMLElement[] = [
      el('option', t('userlayers.live', 'Live (now)'), { value: 'live', selected: !this.viewing })
    ]
    for (const s of this.situations) {
      options.push(
        el('option', situationLabel(s), { value: String(s.id), selected: this.viewing?.id === s.id })
      )
    }
    options.push(
      el('option', `+ ${t('userlayers.save-situation', 'Save now as a situation…')}`, { value: 'save' })
    )
    if (this.viewing)
      options.push(
        el('option', `🗑 ${t('userlayers.delete-situation', 'Delete this situation')}`, { value: 'delete' })
      )
    const choice = el('select', options, {
      title: t('userlayers.situation-title', 'A situation is a named moment: your layers as they were then')
    }) as HTMLSelectElement
    choice.onchange = () => void this.choose(choice.value)
    this.line.replaceChildren(el('label', el('span', t('userlayers.situation', 'Situation')), choice))
  }

  private async choose(value: string) {
    const { store } = this.ws
    if (value === 'live') {
      this.backToLive()
      return
    }
    if (value === 'save') {
      const name = window.prompt(
        t('userlayers.situation-name', 'Name of the situation'),
        t('userlayers.situation-default', 'Situation {{date}}', { date: new Date().toLocaleString() })
      )
      if (name && name.trim()) {
        // A situation is made of saved changes: offer to save the unsaved ones first.
        const pending = store.unsavedCount
        const includePending =
          pending > 0 &&
          window.confirm(
            t(
              'userlayers.situation-include-pending',
              'Save your {{count}} unsaved change(s) first, so they are in the situation? (Cancel: leave them out.)',
              { count: pending }
            )
          )
        await this.ws.run(t('userlayers.saving', 'Saving'), async () => {
          if (includePending) await store.save()
          // The layers shown on the map (saved ones: the server knows them).
          const shown = [...store.layers.values()]
            .filter((l) => !store.hidden.has(l.id) && l.access !== undefined)
            .map((l) => l.id)
          await createSituation(name.trim(), shown, store.author)
          await this.load()
        })
      } else this.ws.update()
      return
    }
    if (value === 'delete' && this.viewing) {
      const viewing = this.viewing
      if (
        window.confirm(
          t(
            'userlayers.delete-situation-confirm',
            'Delete the situation "{{name}}"? (Your layers stay as they are.)',
            { name: viewing.name }
          )
        )
      ) {
        this.backToLive()
        await this.ws.run(t('userlayers.deleting', 'Deleting'), async () => {
          await deleteSituation(viewing.id)
          await this.load()
        })
      } else this.ws.update()
      return
    }
    const situation = this.situations.find((s) => String(s.id) === value)
    if (situation) await this.view(situation)
  }

  /** Show the layers as they were at a situation, read-only. */
  private async view(situation: Situation) {
    const { store, tools, renderer, playback, timeline } = this.ws
    // Unsaved changes stay as they are: they come back with "Back to live".
    if (store.view.mode === 'playback') timeline.close()
    await this.ws.run(t('userlayers.loading', 'Loading...'), async () => {
      await playback.load()
      playback.position = situationPosition(playback.changes, situation)
      const snapshot = playback.snapshot()
      tools.setTool({ mode: 'select' })
      tools.select(null)
      store.view.showSituation(situation, snapshot)
      this.ws.toolbar.closePicker()
      await renderer.render(snapshot, new Set())
    })
  }

  backToLive() {
    if (!this.viewing) return
    const { store, renderer } = this.ws
    store.view.goLive()
    void renderer.render(store.layers, store.hidden)
    this.ws.update()
  }

  updateBanner() {
    const viewing = this.viewing
    this.banner.classList.toggle('visible', Boolean(viewing))
    if (!viewing) return
    const back = el('button.oim-ul-button.primary', t('userlayers.back-to-live', 'Back to live'), {
      type: 'button'
    })
    back.onclick = () => this.backToLive()
    this.banner.replaceChildren(
      el(
        'span',
        '👁 ',
        t('userlayers.viewing', 'Viewing'),
        ' ',
        el('strong', viewing.name),
        ` (${situationLabel(viewing).split(' · ').slice(1).join(' · ')}) · `,
        t('userlayers.read-only', 'read-only')
      ),
      back
    )
  }
}
