import { describe, expect, test } from 'vitest'
import { MAX_IMAGE_SIZE, imageScale } from './panel.ts'

describe('stored picture size', () => {
  test('big pictures are scaled down to 1024 px on their longest side', () => {
    expect(imageScale(4000, 3000, false) * 4000).toBe(MAX_IMAGE_SIZE)
    expect(imageScale(600, 2048, false)).toBe(0.5)
  })

  test('small pictures are kept as they are', () => {
    expect(imageScale(120, 80, false)).toBe(1)
  })

  test('vector images (SVG) are drawn at full size, however small they say they are', () => {
    expect(imageScale(24, 24, true) * 24).toBe(MAX_IMAGE_SIZE)
  })
})
