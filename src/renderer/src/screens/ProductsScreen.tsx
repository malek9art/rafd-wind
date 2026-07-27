import { useCallback, useEffect, useState } from 'react'
import type { Product } from '../../../shared/types'
import { unwrapIpcError } from '../App'

const EMPTY_FORM = { name: '', name_ar: '', price: '', cost: '', stock: '', unit: 'pcs' }

export default function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    window.rafdLocal.products.list().then(setProducts).catch((e) => setError(unwrapIpcError(e)))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await window.rafdLocal.products.create({
        name: form.name,
        name_ar: form.name_ar || null,
        price: Number(form.price),
        cost: form.cost === '' ? 0 : Number(form.cost),
        stock: form.stock === '' ? 0 : Number(form.stock),
        unit: form.unit || 'pcs'
      })
      setForm(EMPTY_FORM)
      refresh()
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  const valid = form.name.trim() && Number(form.price) >= 0 && form.price !== ''

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
      <section className="card h-fit p-5">
        <h2 className="mb-4 text-lg font-bold">إضافة منتج</h2>
        <div className="space-y-3">
          <div>
            <label className="label">الاسم (لاتيني)</label>
            <input
              className="input"
              dir="ltr"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">الاسم (عربي)</label>
            <input
              className="input"
              value={form.name_ar}
              onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">سعر البيع</label>
              <input
                className="input"
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div>
              <label className="label">التكلفة</label>
              <input
                className="input"
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </div>
            <div>
              <label className="label">المخزون</label>
              <input
                className="input"
                dir="ltr"
                type="number"
                min="0"
                step="1"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
              />
            </div>
            <div>
              <label className="label">الوحدة</label>
              <input
                className="input"
                dir="ltr"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </div>
          </div>
          {error && <div className="rounded-xl bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{error}</div>}
          <button className="btn btn-primary w-full" disabled={busy || !valid} onClick={submit}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ المنتج'}
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-lg font-bold">المنتجات ({products.length})</h2>
        {products.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            لا توجد منتجات بعد — أضف أول منتج من النموذج.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-ink-200)] text-start text-[var(--text-muted)]">
                <th className="py-2 text-start font-semibold">المنتج</th>
                <th className="py-2 text-start font-semibold">السعر</th>
                <th className="py-2 text-start font-semibold">المخزون</th>
                <th className="py-2 text-start font-semibold">الوحدة</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-[var(--color-ink-100)]">
                  <td className="py-2.5">
                    <div className="font-semibold">{p.name_ar || p.name}</div>
                    {p.name_ar && <div className="text-xs text-[var(--text-muted)]" dir="ltr">{p.name}</div>}
                  </td>
                  <td className="py-2.5" dir="ltr">{p.price}</td>
                  <td className="py-2.5" dir="ltr">{p.stock}</td>
                  <td className="py-2.5">{p.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
