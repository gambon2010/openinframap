// Fork: sharing a layer (docs/plans/sync.md, "Owners and sharing"), from its menu
// (outliner.ts), for its owner: every other account, with no access, view or modify.
// Saved at once (backend: userdata/sharing.py); no Save needed.
import { el, setChildren } from 'redom'
import { t } from '../../../core/i18n.ts'
import { makePanel } from '../../../ui/panel.ts'
import { UserLayer } from '../model/model.ts'
import { LayerSharing } from '../state/api.types.ts'
import { layerSharing, shareLayer } from '../state/api.ts'

type Level = 'view' | 'modify' | null

export function openSharing(layer: UserLayer) {
  const { panel, body } = makePanel(
    'oim-modal.oim-ul-sharing',
    t('userlayers.share-title', 'Share "{{name}}"', { name: layer.name })
  )
  const backdrop = el('.oim-modal-backdrop.visible', panel)
  panel.classList.add('visible')
  const close = () => backdrop.remove()
  new MutationObserver(() => {
    if (!panel.classList.contains('visible')) close()
  }).observe(panel, { attributes: true, attributeFilter: ['class'] })
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close()
  }
  document.body.append(backdrop)

  const error = el('p.oim-ul-sharing-error')
  const show = (sharing: LayerSharing) => {
    const rows = sharing.people.map((person) => {
      const choice = el(
        'select',
        (
          [
            [null, t('userlayers.share-none', 'No access')],
            ['view', t('userlayers.share-view', 'Can view')],
            ['modify', t('userlayers.share-modify', 'Can change')]
          ] as [Level, string][]
        ).map(([value, label]) =>
          el('option', label, { value: value ?? '', selected: value === person.level })
        )
      ) as HTMLSelectElement
      choice.onchange = async () => {
        error.textContent = ''
        try {
          show(await shareLayer(layer.id, person.id, (choice.value || null) as Level))
        } catch (err) {
          error.textContent = (err as Error).message
        }
      }
      return el('tr', el('td', person.name), el('td', choice))
    })
    setChildren(body, [
      sharing.open_to_all
        ? el(
            'p.oim-ul-sharing-note',
            t(
              'userlayers.share-open',
              'This layer is from before there were accounts: everyone can change it. Choosing here makes you its owner; everyone keeps "Can change" until you change it.'
            )
          )
        : el('p.oim-ul-sharing-note', t('userlayers.share-intro', 'Who else can see or change this layer.')),
      rows.length
        ? el('table.oim-ul-sharing-list', ...rows)
        : el('p', t('userlayers.share-nobody', 'There are no other accounts yet.')),
      error
    ])
  }
  setChildren(body, [el('p', t('userlayers.share-loading', 'Loading…'))])
  layerSharing(layer.id)
    .then(show)
    .catch((err) => setChildren(body, [el('p.oim-ul-sharing-error', (err as Error).message)]))
}
