/**
 * أدوات تصدير البيانات إلى CSV متوافقة مع Excel والحروف العربية.
 */

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value).replace(/"/g, '""')
  return /[",\r\n]/.test(text) ? `"${text}"` : text
}

export function exportToCsv(columns: string[], rows: unknown[][]): string {
  const BOM = '\uFEFF'
  const header = columns.map(escapeCsvCell).join(',')
  const body = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  return BOM + header + (rows.length > 0 ? `\r\n${body}` : '\r\n')
}
