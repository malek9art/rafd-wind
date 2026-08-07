import { describe, expect, it } from 'vitest'
import { exportToCsv } from '../src/shared/csv'

describe('تصدير CSV', () => {
  it('يضيف BOM ويهرب العناوين والخلايا والأسطر الجديدة', () => {
    const csv = exportToCsv(['الاسم,الوصف', 'القيمة'], [['أحمد, متجر', 'سطر أول\nسطر ثانٍ']])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"الاسم,الوصف",القيمة')
    expect(csv).toContain('"أحمد, متجر","سطر أول\nسطر ثانٍ"')
  })

  it('يصدر ترويسة صالحة حتى عند عدم وجود صفوف', () => {
    expect(exportToCsv(['أ', 'ب'], [])).toBe('\uFEFFأ,ب\r\n')
  })
})
