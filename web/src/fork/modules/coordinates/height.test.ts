import { afterEach, describe, expect, test, vi } from 'vitest'
import { formatHeight } from '../../services/elevation.ts'
import { REST_MS, heightFollower } from './height.ts'

describe('the height under the cursor', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('to the metre, or a dash where there is no terrain', () => {
    expect(formatHeight(311.6)).toBe('312 m')
    expect(formatHeight(null)).toBe('—')
  })

  test('asked once the cursor rests, for where it rests', async () => {
    vi.useFakeTimers()
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      return { ok: true, json: async () => ({ elevation: 211 }) }
    })
    const shown: string[] = []
    const follow = heightFollower((text) => shown.push(text))
    follow(5.7, 45.1)
    follow(5.72, 45.19)
    await vi.advanceTimersByTimeAsync(REST_MS + 1)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('lon=5.720000&lat=45.190000')
    expect(shown).toEqual(['211 m'])
  })

  test('the backend unreachable: a dash', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    const shown: string[] = []
    heightFollower((text) => shown.push(text))(5.7, 45.1)
    await vi.advanceTimersByTimeAsync(REST_MS + 1)
    expect(shown).toEqual(['—'])
  })
})
