/**
 * أدوات تصدير البيانات إلى CSV متوافقة بالكامل مع الحروف العربية لـ Excel (استخدام UTF-8 BOM)
 */
export function exportToCsv(columns: string[], rows: any[][]): string {
  // ترويسة UTF-8 BOM لازمة لفتح الملفات باللغة العربية بشكل سليم في Excel دون تداخل رموز
  const BOM = '\uFEFF'
  
  const header = columns.join(',')
  const body = rows
    .map((row) =>
      row
        .map((val) => {
          if (val === null || val === undefined) return ''
          let str = String(val).replace(/"/g, '""') // هروب علامات التنصيص المزدوجة
          if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            str = `"${str}"`
          }
          return str
        })
        .join(',')
    )
    .join('\n')

  return BOM + header + '\n' + body
}
