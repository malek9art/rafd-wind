import { useCallback, useEffect, useState, useMemo } from 'react'
import type { PnlReport } from '../../../shared/types'
import { unwrapIpcError } from '../App'
import { exportToCsv } from '../../../shared/csv'

function localDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function ReportsScreen() {
  const now = new Date()
  const today = localDateInput(now)
  const firstDayOfMonth = localDateInput(new Date(now.getFullYear(), now.getMonth(), 1))

  // Range select state
  const [startDate, setStartDate] = useState(firstDayOfMonth)
  const [endDate, setEndDate] = useState(today)

  // Report state
  const [report, setReport] = useState<PnlReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Fetch report
  const loadReport = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await window.rafdLocal.reports.getPnl(startDate, endDate)
      setReport(data)
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }, [startDate, endDate])

  useEffect(() => {
    loadReport()
  }, [loadReport])

  // Export current Sales archive to CSV
  async function handleExportSalesCsv() {
    try {
      const salesList = await window.rafdLocal.sales.list()
      const cols = [
        'رقم الفاتورة',
        'التاريخ',
        'إجمالي الفاتورة',
        'المبلغ المدفوع',
        'طريقة الدفع',
        'معرف العميل',
        'الحالة'
      ]
      const rows = salesList.map((s) => [
        s.invoice_number,
        new Date(s.created_at).toLocaleDateString('ar-YE'),
        s.total,
        s.paid,
        s.payment_method,
        s.customer_id || 'نقدي',
        s.status
      ])

      const csvContent = exportToCsv(cols, rows)
      const filename = `تقرير_المبيعات_الكامل_${new Date().toISOString().slice(0, 10)}.csv`
      const success = await window.rafdLocal.files.saveText(filename, csvContent)
      if (success) {
        alert('تم تصدير وحفظ كشف المبيعات الكامل بنجاح!')
      }
    } catch (e) {
      alert('فشل تصدير المبيعات: ' + unwrapIpcError(e))
    }
  }

  // Export current Inventory Catalog to CSV
  async function handleExportInventoryCsv() {
    try {
      const productsList = await window.rafdLocal.products.list()
      const cols = [
        'المعرف',
        'الاسم العربي',
        'الاسم اللاتيني',
        'الفئة',
        'الوحدة',
        'سعر البيع',
        'تكلفة الشراء',
        'المخزون الحالي',
        'الحد الأدنى للمخزون',
        'الحالة',
        'ميزان وزن'
      ]
      const rows = productsList.map((p) => [
        p.id,
        p.name_ar || '',
        p.name,
        p.category,
        p.unit,
        p.price,
        p.cost,
        p.stock,
        p.min_stock,
        p.is_active === 1 ? 'نشط' : 'معطل',
        p.sell_by_weight === 1 ? 'نعم' : 'لا'
      ])

      const csvContent = exportToCsv(cols, rows)
      const filename = `جرد_المخزن_والمنتجات_${new Date().toISOString().slice(0, 10)}.csv`
      const success = await window.rafdLocal.files.saveText(filename, csvContent)
      if (success) {
        alert('تم تصدير وحفظ جرد المخزن بالكامل بنجاح!')
      }
    } catch (e) {
      alert('فشل تصدير جرد المخزن: ' + unwrapIpcError(e))
    }
  }

  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* FILTER BAR AND RANGE SELECT */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between bg-[var(--bg-elevated)] p-4 rounded-2xl shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[var(--text-muted)]">من تاريخ:</span>
            <input
              type="date"
              className="input text-xs py-1"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-[var(--text-muted)]">إلى تاريخ:</span>
            <input
              type="date"
              className="input text-xs py-1"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <button
            onClick={loadReport}
            className="btn btn-primary px-4 py-1.5 font-bold"
            disabled={busy}
          >
            {busy ? '⏳ جاري التحديث...' : '🔄 تحديث الأرقام'}
          </button>
        </div>

        {/* EXPORTS ACCORDION */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportSalesCsv}
            className="btn border-[var(--color-ink-200)] hover:bg-gray-100 text-gray-700 font-bold px-3 py-1.5"
          >
            📥 تصدير المبيعات (.csv)
          </button>
          <button
            onClick={handleExportInventoryCsv}
            className="btn border-[var(--color-ink-200)] hover:bg-gray-100 text-gray-700 font-bold px-3 py-1.5"
          >
            📊 تصدير جرد المخزن (.csv)
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)] font-bold text-center">
          ⚠️ {error}
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* STATS SUMMARY CARDS */}
          <div className="card p-4 flex flex-col justify-between">
            <div className="text-[10px] font-bold text-[var(--text-muted)]">💰 إجمالي مبيعات الفترة (الإيرادات)</div>
            <div className="text-xl font-extrabold font-mono text-[var(--primary)] mt-1" dir="ltr">
              {report.totalRevenue.toLocaleString()} YER
            </div>
            <div className="text-[9px] text-[var(--text-muted)] mt-2">صافي المدخول المالي المقبوض والآجل</div>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="text-[10px] font-bold text-[var(--text-muted)]">📉 إجمالي تكلفة البضاعة المباعة (COGS)</div>
            <div className="text-xl font-extrabold font-mono text-gray-700 mt-1" dir="ltr">
              {report.totalCogs.toLocaleString()} YER
            </div>
            <div className="text-[9px] text-amber-700 font-bold mt-2">📊 تشمل حساب أوزان السلع بالكيلو جرام</div>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="text-[10px] font-bold text-[var(--text-muted)]">⚖️ مجمل الربح للفترة (الرياش)</div>
            <div className="text-xl font-extrabold font-mono text-teal-700 mt-1" dir="ltr">
              {report.grossProfit.toLocaleString()} YER
            </div>
            <div className="text-[9px] text-[var(--text-muted)] mt-2">المبيعات الكلية ناقص التكلفة الشرائية</div>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="text-[10px] font-bold text-[var(--text-muted)]">💸 إجمالي المصاريف الحركية</div>
            <div className="text-xl font-extrabold font-mono text-red-700 mt-1" dir="ltr">
              {report.totalExpenses.toLocaleString()} YER
            </div>
            <div className="text-[9px] text-[var(--text-muted)] mt-2">إيجار، كهرباء، فواتير إضافية</div>
          </div>

          <div className="card p-4 flex flex-col justify-between">
            <div className="text-[10px] font-bold text-[var(--text-muted)]">🧾 إجمالي المشتريات الموردة</div>
            <div className="text-xl font-extrabold font-mono text-amber-700 mt-1" dir="ltr">
              {report.totalPurchases.toLocaleString()} YER
            </div>
            <div className="text-[9px] text-[var(--text-muted)] mt-2">قيمة فواتير الشراء المعتمدة</div>
          </div>

          <div className="card p-4 flex flex-col justify-between bg-teal-500/5 border border-teal-100">
            <div className="text-[10px] font-bold text-teal-900">📈 صافي الربح الحقيقي للنشاط</div>
            <div className={`text-xl font-extrabold font-mono mt-1 ${report.netProfit >= 0 ? 'text-teal-700' : 'text-red-700'}`} dir="ltr">
              {report.netProfit.toLocaleString()} YER
            </div>
            <div className="text-[9px] text-teal-800 font-semibold mt-2">مجمل الربح ناقص المصاريف الكلية</div>
          </div>
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* DAILY REVENUE CHART/TABLE */}
          <section className="card p-5">
            <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-1.5">
              📅 الإيراد والمبيعات اليومية المجمعة
            </h3>
            {report.dailyRevenue.length === 0 ? (
              <p className="py-12 text-center text-[var(--text-muted)]">لا توجد مبيعات في الفترة المحددة.</p>
            ) : (
              <div className="overflow-y-auto max-h-[250px]">
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-ink-200)] text-[var(--text-muted)] font-bold">
                      <th className="py-1.5 text-start">التاريخ</th>
                      <th className="py-1.5 text-start">إجمالي الإيراد اليومي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dailyRevenue.map((row) => (
                      <tr key={row.date} className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)]">
                        <td className="py-2 font-mono font-bold text-gray-700" dir="ltr">{row.date}</td>
                        <td className="py-2 font-extrabold font-mono text-teal-700" dir="ltr">
                          {row.amount.toLocaleString()} YER
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* EXPENSES BY CATEGORY CHART/TABLE */}
          <section className="card p-5">
            <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-1.5">
              📊 توزيع المصاريف التشغيلية حسب الفئة
            </h3>
            {report.expensesByCategory.length === 0 ? (
              <p className="py-12 text-center text-[var(--text-muted)]">لا توجد مصاريف مسجلة في هذه الفترة.</p>
            ) : (
              <div className="overflow-y-auto max-h-[250px]">
                <table className="w-full text-start text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--color-ink-200)] text-[var(--text-muted)] font-bold">
                      <th className="py-1.5 text-start">الفئة</th>
                      <th className="py-1.5 text-start">إجمالي المصروفات للفئة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.expensesByCategory.map((row) => (
                      <tr key={row.category} className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)]">
                        <td className="py-2 font-bold text-gray-800">{row.category}</td>
                        <td className="py-2 font-extrabold font-mono text-red-700" dir="ltr">
                          {row.amount.toLocaleString()} YER
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
