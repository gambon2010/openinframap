import { afterEach, describe, expect, test, vi } from 'vitest'
import { formatHeight, formatSlope, type Ground } from '../../services/elevation.ts'
import { REST_MS, groundFollower } from './ground.ts'

describe('the ground under the cursor', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('the height to the metre, the slope in degrees and per cent; a dash where unknown', () => {
    expect(formatHeight(311.6)).toBe('312 m')
    expect(formatHeight(null)).toBe('—')
    expect(formatSlope(45)).toBe('45° (100 %)')
    expect(formatSlope(null)).toBe('—')
  })

  test('asked once the cursor rests, for where it rests', async () => {
    vi.useFakeTimers()
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      return { ok: true, json: async () => ({ elevation: 211, slope: 1.2 }) }
    })
    const shown: Ground[] = []
    const follow = groundFollower((ground) => shown.push(ground))
    follow(5.7, 45.1)
    follow(5.72, 45.19)
    await vi.advanceTimersByTimeAsync(REST_MS + 1)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('lon=5.720000&lat=45.190000')
    expect(shown).toEqual([{ elevation: 211, slope: 1.2 }])
  })

  test('the backend unreachable: unknown', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    const shown: Ground[] = []
    groundFollower((ground) => shown.push(ground))(5.7, 45.1)
    await vi.advanceTimersByTimeAsync(REST_MS + 1)
    expect(shown).toEqual([{ elevation: null, slope: null }])
  })
})
