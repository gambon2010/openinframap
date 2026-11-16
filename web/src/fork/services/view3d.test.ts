import { describe, expect, it } from 'vitest'

describe('the 3D view', () => {
  it('off at first, then as chosen, kept in this browser, telling who listens', async () => {
    localStorage.clear()
    const { view3d } = await import('./view3d.ts')
    expect(view3d.on()).toBe(false)
    let told = 0
    view3d.onChange(() => told++)
    view3d.set(true)
    expect(view3d.on()).toBe(true)
    expect(localStorage.getItem('oim-3d')).toBe('on')
    view3d.set(true)
    expect(told).toBe(1)
    view3d.set(false)
    expect(told).toBe(2)
    expect(localStorage.getItem('oim-3d')).toBe('off')
  })
})
