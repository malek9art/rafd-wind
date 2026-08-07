import { useCallback, useEffect, useState, useMemo } from 'react'
import type { Supplier, SupplierLedgerEntry, Purchase, Product } from '../../../shared/types'
import { unwrapIpcError } from '../App'

const EMPTY_FORM = { id: undefined as number | undefined, name: '', phone: '', email: '', notes: '' }
const EMPTY_PAY_FORM = { amount: '', notes: '', reference: '' }

export default function SuppliersScreen() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [ledger, setLedger] = useState<SupplierLedgerEntry[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [supplierProducts, setSupplierProducts] = useState<Product[]>([])

  // UI state
  const [form, setForm] = useState(EMPTY_FORM)
  const [payForm, setPayForm] = useState(EMPTY_PAY_FORM)
  const [editMode, setEditMode] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showLedgerModal, setShowLedgerModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Load suppliers list
  const refreshSuppliers = useCallback(() => {
    window.rafdLocal.suppliers
      .list()
      .then(setSuppliers)
      .catch((e) => setError(unwrapIpcError(e)))
  }, [])

  useEffect(() => {
    refreshSuppliers()
  }, [refreshSuppliers])

  // Load supplier details when one is selected
  const selectSupplier = async (supplier: Supplier) => {
    setSelectedSupplier(supplier)
    setError(null)
    try {
      // 1. Load supplier ledger entries
      const ledgerEntries = await window.rafdLocal.supplierLedger.listBySupplier(supplier.id)
      setLedger(ledgerEntries)

      // 2. Load supplier purchases history
      const supplierPurchases = await window.rafdLocal.purchases.list({ supplier_id: supplier.id })
      setPurchases(supplierPurchases)

      // 3. Load associated products
      const allProducts = await window.rafdLocal.products.list()
      const associated = allProducts.filter((p) => p.supplier_id === supplier.id)
      setSupplierProducts(associated)

      setShowLedgerModal(true)
    } catch (e) {
      setError(unwrapIpcError(e))
    }
  }

  // Create or Update Supplier
  async function submitSupplier() {
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
        await window.rafdLocal.suppliers.update(form.id, payload)
        setEditMode(false)
        if (selectedSupplier && selectedSupplier.id === form.id) {
          setSelectedSupplier({ ...selectedSupplier, ...payload })
        }
      } else {
        await window.rafdLocal.suppliers.create(payload)
      }

      setForm(EMPTY_FORM)
      refreshSuppliers()
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  // Edit Supplier
  function startEdit(s: Supplier) {
    setEditMode(true)
    setForm({
      id: s.id,
      name: s.name,
      phone: s.phone || '',
      email: s.email || '',
      notes: s.notes || ''
    })
  }

  function cancelEdit() {
    setEditMode(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  // Delete/Disable Supplier
  async function handleDelete(id: number) {
    if (window.confirm('هل أنت متأكد من حذف هذا المورد؟ لا يمكن حذفه إذا كان مرتبطاً بحركات مالية أو فواتير مشتريات تاريخية.')) {
      setError(null)
      try {
        await window.rafdLocal.suppliers.delete(id)
        refreshSuppliers()
        if (selectedSupplier && selectedSupplier.id === id) {
          setSelectedSupplier(null)
          setShowLedgerModal(false)
        }
      } catch (e) {
        setError(unwrapIpcError(e))
      }
    }
  }

  // Register Supplier Payment (سداد دفعة)
  async function submitPayment() {
    if (!selectedSupplier || !payForm.amount) return
    const amt = Number(payForm.amount)
    if (isNaN(amt) || amt <= 0) {
      setError('يرجى إدخال مبلغ سداد صحيح أكبر من الصفر')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await window.rafdLocal.supplierLedger.addEntry({
        supplier_id: selectedSupplier.id,
        amount: amt,
        type: 'payment',
        reference: payForm.reference.trim() || null,
        notes: payForm.notes.trim() || null
      })

      // Refresh list and supplier details
      refreshSuppliers()
      const updatedSupplier = await window.rafdLocal.suppliers.list()
      const current = updatedSupplier.find((s) => s.id === selectedSupplier.id)
      if (current) {
        setSelectedSupplier(current)
        const ledgerEntries = await window.rafdLocal.supplierLedger.listBySupplier(current.id)
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
    if (!selectedSupplier) return
    const filename = `kashf_hisab_${selectedSupplier.name.replace(/\s+/g, '_')}.txt`
    
    let text = `--------------------------------------------------\n`
    text += `كشف حساب مورد: ${selectedSupplier.name}\n`
    text += `تاريخ التصدير: ${new Date().toLocaleString('ar-YE')}\n`
    text += `الهاتف: ${selectedSupplier.phone || 'غير مسجل'}\n`
    text += `الرصيد المتبقي الحالي للمورد: ${selectedSupplier.balance.toLocaleString()} YER\n`
    text += `--------------------------------------------------\n\n`
    text += `التاريخ       | الحركة      | المرجع    | المبلغ (YER) | الرصيد بعد\n`
    text += `--------------------------------------------------\n`

    for (const entry of ledger) {
      const typeAr = entry.type === 'purchase_credit' ? 'شراء آجل' : entry.type === 'payment' ? 'سند صرف' : 'تعديل'
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

  // Real-time suppliers filtering
  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((s) => {
      const query = searchQuery.trim().toLowerCase()
      return (
        query === '' ||
        s.name.toLowerCase().includes(query) ||
        (s.phone || '').includes(query) ||
        (s.notes || '').toLowerCase().includes(query)
      )
    })
  }, [suppliers, searchQuery])

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[330px_1fr]">
      {/* FORM SECTION */}
      <section className="card h-fit p-5 text-xs">
        <h2 className="mb-4 text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
          {editMode ? '📝 تعديل بيانات مورد' : '👤 إضافة مورد جديد'}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="label">اسم المورد / الشركة *</label>
            <input
              className="input text-xs"
              placeholder="مثال: شركة البركة للمواد الغذائية"
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
              placeholder="supplier@mail.com"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div>
            <label className="label">ملاحظات / عناوين</label>
            <textarea
              className="input text-xs h-16 resize-none"
              placeholder="صنعاء - شارع تعز"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {error && !selectedSupplier && (
            <div className="rounded-xl bg-[var(--danger)]/10 p-2.5 text-xs text-[var(--danger)] font-bold text-center">
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
              className="btn btn-primary flex-1 py-2"
              disabled={busy || !form.name.trim()}
              onClick={submitSupplier}
            >
              {busy ? '⏳ جاري الحفظ...' : editMode ? 'تحديث المورد' : '💾 حفظ المورد'}
            </button>
          </div>
        </div>
      </section>

      {/* SUPPLIERS LIST SECTION */}
      <section className="card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
            📂 قائمة الموردين المتعاقدين ({filteredSuppliers.length})
          </h2>

          <input
            className="input text-xs py-1.5 w-52"
            placeholder="🔍 ابحث عن مورد بالاسم أو الهاتف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {filteredSuppliers.length === 0 ? (
          <div className="py-20 text-center text-xs text-[var(--text-muted)] flex flex-col items-center justify-center">
            <span className="text-3xl mb-1">👤</span>
            لا يوجد موردون مسجلون يطابقون التصفية الحالية.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-ink-200)] text-start text-[var(--text-muted)] font-bold">
                  <th className="py-2 text-start">المورد / الشركة</th>
                  <th className="py-2 text-start">الهاتف</th>
                  <th className="py-2 text-start">الحساب / المديونية الحالية</th>
                  <th className="py-2 text-start">العنوان / ملاحظات</th>
                  <th className="py-2 text-center">الخيارات</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)] transition">
                    <td className="py-2.5">
                      <button
                        onClick={() => selectSupplier(s)}
                        className="text-start font-bold text-[var(--primary)] hover:underline"
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="py-2.5 font-mono" dir="ltr">{s.phone || '-'}</td>
                    <td className="py-2.5 font-bold">
                      <span className={s.balance > 0 ? 'text-red-700 font-extrabold' : 'text-green-700'}>
                        {s.balance.toLocaleString()} YER
                      </span>
                    </td>
                    <td className="py-2.5 text-[var(--text-muted)] max-w-xs truncate">{s.notes || '-'}</td>
                    <td className="py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => selectSupplier(s)}
                          className="btn border-[var(--color-ink-200)] hover:bg-teal-500/10 hover:text-[var(--primary)] px-2 py-0.5 text-[10px] font-bold"
                        >
                          📂 كشف الحساب
                        </button>
                        <button
                          onClick={() => startEdit(s)}
                          className="btn border-[var(--color-ink-200)] hover:bg-gray-100 px-2 py-0.5 text-[10px]"
                        >
                          ✏️ تعديل
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="btn border-transparent text-[var(--danger)] hover:bg-red-500/10 px-1.5 py-0.5 text-[10px] rounded-lg"
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
      {showLedgerModal && selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-4xl p-6 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl text-xs overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-3 mb-4">
              <div>
                <h3 className="text-base font-extrabold">📂 كشف حساب المورد: {selectedSupplier.name}</h3>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  رقم الهاتف: {selectedSupplier.phone || 'غير مسجل'} | مديونيتنا الحالية له:{' '}
                  <span className="font-bold text-red-700">{selectedSupplier.balance.toLocaleString()} YER</span>
                </p>
              </div>
              <button
                onClick={() => setShowLedgerModal(false)}
                className="text-xs text-[var(--text-muted)] hover:text-red-500 font-bold"
              >
                ❌ إغلاق (Esc)
              </button>
            </div>

            {/* TAB SYSTEM INSIDE MODAL */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-5">
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
                      💵 سند صرف (سداد دفعة)
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
                  <p className="py-10 text-center text-[var(--text-muted)]">لا توجد قيود مسجلة لهذا المورد بعد.</p>
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
                          const isCredit = entry.type === 'purchase_credit'
                          return (
                            <tr key={entry.id} className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)] transition">
                              <td className="py-2 font-mono" dir="ltr">
                                {new Date(entry.created_at).toLocaleDateString('ar-YE')}
                              </td>
                              <td className="py-2 font-bold">
                                {isCredit ? (
                                  <span className="text-red-700">شراء آجل</span>
                                ) : entry.type === 'payment' ? (
                                  <span className="text-green-700">سند صرف</span>
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

              {/* Right Column: Supplier purchases and products quick lists */}
              <div className="space-y-4 border-t md:border-t-0 md:border-r border-[var(--color-ink-150)] pt-4 md:pt-0 md:pr-4">
                {/* Associated Products */}
                <div>
                  <h4 className="font-bold text-[var(--text)] mb-2 flex items-center gap-1">
                    📦 السلع التابعة للمورد ({supplierProducts.length})
                  </h4>
                  {supplierProducts.length === 0 ? (
                    <p className="text-[10px] text-[var(--text-muted)]">لا توجد منتجات مسجلة للمورد.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                      {supplierProducts.map((p) => (
                        <div key={p.id} className="flex justify-between items-center bg-[var(--bg)] p-1.5 rounded-lg border border-[var(--color-ink-100)]">
                          <span className="font-semibold text-gray-800 line-clamp-1">{p.name_ar || p.name}</span>
                          <span className="font-bold font-mono text-[var(--primary)]" dir="ltr">{p.price} YER</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Purchases Orders history */}
                <div className="border-t border-[var(--color-ink-100)] pt-3">
                  <h4 className="font-bold text-[var(--text)] mb-2 flex items-center gap-1">
                    🧾 أوامر الشراء التاريخية ({purchases.length})
                  </h4>
                  {purchases.length === 0 ? (
                    <p className="text-[10px] text-[var(--text-muted)]">لا توجد مشتريات تاريخية.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                      {purchases.map((pur) => (
                        <div key={pur.id} className="bg-[var(--bg)] p-1.5 rounded-lg border border-[var(--color-ink-100)]">
                          <div className="flex justify-between font-bold">
                            <span dir="ltr" className="text-gray-800">{pur.reference || `#ORD-${pur.id}`}</span>
                            <span dir="ltr" className="text-red-700">{pur.total} YER</span>
                          </div>
                          <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-0.5">
                            <span>
                              الحالة:{' '}
                              {pur.status === 'received'
                                ? 'تم الاستلام بالكامل'
                                : pur.status === 'partially_received'
                                  ? 'استلام جزئي'
                                  : pur.status === 'cancelled'
                                    ? 'ملغى'
                                    : 'بانتظار الاستلام'}
                            </span>
                            <span>{new Date(pur.created_at).toLocaleDateString('ar-YE')}</span>
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

      {/* SAND / REGISTER PAYMENT MODAL (سند صرف) */}
      {showPayModal && selectedSupplier && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-sm p-5 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl text-xs">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-2 mb-3">
              <h3 className="text-sm font-extrabold flex items-center gap-1.5">
                💵 تسجيل سند صرف دفعة مالية
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
              <div className="bg-red-50 text-red-800 p-2.5 rounded-xl border border-red-100">
                المستفيد الحالي: <span className="font-bold">{selectedSupplier.name}</span>
                <br />
                المديونية الحالية المتبقية له: <span className="font-extrabold">{selectedSupplier.balance.toLocaleString()} YER</span>
              </div>

              <div>
                <label className="label">المبلغ المسدد (YER) *</label>
                <input
                  type="number"
                  className="input font-bold"
                  dir="ltr"
                  min="1"
                  placeholder="YER 10,000"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                />
              </div>

              <div>
                <label className="label">المرجع (رقم السند المالي / الشيك)</label>
                <input
                  className="input font-mono"
                  placeholder="سند-12345"
                  dir="ltr"
                  value={payForm.reference}
                  onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })}
                />
              </div>

              <div>
                <label className="label">ملاحظات الصرف</label>
                <textarea
                  className="input h-14 resize-none"
                  placeholder="دفعة تحت الحساب لشهر يوليو"
                  value={payForm.notes}
                  onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                />
              </div>

              {error && selectedSupplier && (
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
                  {busy ? '⏳ جاري الحفظ...' : '💾 اعتماد سند الصرف'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
