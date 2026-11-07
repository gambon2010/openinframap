// What My layers' list (Outliner) draws and does, through its outside only (the
// list, clicks, right-click menus, renaming, drag and drop), on a real store: the
// safety net for splitting outliner/index.ts (docs/plans/refactor-5e.md).
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Store } from '../../state/store.ts'
import { Outliner } from './index.ts'
import type { OutlinerActions } from './types.ts'
import { closeContextMenu } from '../../../../ui/context-menu.ts'
import { ITEMS_SHOWN } from './constants.ts'

const point = (x = 0): GeoJSON.Point => ({ type: 'Point', coordinates: [x, 0] })
const line: GeoJSON.LineString = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [1, 1]
  ]
}

let store: Store
let outliner: Outliner
let actions: OutlinerActions & { selected: string[] }

/** What a row says: its own text (not its picture's or buttons'), and its state. */
function rowText(row: Element): string {
  const parts: string[] = []
  for (const child of row.children) {
    if (child.matches('button, .oim-ul-thumb, ul')) continue
    const text = child.textContent?.trim()
    if (text) parts.push(text)
  }
  const flags = [
    row.classList.contains('active') ? 'active' : '',
    row.classList.contains('oim-on') ? 'selected' : '',
    row.getAttribute('aria-expanded') === 'false' ? 'closed' : ''
  ].filter(Boolean)
  return parts.join(' | ') + (flags.length ? `  [${flags.join(', ')}]` : '')
}

/** The list as lines, indented by depth. */
function describeList(): string[] {
  const lines: string[] = []
  const walk = (list: Element, depth: number) => {
    for (const li of list.children) {
      const header = li.querySelector(':scope > .oim-ul-folder-row, :scope > .oim-ul-layer-row')
      const hidden = li.classList.contains('hidden') ? '  [hidden]' : ''
      lines.push(
        '  '.repeat(depth) + (header ? rowText(header) + hidden : rowText(li) || li.textContent?.trim())
      )
      for (const sub of li.querySelectorAll(':scope > ul')) walk(sub, depth + 1)
    }
  }
  const tree = outliner.el.querySelector('.oim-ul-tree')
  if (tree) walk(tree, 0)
  else lines.push(outliner.el.textContent?.trim() ?? '')
  return lines
}

function footer(): string[] {
  return [...outliner.footer.querySelectorAll('button')].map((b) => b.title || b.textContent || '')
}

/** The right-click menu of a row: its entries' text. */
function menuOf(row: Element): string[] {
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  const menu = document.querySelector('.oim-context-menu')
  const entries = [...(menu?.querySelectorAll('h4, button, summary, hr') ?? [])].map((e) =>
    e.tagName === 'HR' ? '---' : (e.textContent?.trim() ?? '')
  )
  closeContextMenu()
  return entries
}

function rowNamed(name: string): HTMLElement {
  const row = [...outliner.el.querySelectorAll<HTMLElement>('.oim-ul-layer-row, .oim-ul-folder-row')].find(
    (r) => r.textContent?.includes(name)
  )
  if (!row) throw new Error(`no row ${name}`)
  return row
}

function itemNamed(name: string): HTMLElement {
  const row = [...outliner.el.querySelectorAll<HTMLElement>('.oim-ul-item')].find((r) =>
    r.textContent?.includes(name)
  )
  if (!row) throw new Error(`no item ${name}`)
  return row
}

/** A drag carrying an item or a layer, dropped on a row (offsetY: where on it). */
function drop(row: HTMLElement, type: 'item' | 'layer', id: string, offsetY = 1) {
  const data = { [`application/x-oim-${type}`]: id }
  const dataTransfer = { types: Object.keys(data), getData: (t: string) => data[t] ?? '' }
  for (const kind of ['dragover', 'drop']) {
    const e = Object.defineProperties(new Event(kind, { bubbles: true, cancelable: true }), {
      dataTransfer: { value: dataTransfer },
      offsetY: { value: offsetY }
    })
    row.dispatchEvent(e)
  }
}

beforeEach(() => {
  localStorage.clear()
  document.body.replaceChildren()
  store = new Store()
  actions = {
    selected: [],
    update: () => outliner.draw(),
    select: vi.fn((f, add) => (actions.selected = add ? [...actions.selected, f.id] : [f.id])),
    selectMore: vi.fn((ids: string[]) => (actions.selected = [...actions.selected, ...ids])),
    isSelected: (id) => actions.selected.includes(id),
    selection: () => actions.selected,
    newLayer: vi.fn(),
    exportLayers: vi.fn(),
    importFile: vi.fn(),
    zoomToLayer: vi.fn(),
    reordered: vi.fn()
  }
  outliner = new Outliner(store, actions)
  document.body.append(outliner.el, outliner.footer)
})

/** Layers in a folder and not, one shared to view only, one hidden, one empty. */
function sampleLayers() {
  const units = store.createLayer('Units', 'Ops')
  store.addFeature(units, point(1), { kind: 'symbol', sidc: 'SFGPUCI----F---', modifiers: { T: '2nd Bn' } })
  store.addFeature(units, point(2), { kind: 'symbol', sidc: 'SHGPUCI--------', modifiers: { T: '45th Bn' } })
  store.addFeature(units, line, { kind: 'drawing', name: 'Route' })
  store.addFeature(units, point(3), { kind: 'marker', name: 'Bridge' })
  const plans = store.createLayer('Plans', 'Ops')
  store.addFeature(plans, point(4), { kind: 'marker', name: 'Depot' })
  const shared = store.createLayer('Theirs')
  const theirs = store.layers.get(shared)!
  theirs.access = 'view'
  theirs.owner = 'Alice'
  const hidden = store.createLayer('Hidden one')
  store.setHidden(hidden, true)
  store.createLayer('Empty')
  store.setActive(units)
  return { units, plans, shared, hidden }
}

describe('what the list shows', () => {
  test('nothing yet', () => {
    outliner.draw()
    expect(describeList().join('\n')).toMatch(/No layer yet/)
    expect(footer()).toEqual(['New layer', 'A folder to drag layers into', expect.stringMatching(/Import/)])
  })

  test('folders, layers, groups and items', () => {
    const { units } = sampleLayers()
    store.personal.toggle('expanded', units, true)
    outliner.draw()
    expect(describeList()).toMatchSnapshot()
    expect(footer()).toMatchSnapshot()
  })

  test('a search shows what matches, every group open', () => {
    sampleLayers()
    const search = outliner.el.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = 'bridge'
    search.dispatchEvent(new Event('input'))
    expect(describeList()).toMatchSnapshot()
  })

  test('a long layer shows its first items, then "Show the other…"', () => {
    const big = store.createLayer('Big')
    for (let i = 0; i < ITEMS_SHOWN + 3; i++)
      store.addFeature(big, point(i), { kind: 'marker', name: `M${i}` })
    store.personal.toggle('expanded', big, true)
    outliner.draw()
    const more = outliner.el.querySelector<HTMLElement>('.oim-ul-more')!
    expect(more.textContent).toMatch(/3/)
    more.click()
    expect(outliner.el.querySelectorAll('.oim-ul-item')).toHaveLength(ITEMS_SHOWN + 3)
  })
})

describe('clicks', () => {
  test('a layer row opens and closes; a group folds', () => {
    const { units } = sampleLayers()
    outliner.draw()
    rowNamed('Units').click()
    expect(store.personal.data.expanded).toContain(units)
    const group = outliner.el.querySelector<HTMLElement>('.oim-ul-item-group')!
    group.click()
    expect(outliner.el.querySelector('.oim-ul-item-group')!.getAttribute('aria-expanded')).toBe('false')
    rowNamed('Units').click()
    expect(store.personal.data.expanded).not.toContain(units)
  })

  test('items: click selects, Ctrl-click adds, Shift-click a range', () => {
    const { units } = sampleLayers()
    store.personal.toggle('expanded', units, true)
    outliner.draw()
    itemNamed('Route').click()
    expect(actions.select).toHaveBeenLastCalledWith(
      expect.objectContaining({ properties: expect.anything() }),
      false
    )
    itemNamed('Bridge').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }))
    expect(actions.select).toHaveBeenLastCalledWith(expect.anything(), true)
    outliner.draw()
    const items = [...outliner.el.querySelectorAll('.oim-ul-item')]
    // From the last one clicked (Bridge) up to the first: a range.
    items[0].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }))
    expect(actions.selectMore).toHaveBeenCalled()
    expect((actions.selectMore as ReturnType<typeof vi.fn>).mock.calls[0][0].length).toBeGreaterThan(1)
  })

  test("a layer's eye hides it; a folder's, all its layers", () => {
    const { units, plans } = sampleLayers()
    outliner.draw()
    rowNamed('Units').querySelector('button')!.click()
    expect(store.hidden.has(units)).toBe(true)
    rowNamed('Ops').querySelector('button')!.click()
    expect(store.hidden.has(units) && store.hidden.has(plans)).toBe(true)
  })

  test('the footer buttons ask for a new layer, an import; + Folder makes one', () => {
    // (With no layer at all, the list says so instead of showing folders.)
    store.createLayer('One')
    outliner.draw()
    const [layer, folder, importButton] = outliner.footer.querySelectorAll('button')
    layer.click()
    expect(actions.newLayer).toHaveBeenCalled()
    importButton.click()
    expect(actions.importFile).toHaveBeenCalled()
    folder.click()
    expect(outliner.el.querySelector('input.oim-ul-rename')).not.toBeNull()
  })
})

describe('renaming in place', () => {
  test('double-click, type, Enter: renamed; Escape: as it was', () => {
    sampleLayers()
    outliner.draw()
    rowNamed('Plans')
      .querySelector('.oim-ul-layer-label')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    let input = outliner.el.querySelector<HTMLInputElement>('input.oim-ul-rename')!
    input.value = 'Plans B'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect([...store.layers.values()].map((l) => l.name)).toContain('Plans B')
    rowNamed('Plans B')
      .querySelector('.oim-ul-layer-label')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    input = outliner.el.querySelector<HTMLInputElement>('input.oim-ul-rename')!
    input.value = 'Nope'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect([...store.layers.values()].map((l) => l.name)).toContain('Plans B')
  })

  test('a folder renamed takes its layers with it', () => {
    const { units, plans } = sampleLayers()
    outliner.draw()
    outliner.startEditing('folder', 'Ops')
    const input = outliner.el.querySelector<HTMLInputElement>('input.oim-ul-rename')!
    input.value = 'Operations'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    const layers = [...store.layers.values()]
    expect(store.personal.folderOf(layers.find((l) => l.id === units)!)).toBe('Operations')
    expect(store.personal.folderOf(layers.find((l) => l.id === plans)!)).toBe('Operations')
  })

  test('a new folder: empty, its name ready to type', () => {
    store.createLayer('One')
    outliner.newFolder()
    const input = outliner.el.querySelector<HTMLInputElement>('input.oim-ul-rename')!
    expect(input.value).toBe('New folder')
    input.value = 'Later'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(describeList().join('\n')).toMatch(/Later/)
  })
})

describe('right-click menus', () => {
  test("yours, someone else's to view, a folder's", () => {
    sampleLayers()
    outliner.draw()
    expect(menuOf(rowNamed('Units'))).toMatchSnapshot()
    expect(menuOf(rowNamed('Theirs'))).toMatchSnapshot()
    expect(menuOf(rowNamed('Ops'))).toMatchSnapshot()
  })
})

describe('drag and drop', () => {
  test('an item dropped on another layer moves there', () => {
    const { units, plans } = sampleLayers()
    const bridge = [...store.layers.get(units)!.features.values()].find(
      (f) => f.properties.name === 'Bridge'
    )!
    outliner.draw()
    drop(rowNamed('Plans'), 'item', bridge.id)
    expect(store.layerOf(bridge.id)!.id).toBe(plans)
  })

  test('a layer dropped on a folder goes in it; on a layer, just above it', () => {
    const { hidden, plans } = sampleLayers()
    outliner.draw()
    drop(rowNamed('Ops'), 'layer', hidden)
    expect(store.personal.folderOf(store.layers.get(hidden)!)).toBe('Ops')
    expect(actions.reordered).toHaveBeenCalled()
    outliner.draw()
    drop(rowNamed('Plans'), 'layer', hidden, -1) // the upper half of the row (no height here)
    const order = describeList().filter((l) => /Plans|Hidden one/.test(l))
    expect(order[0]).toMatch(/Hidden one/)
    expect(store.personal.folderOf(store.layers.get(plans)!)).toBe('Ops')
  })
})
