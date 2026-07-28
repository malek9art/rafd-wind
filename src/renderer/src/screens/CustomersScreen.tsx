import { useCallback, useEffect, useState, useMemo } from 'react'
import type { Customer, LedgerEntry, Sale } from '../../../shared/types'
import { unwrapIpcError } from '../App'

const EMPTY_FORM = { id: undefined as number | undefined, name: '', phone: '', email: '', notes: '' }
const EMPTY_PAY_FORM = { amount: '', notes: '', reference: '' }

export default function CustomersScreen() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [sales, setSales] = useState<Sale[]>([])

  // UI state
  const [form, setForm] = useState(EMPTY_FORM)
  const [payForm, setPayForm] = useState(EMPTY_PAY_FORM)
  const [editMode, setEditMode] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showLedgerModal, setShowLedgerModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Load customers list
  const refreshCustomers = useCallback(() => {
    window.rafdLocal.customers
      .list()
      .then(setCustomers)
      .catch((e) => setError(unwrapIpcError(e)))
  }, [])

  useEffect(() => {
    refreshCustomers()
  }, [refreshCustomers])

  // Load customer details when one is selected
  const selectCustomer = async (customer: Customer) => {
    setSelectedCustomer(customer)
    setError(null)
    try {
      // 1. Load customer ledger entries
      const ledgerEntries = await window.rafdLocal.customerLedger.listByCustomer(customer.id)
      setLedger(ledgerEntries)

      // 2. Load customer sales history
      const customerSales = await window.rafdLocal.sales.list({ customer_id: customer.id })
      setSales(customerSales)

      setShowLedgerModal(true)
    } catch (e) {
      setError(unwrapIpcError(e))
    }
  }

  // Create or Update Customer
  async function submitCustomer() {
    if (!form.name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null
      }

      if (editMode && form.id !== undefined) {
        await window.rafdLocal.customers.update(form.id, payload)
        setEditMode(false)
        if (selectedCustomer && selectedCustomer.id === form.id) {
          setSelectedCustomer({ ...selectedCustomer, ...payload })
        }
      } else {
        await window.rafdLocal.customers.create(payload)
      }

      setForm(EMPTY_FORM)
      refreshCustomers()
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  // Edit Customer
  function startEdit(c: Customer) {
    setEditMode(true)
    setForm({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      notes: c.notes || ''
    })
  }

  function cancelEdit() {
    setEditMode(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  // Delete Customer
  async function handleDelete(id: number) {
    if (window.confirm('هل أنت متأكد من حذف هذا العميل؟ سيؤدي ذلك لحذف قيود دفتره بالكامل.')) {
      setError(null)
      try {
        await window.rafdLocal.customers.delete(id)
        refreshCustomers()
        if (selectedCustomer && selectedCustomer.id === id) {
          setSelectedCustomer(null)
          setShowLedgerModal(false)
        }
      } catch (e) {
        setError(unwrapIpcError(e))
      }
    }
  }

  // Register Customer Payment Receipt (سند قبض دفعة)
  async function submitPayment() {
    if (!selectedCustomer || !payForm.amount) return
    const amt = Number(payForm.amount)
    if (isNaN(amt) || amt <= 0) {
      setError('يرجى إدخال مبلغ دفع صحيح أكبر من الصفر')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await window.rafdLocal.customerLedger.addEntry({
        customer_id: selectedCustomer.id,
        amount: amt,
        type: 'payment',
        reference: payForm.reference.trim() || null,
        notes: payForm.notes.trim() || null
      })

      // Refresh list and customer details
      refreshCustomers()
      const updatedCustomer = await window.rafdLocal.customers.list()
      const current = updatedCustomer.find((c) => c.id === selectedCustomer.id)
      if (current) {
        setSelectedCustomer(current)
        const ledgerEntries = await window.rafdLocal.customerLedger.listByCustomer(current.id)
        setLedger(ledgerEntries)
      }

      setPayForm(EMPTY_PAY_FORM)
      setShowPayModal(false)
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  // Export Account Statement to native file dialog
  async function handleExportStatement() {
    if (!selectedCustomer) return
    const filename = `kashf_hisab_client_${selectedCustomer.name.replace(/\s+/g, '_')}.txt`
    
    let text = `--------------------------------------------------\n`
    text += `كشف حساب عميل: ${selectedCustomer.name}\n`
    text += `تاريخ التصدير: ${new Date().toLocaleString('ar-YE')}\n`
    text += `الهاتف: ${selectedCustomer.phone || 'غير مسجل'}\n`
    text += `الرصيد المتبقي المستحق على العميل: ${selectedCustomer.balance.toLocaleString()} YER\n`
    text += `--------------------------------------------------\n\n`
    text += `التاريخ       | الحركة      | المرجع    | المبلغ (YER) | الرصيد بعد\n`
    text += `--------------------------------------------------\n`

    for (const entry of ledger) {
      const typeAr = entry.type === 'sale_credit' ? 'بيع آجل' : entry.type === 'payment' ? 'سند قبض' : 'تعديل'
      const date = new Date(entry.created_at).toLocaleDateString('ar-YE')
      text += `${date.padEnd(12)} | ${typeAr.padEnd(10)} | ${(entry.reference || '').padEnd(10)} | ${String(entry.amount).padStart(12)} | ${String(entry.balance_after).padStart(12)}\n`
      if (entry.notes) text += `   [ملاحظة: ${entry.notes}]\n`
    }
    text += `\n--------------------------------------------------\n`
    text += `نظام رفد POS سطح المكتب — أوفلاين بالكامل\n`

    const success = await window.rafdLocal.files.saveText(filename, text)
    if (success) {
      alert('تم تصدير وحفظ كشف الحساب بنجاح!')
    } else {
      setError('فشل تصدير وحفظ كشف الحساب.')
    }
  }

  // Real-time filtering
  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const query = searchQuery.trim().toLowerCase()
      return (
        query === '' ||
        c.name.toLowerCase().includes(query) ||
        (c.phone || '').includes(query) ||
        (c.notes || '').toLowerCase().includes(query)
      )
    })
  }, [customers, searchQuery])

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[330px_1fr] text-xs">
      {/* FORM SECTION */}
      <section className="card h-fit p-5">
        <h2 className="mb-4 text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
          {editMode ? '📝 تعديل بيانات عميل' : '👤 إضافة عميل جديد'}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="label">اسم العميل *</label>
            <input
              className="input text-xs"
              placeholder="مثال: محمد أحمد علي"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="label">رقم الهاتف</label>
            <input
              className="input text-xs"
              placeholder="777..."
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>

          <div>
            <label className="label">البريد الإلكتروني</label>
            <input
              className="input text-xs"
              placeholder="client@mail.com"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div>
            <label className="label">ملاحظات / سقف الدين</label>
            <textarea
              className="input text-xs h-16 resize-none"
              placeholder="سقف الدين 50,000 ريال"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {error && !selectedCustomer && (
            <div className="rounded-xl bg-[var(--danger)]/10 p-2.5 text-[10px] text-[var(--danger)] font-bold text-center">
              ⚠️ {error}
            </div>
          )}

          <div className="flex gap-2">
            {editMode && (
              <button
                className="btn border-[var(--color-ink-200)] text-[var(--text-muted)] hover:bg-gray-100"
                onClick={cancelEdit}
              >
                إلغاء
              </button>
            )}
            <button
              className="btn btn-primary flex-1 py-2 font-bold"
              disabled={busy || !form.name.trim()}
              onClick={submitCustomer}
            >
              {busy ? '⏳ جاري الحفظ...' : editMode ? 'تحديث العميل' : '💾 حفظ العميل'}
            </button>
          </div>
        </div>
      </section>

      {/* CUSTOMERS LIST SECTION */}
      <section className="card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
            📂 قائمة العملاء المسجلين ({filteredCustomers.length})
          </h2>

          <input
            className="input text-xs py-1.5 w-52"
            placeholder="🔍 ابحث عن عميل بالاسم أو الهاتف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {filteredCustomers.length === 0 ? (
          <div className="py-20 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center">
            <span className="text-3xl mb-1">👤</span>
            لا يوجد عملاء مسجلون يطابقون التصفية الحالية.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-ink-200)] text-start text-[var(--text-muted)] font-bold">
                  <th className="py-2 text-start">العميل</th>
                  <th className="py-2 text-start">الهاتف</th>
                  <th className="py-2 text-start">المشتريات الإجمالية</th>
                  <th className="py-2 text-start">الرصيد (الدين المستحق عليه)</th>
                  <th className="py-2 text-center">الخيارات</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)] transition">
                    <td className="py-2.5">
                      <button
                        onClick={() => selectCustomer(c)}
                        className="text-start font-bold text-[var(--primary)] hover:underline"
                      >
                        {c.name}
                      </button>
                    </td>
                    <td className="py-2.5 font-mono" dir="ltr">{c.phone || '-'}</td>
                    <td className="py-2.5 font-semibold font-mono" dir="ltr">
                      {c.total_purchases.toLocaleString()} YER
                    </td>
                    <td className="py-2.5 font-bold">
                      <span className={c.balance > 0 ? 'text-red-700 font-extrabold' : 'text-green-700'}>
                        {c.balance.toLocaleString()} YER
                      </span>
                    </td>
                    <td className="py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => selectCustomer(c)}
                          className="btn border-[var(--color-ink-200)] hover:bg-teal-500/10 hover:text-[var(--primary)] px-2.5 py-0.5 text-[10px] font-bold"
                        >
                          📂 كشف الحساب
                        </button>
                        <button
                          onClick={() => startEdit(c)}
                          className="btn border-[var(--color-ink-200)] hover:bg-gray-100 px-2 py-0.5 text-[10px]"
                        >
                          ✏️ تعديل
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="btn border-transparent text-[var(--danger)] hover:bg-red-500/10 px-1.5 py-0.5 rounded-lg"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ACCOUNT STATEMENT & HISTORY MODAL */}
      {showLedgerModal && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-4xl p-6 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl text-xs overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-3 mb-4">
              <div>
                <h3 className="text-base font-extrabold">📂 كشف حساب العميل: {selectedCustomer.name}</h3>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  رقم الهاتف: {selectedCustomer.phone || 'غير مسجل'} | إجمالي مشترياته:{' '}
                  <span className="font-bold text-[var(--primary)]">{selectedCustomer.total_purchases.toLocaleString()} YER</span> |
                  الدين المتبقي عليه:{' '}
                  <span className="font-extrabold text-red-700">{selectedCustomer.balance.toLocaleString()} YER</span>
                </p>
              </div>
              <button
                onClick={() => {
                  setShowLedgerModal(false)
                  setSelectedCustomer(null)
                }}
                className="text-xs text-[var(--text-muted)] hover:text-red-500 font-bold"
              >
                ❌ إغلاق (Esc)
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5">
              {/* Left Column: Ledger Entries Table */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-[var(--text)] text-xs flex items-center gap-1">
                    📋 حركة قيود الدفتر المالي التاريخي ({ledger.length})
                  </h4>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowPayModal(true)}
                      className="btn btn-primary px-3 py-1 text-[10px] font-extrabold"
                    >
                      💵 سند قبض (سداد دفعة)
                    </button>
                    <button
                      onClick={handleExportStatement}
                      className="btn border-[var(--color-ink-200)] hover:bg-gray-100 px-3 py-1 text-[10px] font-bold"
                    >
                      📥 تصدير كشف الحساب (.txt)
                    </button>
                  </div>
                </div>

                {ledger.length === 0 ? (
                  <p className="py-10 text-center text-[var(--text-muted)]">لا توجد قيود مسجلة للعميل بعد.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[300px]">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--color-ink-200)] text-[var(--text-muted)] font-bold">
                          <th className="py-2 text-start">التاريخ</th>
                          <th className="py-2 text-start">الحركة</th>
                          <th className="py-2 text-start">المرجع</th>
                          <th className="py-2 text-start">القيمة (YER)</th>
                          <th className="py-2 text-start">الرصيد بعد</th>
                          <th className="py-2 text-start">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledger.map((entry) => {
                          const isCredit = entry.type === 'sale_credit'
                          return (
                            <tr key={entry.id} className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)] transition">
                              <td className="py-2 font-mono" dir="ltr">
                                {new Date(entry.created_at).toLocaleDateString('ar-YE')}
                              </td>
                              <td className="py-2 font-bold">
                                {isCredit ? (
                                  <span className="text-red-700">شراء آجل</span>
                                ) : entry.type === 'payment' ? (
                                  <span className="text-green-700">سند قبض</span>
                                ) : (
                                  <span>تعديل رصيد</span>
                                )}
                              </td>
                              <td className="py-2 font-mono" dir="ltr">{entry.reference || '-'}</td>
                              <td className="py-2 font-bold" dir="ltr">
                                {isCredit ? `+` : `−`}
                                {entry.amount.toLocaleString()}
                              </td>
                              <td className="py-2 font-bold" dir="ltr">
                                {entry.balance_after.toLocaleString()}
                              </td>
                              <td className="py-2 text-[var(--text-muted)] max-w-[120px] truncate" title={entry.notes || ''}>
                                {entry.notes || '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Right Column: Customer sales history */}
              <div className="space-y-4 border-t md:border-t-0 md:border-r border-[var(--color-ink-150)] pt-4 md:pt-0 md:pr-4">
                <div>
                  <h4 className="font-bold text-[var(--text)] mb-2 flex items-center gap-1">
                    🧾 الفواتير التاريخية للمشتريات ({sales.length})
                  </h4>
                  {sales.length === 0 ? (
                    <p className="text-[10px] text-[var(--text-muted)]">لا توجد فواتير بيع مسجلة للعميل.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                      {sales.map((sale) => (
                        <div key={sale.id} className="bg-[var(--bg)] p-1.5 rounded-lg border border border-[var(--color-ink-100)]">
                          <div className="flex justify-between font-bold">
                            <span dir="ltr" className="text-gray-800">{sale.invoice_number}</span>
                            <span dir="ltr" className="text-[var(--primary)]">{sale.total} YER</span>
                          </div>
                          <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-0.5">
                            <span>المدفوع: {sale.paid}</span>
                            <span>{new Date(sale.created_at).toLocaleDateString('ar-YE')}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER PAYMENT MODAL (سند قبض) */}
      {showPayModal && selectedCustomer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-sm p-5 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl text-xs">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-2 mb-3">
              <h3 className="text-sm font-extrabold flex items-center gap-1.5">
                💵 تسجيل سند قبض دفعة مالية
              </h3>
              <button
                onClick={() => {
                  setShowPayModal(false)
                  setError(null)
                }}
                className="text-xs text-[var(--text-muted)] hover:text-red-500 font-bold"
              >
                ❌ إلغاء
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-teal-50 text-teal-800 p-2.5 rounded-xl border border-teal-100">
                العميل المسدد للدفعة: <span className="font-bold">{selectedCustomer.name}</span>
                <br />
                الدين المستحق عليه حالياً: <span className="font-extrabold">{selectedCustomer.balance.toLocaleString()} YER</span>
              </div>

              <div>
                <label className="label">المبلغ المدفوع (YER) *</label>
                <input
                  type="number"
                  className="input font-bold"
                  dir="ltr"
                  min="1"
                  placeholder="YER 5,000"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                />
              </div>

              <div>
                <label className="label">المرجع (رقم سند القبض / الشيك / الحوالة)</label>
                <input
                  className="input font-mono"
                  placeholder="سند-قبض-987"
                  dir="ltr"
                  value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                />
              </div>

              <div>
                <label className="label">ملاحظات القبض</label>
                <textarea
                  className="input h-14 resize-none"
                  placeholder="سداد جزء من الدين المتبقي"
                  value={payForm.notes}
                  onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                />
              </div>

              {error && selectedCustomer && (
                <div className="rounded-xl bg-[var(--danger)]/10 p-2 text-xs text-[var(--danger)] font-bold text-center">
                  ⚠️ {error}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-[var(--color-ink-100)]">
                <button
                  className="btn border-[var(--color-ink-200)] text-[var(--text-muted)] hover:bg-gray-100"
                  onClick={() => {
                    setShowPayModal(false)
                    setError(null)
                  }}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button
                  className="btn btn-primary flex-1 py-2 font-bold"
                  disabled={busy || !payForm.amount}
                  onClick={submitPayment}
                >
                  {busy ? '⏳ جاري الحفظ...' : '💾 اعتماد سند القبض'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
