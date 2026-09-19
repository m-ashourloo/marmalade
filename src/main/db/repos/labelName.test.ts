import { describe, expect, it } from 'vitest'
import { normalizeLabel } from './labelName'

describe('normalizeLabel', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeLabel('  chapter   3 ')).toBe('chapter 3')
    expect(normalizeLabel('to\tdo')).toBe('to do')
  })

  it('preserves the case the user typed', () => {
    expect(normalizeLabel('TODO')).toBe('TODO')
  })

  it('caps the length', () => {
    expect(normalizeLabel('x'.repeat(200))).toHaveLength(64)
  })

  it('reduces a whitespace-only name to nothing', () => {
    expect(normalizeLabel('   ')).toBe('')
  })
})
