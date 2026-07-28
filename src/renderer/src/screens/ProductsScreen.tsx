import { useCallback, useEffect, useState, useMemo } from 'react'
import type { Product } from '../../../shared/types'
import { unwrapIpcError } from '../App'
import { ALL_CATEGORIES, isWeightCategory } from '../../../shared/catalog'

const EMPTY_FORM = {
  id: undefined as number | undefined,
  name: '',
  name_ar: '',
  price: '',
  cost: '',
  stock: '',
  unit: 'حبة',
  category: 'عام',
  sku: '',
  barcode: '',
  min_stock: '5',
  sell_by_weight: false
}

export default function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editMode, setEditMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('الكل')
  const [error, setError] = useState<string | null>(null)
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

  // Automatically check "sell_by_weight" if category dictates it
  useEffect(() => {
    if (!editMode && form.category) {
      const byWeight = isWeightCategory(form.category)
      setForm((prev) => ({ ...prev, sell_by_weight: byWeight, unit: byWeight ? 'كجم' : 'حبة' }))
    }
  }, [form.category, editMode])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        name_ar: form.name_ar.trim() || null,
        price: Number(form.price),
        cost: form.cost === '' ? 0 : Number(form.cost),
        stock: form.stock === '' ? 0 : Number(form.stock),
        unit: form.unit.trim() || 'حبة',
        category: form.category.trim() || 'عام',
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        min_stock: form.min_stock === '' ? 5 : Number(form.min_stock),
        sell_by_weight: form.sell_by_weight ? 1 : 0
      }

      if (editMode && form.id !== undefined) {
        await window.rafdLocal.products.update(form.id, payload)
        setEditMode(false)
      } else {
        await window.rafdLocal.products.create(payload)
      }

      setForm(EMPTY_FORM)
      refresh()
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  function startEdit(p: Product) {
    setError(null)
    setEditMode(true)
    setForm({
      id: p.id,
      name: p.name,
      name_ar: p.name_ar || '',
      price: String(p.price),
      cost: String(p.cost),
      stock: String(p.stock),
      unit: p.unit || 'حبة',
      category: p.category || 'عام',
      sku: p.sku || '',
      barcode: p.barcode || '',
      min_stock: String(p.min_stock),
      sell_by_weight: p.sell_by_weight === 1
    })
  }

  function cancelEdit() {
    setEditMode(false)
    setForm(EMPTY_FORM)
    setError(null)
  }

  async function disableProduct(id: number) {
    if (window.confirm('هل أنت متأكد من رغبتك في تعطيل هذا المنتج؟ لن يظهر في شاشة البيع ولكنه سيبقى في السجلات التاريخية.')) {
      setError(null)
      try {
        await window.rafdLocal.products.delete(id)
        refresh()
      } catch (e) {
        setError(unwrapIpcError(e))
      }
    }
  }

  async function enableProduct(p: Product) {
    setError(null)
    try {
      await window.rafdLocal.products.update(p.id, { is_active: 1 })
      refresh()
    } catch (e) {
      setError(unwrapIpcError(e))
    }
  }

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory =
        selectedCategoryFilter === 'الكل' || p.category === selectedCategoryFilter
      const query = searchQuery.trim().toLowerCase()
      const matchesSearch =
        query === '' ||
        p.name.toLowerCase().includes(query) ||
        (p.name_ar || '').toLowerCase().includes(query) ||
        (p.sku || '').toLowerCase().includes(query) ||
        (p.barcode || '').toLowerCase().includes(query)
      return matchesCategory && matchesSearch
    })
  }, [products, selectedCategoryFilter, searchQuery])

  const valid = form.name.trim() && Number(form.price) >= 0 && form.price !== ''

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
      {/* FORM SECTION */}
      <section className="card h-fit p-5">
        <h2 className="mb-4 text-lg font-bold text-[var(--text)] flex items-center gap-1">
          {editMode ? '📝 تعديل بيانات منتج' : '📦 إضافة منتج جديد'}
        </h2>
        <div className="space-y-3 text-xs">
          <div>
            <label className="label">الاسم (بالعربية/الأساسي) *</label>
            <input
              className="input text-xs"
              placeholder="مثال: حليب ممتاز 1 لتر"
              value={form.name_ar}
              onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            />
          </div>

          <div>
            <label className="label">الاسم اللاتيني / الوصف الإضافي *</label>
            <input
              className="input text-xs"
              placeholder="مثال: Premium Milk 1L"
              dir="ltr"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">سعر البيع (YER) *</label>
              <input
                className="input text-xs"
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div>
              <label className="label">سعر التكلفة (YER)</label>
              <input
                className="input text-xs"
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">الفئة</label>
              <select
                className="input text-xs"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {ALL_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">الوحدة</label>
              <input
                className="input text-xs"
                placeholder="حبة، كرتون، كجم..."
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">رمز SKU فريد</label>
              <input
                className="input text-xs"
                placeholder="SKU-1001"
                dir="ltr"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </div>
            <div>
              <label className="label">الباركود</label>
              <input
                className="input text-xs"
                placeholder="62810..."
                dir="ltr"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">حد الطلب الأدنى</label>
              <input
                className="input text-xs"
                dir="ltr"
                type="number"
                min="0"
                value={form.min_stock}
                onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
              />
            </div>
            {!editMode && (
              <div>
                <label className="label">المخزون الابتدائي</label>
                <input
                  className="input text-xs"
                  dir="ltr"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 bg-[var(--bg)] p-2 rounded-xl border border-[var(--color-ink-150)]">
            <input
              type="checkbox"
              id="sell_by_weight_checkbox"
              className="h-4 w-4 accent-[var(--primary)] cursor-pointer"
              checked={form.sell_by_weight}
              onChange={(e) => setForm({ ...form, sell_by_weight: e.target.checked })}
            />
            <label htmlFor="sell_by_weight_checkbox" className="font-bold text-gray-700 cursor-pointer select-none">
              ⚖️ يباع بالوزن (ميزان)
            </label>
          </div>

          {error && (
            <div className="rounded-xl bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)] font-bold text-center">
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
            <button className="btn btn-primary flex-1 py-2.5 font-bold" disabled={busy || !valid} onClick={submit}>
              {busy ? 'جاري الحفظ…' : editMode ? 'تعديل وحفظ المنتج' : '💾 إضافة منتج'}
            </button>
          </div>
        </div>
      </section>

      {/* LIST SECTION */}
      <section className="card p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text)]">
            📂 إدارة كتالوج المنتجات ({filteredProducts.length})
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            {/* SEARCH */}
            <input
              className="input text-xs py-1.5 w-44"
              placeholder="🔍 بحث باسم، باركود أو SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {/* CATEGORY FILTER */}
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

        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-sm text-[var(--text-muted)]">
            <span className="text-3xl mb-2">📦</span>
            لا توجد منتجات مسجلة تطابق التصفية الحالية.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs border-collapse">
              <thead>
                <tr className="border-b border-[var(--color-ink-200)] text-start text-[var(--text-muted)] font-bold">
                  <th className="py-2.5 text-start">المنتج</th>
                  <th className="py-2.5 text-start">الفئة</th>
                  <th className="py-2.5 text-start">سعر البيع / التكلفة</th>
                  <th className="py-2.5 text-start">المخزون الحركي</th>
                  <th className="py-2.5 text-start">الحالة</th>
                  <th className="py-2.5 text-center">الخيارات</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const catInfo = ALL_CATEGORIES.find((c) => c.name === p.category) || ALL_CATEGORIES[0]
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-[var(--color-ink-100)] hover:bg-[var(--bg)] transition ${
                        p.is_active === 0 ? 'bg-red-500/5 opacity-60' : ''
                      }`}
                    >
                      <td className="py-2.5">
                        <div className="font-bold text-[var(--text)]">
                          {p.name_ar || p.name}
                          {p.sell_by_weight === 1 && (
                            <span className="rounded bg-orange-100 px-1 py-0.5 text-[9px] text-orange-700 font-bold ml-1">
                              ⚖️ ميزان
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono" dir="ltr">
                          {p.name} {p.sku ? `| SKU: ${p.sku}` : ''} {p.barcode ? `| 🏷️ ${p.barcode}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5">
                        <span className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-[10px] font-bold">
                          <span>{catInfo.icon}</span>
                          <span>{p.category}</span>
                        </span>
                      </td>
                      <td className="py-2.5 font-bold text-gray-700">
                        <div dir="ltr" className="text-teal-700">
                          {p.price.toLocaleString()} YER
                        </div>
                        <div dir="ltr" className="text-[10px] text-[var(--text-muted)]">
                          التكلفة: {p.cost.toLocaleString()} YER
                        </div>
                      </td>
                      <td className="py-2.5 font-bold">
                        <span
                          className={`${
                            p.stock > p.min_stock
                              ? 'text-green-700'
                              : p.stock > 0
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {p.stock} {p.unit}
                        </span>
                        <div className="text-[9px] text-[var(--text-muted)] font-semibold">
                          الحد الأدنى: {p.min_stock}
                        </div>
                      </td>
                      <td className="py-2.5">
                        {p.is_active === 1 ? (
                          <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[9px] font-bold">
                            نشط
                          </span>
                        ) : (
                          <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[9px] font-bold">
                            معطّل
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => startEdit(p)}
                            className="btn border-[var(--color-ink-200)] hover:bg-teal-500/10 hover:text-[var(--primary)] px-2 py-1 text-[10px] font-bold"
                          >
                            ✏️ تعديل
                          </button>
                          {p.is_active === 1 ? (
                            <button
                              onClick={() => disableProduct(p.id)}
                              className="btn border-[var(--color-ink-200)] text-[var(--danger)] hover:bg-red-500/10 px-2 py-1 text-[10px] font-bold"
                            >
                              🔒 تعطيل
                            </button>
                          ) : (
                            <button
                              onClick={() => enableProduct(p)}
                              className="btn border-[var(--color-ink-200)] text-green-700 hover:bg-green-500/10 px-2 py-1 text-[10px] font-bold"
                            >
                              🔓 تفعيل
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
