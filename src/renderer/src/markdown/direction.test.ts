import { describe, expect, it } from 'vitest'
import { textDirection } from './direction'

describe('textDirection', () => {
  it('reads Persian, Arabic and Hebrew as RTL', () => {
    expect(textDirection('این یک متن فارسی است.')).toBe('rtl')
    expect(textDirection('هذا نص عربي')).toBe('rtl')
    expect(textDirection('זהו טקסט בעברית')).toBe('rtl')
  })

  it('reads Latin, Cyrillic and CJK as LTR', () => {
    expect(textDirection('Plain English text.')).toBe('ltr')
    expect(textDirection('Привет, мир')).toBe('ltr')
    expect(textDirection('日本語のテキスト')).toBe('ltr')
  })

  it('goes by the majority, not the first letter', () => {
    expect(textDirection('React یک کتابخانه برای ساخت رابط کاربری است')).toBe('rtl')
    expect(textDirection('Install the package with npm, then run it — سلام')).toBe('ltr')
  })

  it('falls back to the first letter on a tie', () => {
    expect(textDirection('abc ابت')).toBe('ltr')
    expect(textDirection('ابت abc')).toBe('rtl')
  })

  it('has no opinion on text without letters', () => {
    expect(textDirection('')).toBeNull()
    expect(textDirection('123 — 456!')).toBeNull()
    expect(textDirection('۱۲۳۴')).toBeNull()
  })
})
