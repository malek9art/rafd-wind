import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Product } from '../../../shared/types'
import { unwrapIpcError } from '../App'
import { ALL_CATEGORIES } from '../../../shared/catalog'

type TabType = 'all' | 'low_stock' | 'out_of_stock'

export default function InventoryScreen() {
  const [products, setProducts] = useState<Product[]>([])
  const [selectedTab, setSelectedCategoryTab] = useState<TabType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('الكل')
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // Modal State
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [directStock, setDirectStock] = useState('')
  const [restockCartons, setRestockCartons] = useState('')
  const [restockCartonCost, setRestockCartonCost] = useState('')
  const [restockUnitsPerCarton, setRestockUnitsPerCarton] = useState('12')
  const [adjustmentMode, setAdjustmentMode] = useState<'direct' | 'carton'>('direct')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    window.rafdLocal.products
      .list()
      .then(setProducts)
      .catch((e) => setError(unwrapIpcError(e)))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Computed lists based on tabs
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Tab filter
      let matchesTab = true
      if (selectedTab === 'low_stock') {
        matchesTab = p.stock <= p.min_stock && p.stock > 0
      } else if (selectedTab === 'out_of_stock') {
        matchesTab = p.stock <= 0
      }

      // Category filter
      const matchesCategory =
        selectedCategoryFilter === 'الكل' || p.category === selectedCategoryFilter

      // Search query
      const query = searchQuery.trim().toLowerCase()
      const matchesSearch =
        query === '' ||
        p.name.toLowerCase().includes(query) ||
        (p.name_ar || '').toLowerCase().includes(query) ||
        (p.sku || '').toLowerCase().includes(query) ||
        (p.barcode || '').toLowerCase().includes(query)

      return matchesTab && matchesCategory && matchesSearch
    })
  }, [products, selectedTab, selectedCategoryFilter, searchQuery])

  // Count states for display
  const counts = useMemo(() => {
    const all = products.length
    const low = products.filter((p) => p.stock <= p.min_stock && p.stock > 0).length
    const out = products.filter((p) => p.stock <= 0).length
    return { all, low, out }
  }, [products])

  // Open modal
  function openAdjustment(p: Product) {
    setSelectedProduct(p)
    setDirectStock(String(p.stock))
    setRestockCartons('')
    setRestockCartonCost('')
    setRestockUnitsPerCarton('12')
    setAdjustmentMode('direct')
    setError(null)
    setSuccessMsg(null)
  }

  function closeModal() {
    setSelectedProduct(null)
    setError(null)
    setSuccessMsg(null)
  }

  // Save stock change
  async function saveAdjustment() {
    if (!selectedProduct) return
    setBusy(true)
    setError(null)
    setSuccessMsg(null)

    try {
      if (adjustmentMode === 'direct') {
        const val = Number(directStock)
        if (isNaN(val) || val < 0) {
          throw new Error('يرجى إدخال كمية مخزون صالحة وصفرية أو أكثر')
        }
        await window.rafdLocal.products.update(selectedProduct.id, { stock: val })
        setSuccessMsg('تم تحديث المخزون يدوياً بنجاح!')
      } else {
        const cartonsVal = Number(restockCartons)
        const costVal = Number(restockCartonCost)
        const unitsVal = Number(restockUnitsPerCarton)

        if (isNaN(cartonsVal) || cartonsVal <= 0) {
          throw new Error('يرجى إدخال عدد كراتين صالح وأكبر من صفر')
        }
        if (isNaN(costVal) || costVal < 0) {
          throw new Error('يرجى إدخال تكلفة كرتون صالحة وصفر أو أكثر')
        }
        if (isNaN(unitsVal) || unitsVal <= 0) {
          throw new Error('يرجى إدخال عدد قطع الكرتون صالح وأكبر من صفر')
        }

        await window.rafdLocal.products.restock(
          selectedProduct.id,
          cartonsVal,
          costVal,
          unitsVal
        )
        setSuccessMsg('تمت إعادة تخزين السلع وحساب التكلفة المرجحة بنجاح!')
      }

      refresh()
      setTimeout(() => {
        closeModal()
      }, 1000)
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  // Live restock preview computation
  const restockPreview = useMemo(() => {
    if (!selectedProduct || adjustmentMode !== 'carton') return null
    const cartonsVal = Number(restockCartons) || 0
    const costVal = Number(restockCartonCost) || 0
    const unitsVal = Number(restockUnitsPerCarton) || 0

    if (cartonsVal <= 0 || unitsVal <= 0) return null

    const addedQty = cartonsVal * unitsVal
    const newStock = Math.max(0, selectedProduct.stock + addedQty)
    const newUnitCost = costVal / unitsVal

    let newCost = selectedProduct.cost
    if (newStock > 0) {
      const totalCurrentCost = Math.max(0, selectedProduct.stock) * selectedProduct.cost
      const totalNewCost = addedQty * newUnitCost
      newCost = Math.round(((totalCurrentCost + totalNewCost) / newStock) * 100) / 100
    }

    return {
      addedQty,
      newStock,
      newUnitCost: Math.round(newUnitCost * 100) / 100,
      newCost
    }
  }, [selectedProduct, adjustmentMode, restockCartons, restockCartonCost, restockUnitsPerCarton])

  return (
    <div className="flex flex-col gap-4">
      {/* FILTER TABS & SEARCH BAR */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between bg-[var(--bg-elevated)] p-4 rounded-2xl shadow-[var(--shadow-soft)]">
        {/* Tab Filters */}
        <div className="flex gap-2 border-b border-gray-100 md:border-b-0 pb-2 md:pb-0">
          <button
            onClick={() => setSelectedCategoryTab('all')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              selectedTab === 'all'
                ? 'bg-[var(--primary)] text-white'
                : 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg)]'
            }`}
          >
            📦 جميع السلع ({counts.all})
          </button>
          <button
            onClick={() => setSelectedCategoryTab('low_stock')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              selectedTab === 'low_stock'
                ? 'bg-amber-600 text-white font-extrabold'
                : 'bg-transparent text-amber-700 hover:bg-amber-500/10'
            }`}
          >
            ⚠️ منخفض المخزون ({counts.low})
          </button>
          <button
            onClick={() => setSelectedCategoryTab('out_of_stock')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
              selectedTab === 'out_of_stock'
                ? 'bg-red-600 text-white font-extrabold'
                : 'bg-transparent text-red-700 hover:bg-red-500/10'
            }`}
          >
            🚨 نافد ({counts.out})
          </button>
        </div>

        {/* Real-time search tools */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input text-xs py-1.5 w-48"
            placeholder="🔍 ابحث عن سلعة لمراجعة مخزونها..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <select
            className="input text-xs py-1.5 w-32"
            value={selectedCategoryFilter}
            onChange={(e) => setSelectedCategoryFilter(e.target.value)}
          >
            <option value="الكل">جميع الفئات</option>
            {ALL_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.name}>
                {cat.icon} {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* TABLE/LIST CARD */}
      <section className="card p-5">
        <h2 className="mb-4 text-base font-bold text-[var(--text)] flex items-center gap-1.5">
          📊 حركة المخزون الفعلي ({filteredProducts.length} سلع معروضة)
        </h2>

        {error && !selectedProduct && (
          <div className="mb-4 rounded-xl bg-red-100 p-3 text-xs text-red-700 font-bold text-center">
            ⚠️ {error}
          </div>
        )}

        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-sm text-[var(--text-muted)]">
            <span className="text-4xl mb-2">📁</span>
            لا توجد سلع تطابق تصنيف المخزون المحدد حالياً.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-ink-200)] text-start text-[var(--text-muted)] font-bold">
                  <th className="py-2.5 text-start">المنتج</th>
                  <th className="py-2.5 text-start">الوحدة</th>
                  <th className="py-2.5 text-start">سعر التكلفة الحالي</th>
                  <th className="py-2.5 text-start">سعر البيع الحالي</th>
                  <th className="py-2.5 text-start">المخزون الفعلي</th>
                  <th className="py-2.5 text-start">حالة السعة</th>
                  <th className="py-2.5 text-center">تحديث المخازن</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const isLow = p.stock <= p.min_stock && p.stock > 0
                  const isOut = p.stock <= 0

                  return (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)] transition"
                    >
                      <td className="py-2.5">
                        <div className="font-bold text-[var(--text)]">
                          {p.name_ar || p.name}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono" dir="ltr">
                          {p.name} {p.sku ? `| SKU: ${p.sku}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 text-[var(--text-muted)]">{p.unit}</td>
                      <td className="py-2.5 font-bold font-mono text-gray-700" dir="ltr">
                        {p.cost.toLocaleString()} YER
                      </td>
                      <td className="py-2.5 font-bold font-mono text-teal-700" dir="ltr">
                        {p.price.toLocaleString()} YER
                      </td>
                      <td className="py-2.5 font-extrabold text-sm font-mono">
                        <span className={isOut ? 'text-red-700' : isLow ? 'text-amber-700' : 'text-green-700'}>
                          {p.stock}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {isOut ? (
                          <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[9px] font-bold">
                            نفد بالكامل
                          </span>
                        ) : isLow ? (
                          <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[9px] font-bold">
                            مخزون منخفض
                          </span>
                        ) : (
                          <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[9px] font-bold">
                            متوفر وممتاز
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-center">
                        <button
                          onClick={() => openAdjustment(p)}
                          className="btn btn-primary px-3 py-1 text-[10px] font-bold"
                        >
                          🔄 تحديث المخزون
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* INVENTORY ADJUSTMENT MODAL */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-md p-6 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl text-xs">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-3 mb-4">
              <h3 className="text-base font-extrabold">
                ⚙️ تحديث مخازن: {selectedProduct.name_ar || selectedProduct.name}
              </h3>
              <button
                onClick={closeModal}
                className="text-xs text-[var(--text-muted)] hover:text-red-500 font-bold"
              >
                ❌ إلغاء (Esc)
              </button>
            </div>

            {/* Toggle Modes */}
            <div className="flex gap-2 mb-4 bg-[var(--bg)] p-1 rounded-xl border border-[var(--color-ink-150)]">
              <button
                type="button"
                onClick={() => {
                  setAdjustmentMode('direct')
                  setError(null)
                  setSuccessMsg(null)
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  adjustmentMode === 'direct'
                    ? 'bg-white shadow text-[var(--primary)]'
                    : 'bg-transparent text-[var(--text-muted)]'
                }`}
              >
                ✏️ كمية مباشرة
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdjustmentMode('carton')
                  setError(null)
                  setSuccessMsg(null)
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition ${
                  adjustmentMode === 'carton'
                    ? 'bg-white shadow text-[var(--primary)]'
                    : 'bg-transparent text-[var(--text-muted)]'
                }`}
              >
                📦 توريد الكراتين (إعادة تخزين)
              </button>
            </div>

            {/* ADJUSTMENT BODY */}
            <div className="space-y-4">
              {adjustmentMode === 'direct' ? (
                <div>
                  <label className="label">المخزون الفعلي الحالي في المحل ({selectedProduct.unit})</label>
                  <input
                    type="number"
                    className="input font-bold"
                    dir="ltr"
                    min="0"
                    placeholder="0"
                    value={directStock}
                    onChange={(e) => setDirectStock(e.target.value)}
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
                    تعديل المخزون مباشرة سيبدل القيمة الحالية في قاعدة البيانات، بدون تعديل تكلفة المنتج.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">عدد الكراتين الموردة</label>
                      <input
                        type="number"
                        className="input"
                        dir="ltr"
                        min="1"
                        placeholder="2"
                        value={restockCartons}
                        onChange={(e) => setRestockCartons(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">تكلفة الكرتون الواحد (YER)</label>
                      <input
                        type="number"
                        className="input"
                        dir="ltr"
                        min="0"
                        placeholder="2400"
                        value={restockCartonCost}
                        onChange={(e) => setRestockCartonCost(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label">عدد الحبات داخل الكرتون الواحد</label>
                    <input
                      type="number"
                      className="input"
                      dir="ltr"
                      min="1"
                      placeholder="12"
                      value={restockUnitsPerCarton}
                      onChange={(e) => setRestockUnitsPerCarton(e.target.value)}
                    />
                  </div>

                  {/* RESTOCK PREVIEW DISPLAY */}
                  {restockPreview && (
                    <div className="bg-teal-50/50 rounded-xl p-3 border border-teal-100 space-y-1.5">
                      <h4 className="font-bold text-teal-800 text-[10px] mb-1">📋 معاينة احتساب متوسط التكلفة:</h4>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-600">الكمية المضافة للمخازن:</span>
                        <span className="font-bold text-teal-900">{restockPreview.addedQty} {selectedProduct.unit}</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-600">سعر تكلفة الحبة الموردة:</span>
                        <span className="font-bold text-teal-900" dir="ltr">{restockPreview.newUnitCost} YER</span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-600">المخزون الكلي الجديد:</span>
                        <span className="font-bold text-teal-900">{restockPreview.newStock} {selectedProduct.unit}</span>
                      </div>
                      <div className="flex justify-between text-[10px] border-t border-dashed border-teal-200 pt-1 text-sm font-bold">
                        <span className="text-teal-900">متوسط التكلفة المرجح الجديد:</span>
                        <span className="text-teal-900 font-mono" dir="ltr">{restockPreview.newCost.toLocaleString()} YER</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)] font-bold text-center">
                  ⚠️ {error}
                </div>
              )}

              {successMsg && (
                <div className="rounded-xl bg-green-50 p-3 text-xs text-green-700 font-bold text-center">
                  🎉 {successMsg}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-[var(--color-ink-100)]">
                <button
                  className="btn border-[var(--color-ink-200)] text-[var(--text-muted)] hover:bg-gray-100"
                  onClick={closeModal}
                  disabled={busy}
                >
                  إلغاء
                </button>
                <button
                  className="btn btn-primary flex-1 py-2.5 font-bold"
                  disabled={busy || (adjustmentMode === 'carton' && !restockPreview)}
                  onClick={saveAdjustment}
                >
                  {busy ? '⏳ جاري التحديث...' : '💾 حفظ التحديثات'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
