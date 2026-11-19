import { describe, expect, it } from 'vitest'
import type { Map } from 'maplibre-gl'
import { el } from 'redom'
import { extendKey } from './toggles.ts'

describe('the key’s sections', () => {
  it('can replace an upstream row of the section they add to', async () => {
    const map = { isStyleLoaded: () => false, once: () => undefined, on: () => undefined } as unknown as Map
    const table = el(
      'table',
      el('tr', el('td', 'Oil'), el('td')),
      el('tr', el('td', 'Petroleum facility'), el('td'))
    )
    const pane = el('div', el('h3', 'Petroleum'), table)
    await extendKey(map, el('div'), pane, [
      {
        title: 'Petroleum',
        appendTo: 'Petroleum',
        replaces: ['Petroleum facility'],
        rows: [['Petroleum facility', el('img'), { layers: ['petroleum_site'] }]]
      }
    ])
    const rows = [...pane.querySelectorAll('tr')]
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual(['Oil', 'Petroleum facility'])
    expect(rows[1].dataset.hide).toBe(JSON.stringify({ layers: ['petroleum_site'] }))
  })

  it('ticks a kind listed in two sections alike in both', async () => {
    const map = {
      isStyleLoaded: () => false,
      once: () => undefined,
      on: () => undefined,
      getStyle: () => ({ layers: [] })
    } as unknown as Map
    const airfield = { icon: 'site_military_airfield' }
    const pane = el('div')
    document.body.append(pane)
    await extendKey(map, el('div'), pane, [
      { title: 'Transport hubs', rows: [['Military airfield', el('img'), airfield]] },
      { title: 'Military', rows: [['Military airfield', el('img'), airfield]] }
    ])
    const [transport, military] = pane.querySelectorAll<HTMLInputElement>('input.oim-key-toggle')
    transport.checked = false
    transport.dispatchEvent(new Event('change'))
    expect(military.checked).toBe(false)
    expect(military.closest('tr')?.classList.contains('oim-key-row-hidden')).toBe(true)
    pane.remove()
  })
})
