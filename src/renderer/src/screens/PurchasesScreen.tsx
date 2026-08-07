import { useCallback, useEffect, useState, useMemo } from 'react'
import type { Supplier, Product, PurchaseWithItems, Purchase, NewPurchaseItem } from '../../../shared/types'
import { unwrapIpcError } from '../App'

interface OrderLine {
  product_id: number
  product_name: string
  cartons: number
  units_per_carton: number
  quantity: number
  unit_cost: number
  total: number
}

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  pending: 'بانتظار الاستلام',
  partially_received: 'مستلم جزئيًا',
  received: 'مستلم بالكامل',
  cancelled: 'ملغى'
}

export default function PurchasesScreen() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])

  // Selection & Form State
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [orderReference, setOrderReference] = useState('')
  const [orderLines, setOrderLines] = useState<OrderLine[]>([])
  const [amountPaid, setAmountPaid] = useState('')
  const [markAsReceived, setMarkAsReceived] = useState(true)

  // Currently selected product to add
  const [currentProductId, setCurrentProductId] = useState('')
  const [currentCartons, setCurrentCartons] = useState('1')
  const [currentUnitsPerCarton, setCurrentUnitsPerCarton] = useState('12')
  const [currentUnitCost, setCurrentUnitCost] = useState('100')

  // Modals & Details
  const [activePurchase, setActivePurchase] = useState<PurchaseWithItems | null>(null)
  const [receiveQtys, setReceiveQtys] = useState<Record<number, number>>({}) // itemId -> received_quantity
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // UI state
  const [filterSupplier, setFilterSupplier] = useState('الكل')
  const [filterStatus, setFilterStatus] = useState('الكل')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Refresh lists
  const refreshAll = useCallback(async () => {
    try {
      const purList = await window.rafdLocal.purchases.list()
      setPurchases(purList)

      const supList = await window.rafdLocal.suppliers.list()
      setSuppliers(supList)

      const prodList = await window.rafdLocal.products.list()
      setProducts(prodList)
    } catch (e) {
      setError(unwrapIpcError(e))
    }
  }, [])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  // Automatically update units per carton & cost when product is selected
  useEffect(() => {
    if (currentProductId) {
      const p = products.find((prod) => prod.id === Number(currentProductId))
      if (p) {
        setCurrentUnitCost(String(p.cost || 0))
        // If it's weighable, we usually use default values
        if (p.sell_by_weight) {
          setCurrentUnitsPerCarton('1')
        } else {
          setCurrentUnitsPerCarton('12')
        }
      }
    }
  }, [currentProductId, products])

  // Calculate totals of current order being built
  const orderSubtotal = useMemo(() => {
    return orderLines.reduce((sum, line) => sum + line.total, 0)
  }, [orderLines])

  // Add line item to current order
  function addOrderLine() {
    if (!currentProductId) return
    const pId = Number(currentProductId)
    const product = products.find((prod) => prod.id === pId)
    if (!product) return

    const cartons = Number(currentCartons) || 0
    const units = Number(currentUnitsPerCarton) || 1
    const unitCost = Number(currentUnitCost) || 0

    if (cartons <= 0 || units <= 0 || unitCost < 0) {
      setError('يرجى التحقق من صحة مدخلات البند الجديد.')
      return
    }

    const qty = cartons * units
    const total = qty * unitCost

    const newLine: OrderLine = {
      product_id: pId,
      product_name: product.name_ar || product.name,
      cartons,
      units_per_carton: units,
      quantity: qty,
      unit_cost: unitCost,
      total
    }

    setOrderLines((prev) => [...prev, newLine])
    setError(null)
    setCurrentProductId('')
    setCurrentCartons('1')
  }

  // Remove order line
  function removeOrderLine(index: number) {
    setOrderLines((prev) => prev.filter((_, i) => i !== index))
  }

  // Submit new Purchase Order
  async function submitPurchase() {
    if (!selectedSupplierId) {
      setError('يرجى اختيار المورد للطلب.')
      return
    }
    if (orderLines.length === 0) {
      setError('يرجى إضافة بند شراء واحد على الأقل.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const sup = suppliers.find((s) => s.id === Number(selectedSupplierId))
      const payload = {
        supplier_id: Number(selectedSupplierId),
        supplier_name: sup ? sup.name : 'مورد مجهول',
        reference: orderReference.trim() || null,
        purchase_date: new Date().toISOString(),
        paid: amountPaid === '' ? 0 : Number(amountPaid),
        status: markAsReceived ? 'received' : 'pending',
        items: orderLines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          quantity: l.quantity,
          unit: 'pcs',
          unit_cost: l.unit_cost,
          total: l.total,
          units_per_carton: l.units_per_carton,
          cartons: l.cartons,
          received_quantity: markAsReceived ? l.quantity : 0
        }))
      }

      await window.rafdLocal.purchases.create(payload)

      // Reset Form State
      setOrderLines([])
      setOrderReference('')
      setAmountPaid('')
      setSelectedSupplierId('')
      setMarkAsReceived(true)
      setShowCreateModal(false)

      refreshAll()
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  // View existing Purchase Order
  async function viewPurchase(purchaseId: number) {
    setError(null)
    try {
      const full = await window.rafdLocal.purchases.get(purchaseId)
      setActivePurchase(full)
      // Populate default received quantities for the receive input boxes
      const qtys: Record<number, number> = {}
      for (const item of full.items) {
        qtys[item.id] = item.received_quantity || item.quantity
      }
      setReceiveQtys(qtys)
      setShowOrderModal(true)
    } catch (e) {
      setError(unwrapIpcError(e))
    }
  }

  // Update received quantities and confirm receipt (الاستلام الجزئي الحقيقي)
  async function handleConfirmReceipt() {
    if (!activePurchase) return
    setBusy(true)
    setError(null)
    try {
      // الكميات هنا تراكمية: إرسالها كقائمة استلام صريحة يمنع إعادة إرسال
      // بيانات البند الكاملة أو الوثوق بإجمالي قادم من الواجهة.
      const receivedItems = activePurchase.items.map((item) => ({
        product_id: item.product_id,
        received_quantity: Number(receiveQtys[item.id]) || 0
      }))

      await window.rafdLocal.purchases.update(activePurchase.purchase.id, {
        received_items: receivedItems
      })

      setShowOrderModal(false)
      setActivePurchase(null)
      refreshAll()
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  // Delete Purchase
  async function handleDeletePurchase(id: number) {
    if (window.confirm('هل أنت متأكد من حذف أمر الشراء غير المستلم؟ لا يمكن حذف أمر بدأ استلامه أو عليه حركة مالية.')) {
      setError(null)
      try {
        await window.rafdLocal.purchases.delete(id)
        refreshAll()
      } catch (e) {
        setError(unwrapIpcError(e))
      }
    }
  }

  // Print Purchase Order HTML Template via native printer PrintHtml
  async function handlePrintPurchase() {
    if (!activePurchase) return
    const { purchase, items } = activePurchase
    
    let html = `
      <div style="font-family: sans-serif; direction: rtl; padding: 20px;">
        <h2 style="text-align: center; color: #0d9488;">أمر شراء بضائع</h2>
        <table style="width: 100%; margin-bottom: 20px; font-size: 13px;">
          <tr>
            <td><strong>رقم الطلب:</strong> ${purchase.reference || `#ORD-${purchase.id}`}</td>
            <td style="text-align: left;"><strong>التاريخ:</strong> ${new Date(purchase.created_at).toLocaleDateString('ar-YE')}</td>
          </tr>
          <tr>
            <td><strong>المورد:</strong> ${purchase.supplier_name}</td>
            <td style="text-align: left;"><strong>الحالة:</strong> ${PURCHASE_STATUS_LABELS[purchase.status] || purchase.status}</td>
          </tr>
        </table>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f3f4f6; border-bottom: 2px solid #ccc;">
              <th style="padding: 8px; text-align: right; border: 1px solid #ddd;">الصنف</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">الكراتين</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">التعبئة</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">الكمية الكلية</th>
              <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">الكمية المستلمة</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">التكلفة للحبة</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">الإجمالي (YER)</th>
            </tr>
          </thead>
          <tbody>
    `

    for (const item of items) {
      html += `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${item.product_name}</td>
          <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.cartons}</td>
          <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.units_per_carton}</td>
          <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.quantity}</td>
          <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.received_quantity || 0}</td>
          <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">${item.unit_cost.toLocaleString()} YER</td>
          <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">${item.total.toLocaleString()} YER</td>
        </tr>
      `
    }

    html += `
          </tbody>
        </table>
        <div style="text-align: left; font-size: 14px; margin-top: 20px; font-weight: bold; border-top: 2px solid #ccc; padding-top: 10px;">
          <div>الإجمالي الكلي: ${purchase.total.toLocaleString()} YER</div>
          <div style="font-size: 12px; color: #555; margin-top: 5px;">المدفوع نقداً: ${purchase.paid.toLocaleString()} YER</div>
          <div style="font-size: 12px; color: #555;">المتبقي الآجل: ${(purchase.total - purchase.paid).toLocaleString()} YER</div>
        </div>
      </div>
    `

    const success = await window.rafdLocal.printer.printHtml(html)
    if (success) {
      alert('تم إرسال أمر الشراء إلى الطابعة بنجاح!')
    } else {
      setError('فشلت عملية الطباعة.')
    }
  }

  // Filter purchases based on selection
  const filteredPurchases = useMemo(() => {
    return purchases.filter((p) => {
      const matchesSupplier =
        filterSupplier === 'الكل' || p.supplier_id === Number(filterSupplier)
      const matchesStatus =
        filterStatus === 'الكل' || p.status === filterStatus
      return matchesSupplier && matchesStatus
    })
  }, [purchases, filterSupplier, filterStatus])

  return (
    <div className="flex flex-col gap-4 text-xs">
      {/* FILTER BAR & ACTION */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between bg-[var(--bg-elevated)] p-4 rounded-2xl shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center gap-2">
          {/* Supplier filter */}
          <select
            className="input text-xs py-1.5 w-44"
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
          >
            <option value="الكل">كل الموردين</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            className="input text-xs py-1.5 w-32"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="الكل">جميع الحالات</option>
            <option value="draft">مسودة</option>
            <option value="pending">بانتظار الاستلام</option>
            <option value="partially_received">مستلم جزئيًا</option>
            <option value="received">مستلم بالكامل</option>
            <option value="cancelled">ملغى</option>
          </select>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary px-4 py-2 font-bold text-xs"
        >
          ➕ أمر شراء وتوريد بضائع جديد
        </button>
      </div>

      {/* PURCHASES LIST */}
      <section className="card p-5">
        <h2 className="mb-4 text-sm font-bold text-[var(--text)] flex items-center gap-1.5">
          📊 أرشيف فواتير وأوامر الشراء ({filteredPurchases.length})
        </h2>

        {error && !showCreateModal && !showOrderModal && (
          <div className="mb-4 rounded-xl bg-red-100 p-3 text-red-700 font-bold text-center">
            ⚠️ {error}
          </div>
        )}

        {filteredPurchases.length === 0 ? (
          <div className="py-20 text-center text-[var(--text-muted)] flex flex-col items-center justify-center">
            <span className="text-3xl mb-1">🧾</span>
            لا توجد أوامر شراء مسجلة تطابق التصفية.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-ink-200)] text-[var(--text-muted)] font-bold">
                  <th className="py-2 text-start">المرجع</th>
                  <th className="py-2 text-start">المورد المستلم منه</th>
                  <th className="py-2 text-start">التاريخ</th>
                  <th className="py-2 text-start">المبلغ الإجمالي</th>
                  <th className="py-2 text-start">المدفوع نقداً</th>
                  <th className="py-2 text-start">الحالة</th>
                  <th className="py-2 text-center">الخيارات</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)] transition">
                    <td className="py-2.5 font-bold font-mono text-[var(--primary)]" dir="ltr">
                      {p.reference || `#ORD-${p.id}`}
                    </td>
                    <td className="py-2.5 font-semibold text-gray-800">{p.supplier_name}</td>
                    <td className="py-2.5 text-[var(--text-muted)]">
                      {new Date(p.created_at).toLocaleDateString('ar-YE')}
                    </td>
                    <td className="py-2.5 font-bold font-mono" dir="ltr">
                      {p.total.toLocaleString()} YER
                    </td>
                    <td className="py-2.5 font-semibold font-mono" dir="ltr">
                      {p.paid.toLocaleString()} YER
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          p.status === 'received'
                            ? 'bg-green-100 text-green-700'
                            : p.status === 'partially_received'
                              ? 'bg-blue-100 text-blue-700'
                              : p.status === 'cancelled'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {PURCHASE_STATUS_LABELS[p.status] || p.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => viewPurchase(p.id)}
                          className="btn border-[var(--color-ink-200)] hover:bg-teal-500/10 hover:text-[var(--primary)] px-2.5 py-0.5 text-[10px] font-bold"
                        >
                          👁️ عرض / استلام
                        </button>
                        <button
                          onClick={() => handleDeletePurchase(p.id)}
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

      {/* CREATE PURCHASE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-4xl p-6 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-3 mb-4">
              <h3 className="text-base font-extrabold">➕ إنشاء وتوريد بضائع جديد</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false)
                  setOrderLines([])
                  setError(null)
                }}
                className="text-xs text-[var(--text-muted)] hover:text-red-500 font-bold"
              >
                ❌ إلغاء
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6">
              {/* Left Column: Build Order Lines */}
              <div className="space-y-4">
                <div className="bg-[var(--bg)] p-3 rounded-xl border border-[var(--color-ink-150)] space-y-3">
                  <h4 className="font-bold text-gray-700">🛒 إضافة صنف بضاعة موردة للجدول:</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                    <div>
                      <label className="label">اختر الصنف *</label>
                      <select
                        className="input text-xs py-1"
                        value={currentProductId}
                        onChange={(e) => setCurrentProductId(e.target.value)}
                      >
                        <option value="">-- اختر السلعة --</option>
                        {products.map((prod) => (
                          <option key={prod.id} value={prod.id}>
                            {prod.name_ar || prod.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="label">عدد الكراتين الموردة</label>
                      <input
                        type="number"
                        className="input text-xs py-1"
                        dir="ltr"
                        min="1"
                        value={currentCartons}
                        onChange={(e) => setCurrentCartons(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="label">عدد الوحدات بالكرتون</label>
                      <input
                        type="number"
                        className="input text-xs py-1"
                        dir="ltr"
                        min="1"
                        value={currentUnitsPerCarton}
                        onChange={(e) => setCurrentUnitsPerCarton(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="label">تكلفة الحبة الواحدة YER</label>
                      <input
                        type="number"
                        className="input text-xs py-1"
                        dir="ltr"
                        min="0"
                        value={currentUnitCost}
                        onChange={(e) => setCurrentUnitCost(e.target.value)}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={addOrderLine}
                    disabled={!currentProductId}
                    className="btn btn-primary w-full py-1.5 text-xs font-bold"
                  >
                    ➕ إدراج الصنف في السلة
                  </button>
                </div>

                {/* Grid Table of Built lines */}
                <div>
                  <h4 className="font-bold text-gray-700 mb-2">📋 جدول أصناف الطلبية:</h4>
                  {orderLines.length === 0 ? (
                    <p className="py-10 text-center text-[var(--text-muted)] bg-[var(--bg)] rounded-xl border border-dashed border-[var(--color-ink-200)]">
                      الجدول فارغ. يرجى ملء البيانات وإدراج أصناف الطلب أعلاه.
                    </p>
                  ) : (
                    <div className="overflow-x-auto max-h-[220px]">
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--color-ink-200)] text-[var(--text-muted)] font-bold">
                            <th className="py-1 text-start">الصنف</th>
                            <th className="py-1 text-center">كراتين</th>
                            <th className="py-1 text-center">تعبئة</th>
                            <th className="py-1 text-center">الكمية الكلية</th>
                            <th className="py-1 text-start">التكلفة للحبة</th>
                            <th className="py-1 text-start">الإجمالي</th>
                            <th className="py-1 text-center">خيارات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orderLines.map((line, idx) => (
                            <tr key={idx} className="border-b border-[var(--color-ink-100)]">
                              <td className="py-1.5 font-bold text-gray-800">{line.product_name}</td>
                              <td className="py-1.5 text-center">{line.cartons}</td>
                              <td className="py-1.5 text-center">{line.units_per_carton}</td>
                              <td className="py-1.5 text-center font-bold font-mono">{line.quantity}</td>
                              <td className="py-1.5 font-mono text-teal-700" dir="ltr">
                                {line.unit_cost.toLocaleString()}
                              </td>
                              <td className="py-1.5 font-extrabold font-mono" dir="ltr">
                                {line.total.toLocaleString()}
                              </td>
                              <td className="py-1.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeOrderLine(idx)}
                                  className="text-[var(--danger)] hover:underline font-bold"
                                >
                                  ❌
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Order Settings & Submission */}
              <div className="space-y-4 border-t md:border-t-0 md:border-r border-[var(--color-ink-150)] pt-4 md:pt-0 md:pr-4">
                <h4 className="font-bold text-gray-700">⚙️ إعدادات فاتورة الشراء:</h4>

                <div>
                  <label className="label">المورد المستهدف *</label>
                  <select
                    className="input w-full"
                    value={selectedSupplierId}
                    onChange={(e) => setSelectedSupplierId(e.target.value)}
                  >
                    <option value="">-- اختر المورد --</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">رقم المرجع / الفاتورة الورقية</label>
                  <input
                    className="input font-mono"
                    placeholder="INV-PUR-5432"
                    dir="ltr"
                    value={orderReference}
                    onChange={(e) => setOrderReference(e.target.value)}
                  />
                </div>

                {/* Subtotal readout */}
                <div className="bg-[var(--bg)] p-3 rounded-xl border border-[var(--color-ink-150)] space-y-1.5 font-bold">
                  <div className="flex justify-between">
                    <span className="text-gray-600">الإجمالي الكلي:</span>
                    <span className="text-base text-red-700 font-mono" dir="ltr">
                      {orderSubtotal.toLocaleString()} YER
                    </span>
                  </div>
                </div>

                <div>
                  <label className="label">المبلغ المدفوع نقدًا للمورد (اتركه فارغاً = صفر مدفوع، الباقي آجل)</label>
                  <input
                    type="number"
                    className="input font-bold"
                    placeholder="0"
                    dir="ltr"
                    min="0"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value)}
                  />
                  {amountPaid === '' ? (
                    <div className="text-[10px] text-amber-700 font-bold mt-1">
                      ⚠️ حقل المدفوع فارغ: سيتم تسجيل كامل قيمة الفاتورة ({orderSubtotal.toLocaleString()} YER) كدين آجل للمورد في دفتر الحساب.
                    </div>
                  ) : Number(amountPaid) < orderSubtotal ? (
                    <div className="text-[10px] text-red-700 font-bold mt-1">
                      ⚠️ المتبقي ({(orderSubtotal - Number(amountPaid)).toLocaleString()} YER) سيسجل كدين آجل للمورد في الدفتر.
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 bg-[var(--bg)] p-2 rounded-xl border border-[var(--color-ink-150)]">
                  <input
                    type="checkbox"
                    id="mark_received_checkbox"
                    className="h-4 w-4 accent-[var(--primary)] cursor-pointer"
                    checked={markAsReceived}
                    onChange={(e) => setMarkAsReceived(e.target.checked)}
                  />
                  <label
                    htmlFor="mark_received_checkbox"
                    className="font-bold text-gray-700 cursor-pointer select-none"
                  >
                    ⚖️ استلام فوري وإضافة للمخزون
                  </label>
                </div>

                {error && showCreateModal && (
                  <div className="rounded-xl bg-[var(--danger)]/10 p-2.5 text-[10px] text-[var(--danger)] font-bold text-center">
                    ⚠️ {error}
                  </div>
                )}

                <button
                  onClick={submitPurchase}
                  className="btn btn-primary w-full py-3 text-xs font-bold"
                  disabled={busy || orderLines.length === 0}
                >
                  {busy ? '⏳ جاري الحفظ...' : '💾 حفظ واعتماد أمر الشراء'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL / PARTIAL RECEIVE MODAL */}
      {showOrderModal && activePurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-2xl p-6 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-3 mb-4">
              <div>
                <h3 className="text-base font-extrabold">🧾 تفاصيل أمر الشراء: {activePurchase.purchase.reference || `#ORD-${activePurchase.purchase.id}`}</h3>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  المورد: {activePurchase.purchase.supplier_name} | التاريخ:{' '}
                  {new Date(activePurchase.purchase.created_at).toLocaleString('ar-YE')}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowOrderModal(false)
                  setActivePurchase(null)
                  setError(null)
                }}
                className="text-xs text-[var(--text-muted)] hover:text-red-500 font-bold"
              >
                ❌ إغلاق
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center bg-[var(--bg)] p-3 rounded-xl border border-[var(--color-ink-150)] font-bold">
                <div>
                  <span className="text-gray-600 text-[10px]">إجمالي الفاتورة:</span>
                  <div className="text-sm font-mono text-red-700" dir="ltr">
                    {activePurchase.purchase.total.toLocaleString()} YER
                  </div>
                </div>
                <div>
                  <span className="text-gray-600 text-[10px]">المدفوع نقداً:</span>
                  <div className="text-sm font-mono text-green-700" dir="ltr">
                    {activePurchase.purchase.paid.toLocaleString()} YER
                  </div>
                </div>
                <div>
                  <span className="text-gray-600 text-[10px]">الحالة:</span>
                  <div className="text-xs">
                    {activePurchase.purchase.status === 'received' ? (
                      <span className="text-green-700">✔️ مستلم بالكامل</span>
                    ) : activePurchase.purchase.status === 'partially_received' ? (
                      <span className="text-blue-700">📦 مستلم جزئيًا — يمكن استكمال الاستلام</span>
                    ) : activePurchase.purchase.status === 'cancelled' ? (
                      <span className="text-red-700">✖️ أمر ملغى</span>
                    ) : (
                      <span className="text-amber-700">⏳ بانتظار الاستلام الفعلي</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Items List in Order */}
              <div>
                <h4 className="font-bold text-gray-700 mb-2">📋 تفاصيل السلع الموردة:</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-start border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--color-ink-200)] text-[var(--text-muted)] font-bold">
                        <th className="py-1 text-start">اسم الصنف</th>
                        <th className="py-1 text-center">كراتين</th>
                        <th className="py-1 text-center">الكمية المطلوبة</th>
                        <th className="py-1 text-center">الكمية المستلمة فعلياً</th>
                        <th className="py-1 text-start">التكلفة YER</th>
                        <th className="py-1 text-start">الإجمالي YER</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activePurchase.items.map((item) => (
                        <tr key={item.id} className="border-b border-[var(--color-ink-100)]">
                          <td className="py-2 font-bold text-gray-800">{item.product_name}</td>
                          <td className="py-2 text-center">{item.cartons}</td>
                          <td className="py-2 text-center font-mono font-bold">{item.quantity}</td>
                          <td className="py-2 text-center font-bold">
                            {activePurchase.purchase.status === 'received' ? (
                              <span className="text-green-700 font-mono">{item.received_quantity}</span>
                            ) : (
                              /* Editable input for real partial receipt! */
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="number"
                                  className="input w-16 py-0.5 text-center font-extrabold text-xs"
                                  dir="ltr"
                                  min="0"
                                  max={item.quantity}
                                  value={receiveQtys[item.id] || 0}
                                  onChange={(e) =>
                                    setReceiveQtys({
                                      ...receiveQtys,
                                      [item.id]: Number(e.target.value) || 0
                                    })
                                  }
                                />
                                <span className="text-[10px] font-bold text-[var(--text-muted)]">حبة</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2 font-mono text-gray-700" dir="ltr">{item.unit_cost}</td>
                          <td className="py-2 font-extrabold font-mono" dir="ltr">{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {error && showOrderModal && (
                <div className="rounded-xl bg-[var(--danger)]/10 p-2.5 text-xs text-[var(--danger)] font-bold text-center">
                  ⚠️ {error}
                </div>
              )}

              {/* Actions Footer inside modal */}
              <div className="flex gap-2 pt-3 border-t border-[var(--color-ink-100)]">
                <button
                  onClick={handlePrintPurchase}
                  className="btn border-[var(--color-ink-200)] hover:bg-gray-100 text-gray-700 font-bold"
                >
                  🖨️ طباعة مستند الطلب
                </button>

                <div className="flex-1"></div>

                <button
                  onClick={() => {
                    setShowOrderModal(false)
                    setActivePurchase(null)
                    setError(null)
                  }}
                  className="btn border-[var(--color-ink-200)] text-[var(--text-muted)] hover:bg-gray-100"
                  disabled={busy}
                >
                  إغلاق
                </button>

                {activePurchase.purchase.status !== 'received' && activePurchase.purchase.status !== 'cancelled' && (
                  <button
                    onClick={handleConfirmReceipt}
                    className="btn btn-primary px-5 py-2 font-bold"
                    disabled={busy}
                  >
                    {busy ? '⏳ جاري الحفظ...' : '✔️ تأكيد استلام الشحنة وتحديث المخازن'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
