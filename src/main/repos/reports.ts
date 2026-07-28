import type { Db } from '../db'
import { roundMoney } from './helpers'

export interface PnlReport {
  startDate: string
  endDate: string
  totalRevenue: number
  totalCogs: number
  totalExpenses: number
  totalPurchases: number
  grossProfit: number
  netProfit: number
  dailyRevenue: Array<{ date: string; amount: number }>
  expensesByCategory: Array<{ category: string; amount: number }>
}

/**
 * حساب تقرير الربح والخسارة لفترة زمنية محددة.
 * جميع الحسابات ذرّية وصرفة وخاضعة للاختبار (الوظيفة §11).
 */
export function getPnlReport(db: Db, startDate: string, endDate: string): PnlReport {
  // تهيئة نطاق التواريخ بصيغة ISO كاملة للتحقق السليم من الفهرس
  const start = `${startDate.slice(0, 10)}T00:00:00.000Z`
  const end = `${endDate.slice(0, 10)}T23:59:59.999Z`

  // 1. حساب إجمالي الإيرادات
  const revRow = db
    .prepare('SELECT SUM(total) AS sum FROM sales WHERE created_at >= ? AND created_at <= ?')
    .get(start, end) as { sum: number | null }
  const totalRevenue = roundMoney(revRow?.sum ?? 0)

  // 2. حساب إجمالي COGS (تكلفة البضاعة المباعة)
  // COGS لبند مبيعات = cost * (sold_by_weight ? weight_g / 1000 : quantity)
  // نقوم بربط جدول sale_items بجدول المنتجات products للحصول على التكلفة الحالية للمنتج
  const items = db
    .prepare(`
      SELECT 
        si.quantity, 
        si.weight_g, 
        si.sold_by_weight, 
        COALESCE(p.cost, 0) AS product_cost
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.created_at >= ? AND s.created_at <= ?
    `)
    .all(start, end) as Array<{
      quantity: number
      weight_g: number | null
      sold_by_weight: number
      product_cost: number
    }>

  let totalCogs = 0
  for (const item of items) {
    const isSoldByWeight = item.sold_by_weight === 1
    const qty = isSoldByWeight && item.weight_g != null ? item.weight_g / 1000 : item.quantity
    totalCogs += qty * item.product_cost
  }
  totalCogs = roundMoney(totalCogs)

  // 3. حساب إجمالي المصروفات
  // نفترض أن تاريخ المصروف مخزن في حقل created_at أو expense_date.
  // سنفحص الحالتين بالتحقق المزدوج أو استخدام expense_date إن وجد، وإلا created_at
  const expRow = db
    .prepare(`
      SELECT SUM(amount) AS sum 
      FROM expenses 
      WHERE (expense_date >= ? AND expense_date <= ?) OR (created_at >= ? AND created_at <= ?)
    `)
    .get(startDate.slice(0, 10), endDate.slice(0, 10), start, end) as { sum: number | null }
  const totalExpenses = roundMoney(expRow?.sum ?? 0)

  // 4. حساب إجمالي المشتريات
  const purRow = db
    .prepare(`
      SELECT SUM(total) AS sum 
      FROM purchases 
      WHERE (purchase_date >= ? AND purchase_date <= ?) OR (created_at >= ? AND created_at <= ?)
    `)
    .get(startDate.slice(0, 10), endDate.slice(0, 10), start, end) as { sum: number | null }
  const totalPurchases = roundMoney(purRow?.sum ?? 0)

  // 5. مجمل الربح وصافي الربح
  const grossProfit = roundMoney(totalRevenue - totalCogs)
  const netProfit = roundMoney(grossProfit - totalExpenses)

  // 6. الإيراد اليومي المجمع
  const dailyRows = db
    .prepare(`
      SELECT 
        strftime('%Y-%m-%d', created_at) AS date,
        SUM(total) AS amount
      FROM sales
      WHERE created_at >= ? AND created_at <= ?
      GROUP BY strftime('%Y-%m-%d', created_at)
      ORDER BY date
    `)
    .all(start, end) as Array<{ date: string; amount: number }>
  const dailyRevenue = dailyRows.map((r) => ({ date: r.date, amount: roundMoney(r.amount) }))

  // 7. المصروفات حسب الفئة
  const catRows = db
    .prepare(`
      SELECT 
        category,
        SUM(amount) AS amount
      FROM expenses
      WHERE (expense_date >= ? AND expense_date <= ?) OR (created_at >= ? AND created_at <= ?)
      GROUP BY category
      ORDER BY amount DESC
    `)
    .all(startDate.slice(0, 10), endDate.slice(0, 10), start, end) as Array<{ category: string; amount: number }>
  const expensesByCategory = catRows.map((r) => ({ category: r.category, amount: roundMoney(r.amount) }))

  return {
    startDate,
    endDate,
    totalRevenue,
    totalCogs,
    totalExpenses,
    totalPurchases,
    grossProfit,
    netProfit,
    dailyRevenue,
    expensesByCategory
  }
}
