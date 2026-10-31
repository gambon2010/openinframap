import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PersonalSettings, complete } from './personal.ts'
import { Store } from './store.ts'

const layer = (id: string, folder?: string) => ({ id, style: folder === undefined ? {} : { folder } })

function answer(value: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => ({ value }) }) as Response)
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('personal settings', () => {
  test('a stored value with keys missing is completed', () => {
    expect(complete({ hidden: ['a'] })).toEqual({
      folders: {},
      hidden: ['a'],
      expanded: [],
      folded: [],
      empty: []
    })
    expect(complete(null).folders).toEqual({})
  })

  test('takes over what this browser kept before accounts', () => {
    localStorage.setItem('oim-userlayers-hidden', '["a"]')
    localStorage.setItem('oim-userlayers-folded', '["Grid"]')
    localStorage.setItem('oim-userlayers-empty-folders', '["New"]')
    const p = new PersonalSettings()
    expect(p.data).toMatchObject({ hidden: ['a'], folded: ['Grid'], empty: ['New'] })
  })

  test("a layer's folder: yours, else the one it had before (shared)", () => {
    const p = new PersonalSettings()
    expect(p.folderOf(layer('a', ' Old '))).toBe('Old')
    expect(p.folderOf(layer('b'))).toBeNull()
    p.setFolder('a', 'Mine')
    expect(p.folderOf(layer('a', 'Old'))).toBe('Mine')
    // Taken out: in none, even though the layer still says otherwise.
    p.setFolder('a', null)
    expect(p.folderOf(layer('a', 'Old'))).toBeNull()
  })

  test('a folder a layer is put in is no longer an empty one', () => {
    const p = new PersonalSettings()
    p.toggle('empty', 'New', true)
    p.setFolder('a', 'New')
    expect(p.data.empty).toEqual([])
  })

  test('changes are kept in the browser at once and sent once, a moment later', () => {
    const fetch = answer(null)
    vi.stubGlobal('fetch', fetch)
    const p = new PersonalSettings()
    p.toggle('hidden', 'a', true)
    p.toggle('folded', 'Grid', true)
    p.toggle('hidden', 'a', true)
    expect(new PersonalSettings().data).toMatchObject({ hidden: ['a'], folded: ['Grid'] })
    expect(fetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/userdata/settings/userlayers')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toMatchObject({ hidden: ['a'], folded: ['Grid'] })
  })

  test("loading: the account's settings replace this browser's, and listeners hear it", async () => {
    vi.stubGlobal('fetch', answer({ hidden: ['b'], folders: { a: 'Server' } }))
    const p = new PersonalSettings()
    p.toggle('hidden', 'a', true)
    const heard = vi.fn()
    p.onChange(heard)
    await p.load()
    expect(p.data.hidden).toEqual(['b'])
    expect(p.folderOf(layer('a'))).toBe('Server')
    expect(heard).toHaveBeenCalled()
    expect(new PersonalSettings().data.hidden).toEqual(['b'])
  })

  test("loading for the first time sends this browser's to the account", async () => {
    const fetch = answer(null)
    vi.stubGlobal('fetch', fetch)
    localStorage.setItem('oim-userlayers-hidden', '["a"]')
    const p = new PersonalSettings()
    await p.load()
    vi.advanceTimersByTime(600)
    const put = fetch.mock.calls.find((c) => (c as unknown[])[1]) as unknown as [string, RequestInit]
    expect(JSON.parse(put[1].body as string).hidden).toEqual(['a'])
  })

  test("the server can't be reached: this browser's are kept", async () => {
    vi.stubGlobal('fetch', answer(null, false))
    localStorage.setItem('oim-userlayers-hidden', '["a"]')
    const p = new PersonalSettings()
    await p.load()
    expect(p.data.hidden).toEqual(['a'])
  })
})

describe('the store', () => {
  test('a layer made in a folder is in it for you only: not in its shared style', () => {
    vi.stubGlobal('fetch', answer(null))
    const store = new Store()
    const id = store.createLayer('A', 'Grid')
    expect(store.layers.get(id)?.style.folder).toBeUndefined()
    expect(store.personal.folderOf(store.layers.get(id)!)).toBe('Grid')
  })

  test('hidden layers follow the settings loaded from the server', async () => {
    vi.stubGlobal('fetch', answer({ hidden: ['x'] }))
    const store = new Store()
    const heard = vi.fn()
    store.onChange(heard)
    await store.personal.load()
    expect(store.hidden.has('x')).toBe(true)
    expect(heard).toHaveBeenCalled()
  })
})
