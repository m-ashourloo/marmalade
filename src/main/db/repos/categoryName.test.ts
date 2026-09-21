import { describe, expect, it } from 'vitest'
import { normalizeCategoryName } from './categoryName'

describe('normalizeCategoryName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCategoryName('  Course   readings ')).toBe('Course readings')
    expect(normalizeCategoryName('Tax\tforms')).toBe('Tax forms')
  })

  it('preserves the case the user typed', () => {
    expect(normalizeCategoryName('PhD')).toBe('PhD')
  })

  it('caps the length', () => {
    expect(normalizeCategoryName('x'.repeat(200))).toHaveLength(48)
  })

  it('reduces a whitespace-only name to nothing', () => {
    expect(normalizeCategoryName('   ')).toBe('')
  })
})
