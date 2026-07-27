import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Product, SaleWithItems } from '../../../shared/types'
import { unwrapIpcError } from '../App'

interface CartLine {
  product: Product
  quantity: number
}

interface Props {
  onSaleCompleted: (sale: SaleWithItems) => void
}

export default function PosScreen({ onSaleCompleted }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [paid, setPaid] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    window.rafdLocal.products.list().then(setProducts).catch((e) => setError(unwrapIpcError(e)))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const total = useMemo(
    () => Math.round(cart.reduce((sum, l) => sum + l.product.price * l.quantity, 0) * 100) / 100,
    [cart]
  )

  function addToCart(product: Product) {
    setError(null)
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id)
      if (existing) {
        if (existing.quantity + 1 > product.stock) {
          setError(`مخزون غير كافٍ: ${product.name_ar || product.name}`)
          return prev
        }
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l
        )
      }
      if (product.stock < 1) {
        setError(`نفد مخزون: ${product.name_ar || product.name}`)
        return prev
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  function setQuantity(productId: number, quantity: number) {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product.id !== productId)
        : prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l))
    )
  }

  async function checkout() {
    setBusy(true)
    setError(null)
    try {
      const sale = await window.rafdLocal.sales.create({
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        paid: paid === '' ? total : Number(paid)
      })
      setCart([])
      setPaid('')
      refresh()
      onSaleCompleted(sale)
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(300px,380px)]">
      <section className="card p-5">
        <h2 className="mb-4 text-lg font-bold">المنتجات</h2>
        {products.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--text-muted)]">
            لا توجد منتجات — أضف منتجًا أولًا من تبويب «المنتجات».
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {products.map((p) => (
              <button
                key={p.id}
                className="btn btn-ghost flex-col items-stretch gap-1 p-3 text-start"
                onClick={() => addToCart(p)}
              >
                <span className="font-bold">{p.name_ar || p.name}</span>
                <span className="text-sm text-[var(--primary)]" dir="ltr">
                  {p.price}
                </span>
                <span className={`text-xs ${p.stock > 0 ? 'text-[var(--text-muted)]' : 'text-[var(--danger)]'}`}>
                  مخزون: {p.stock}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card flex h-fit flex-col p-5">
        <h2 className="mb-4 text-lg font-bold">السلة</h2>
        {cart.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">السلة فارغة</p>
        ) : (
          <div className="mb-3 space-y-2">
            {cart.map((l) => (
              <div key={l.product.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-ink-100)] p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{l.product.name_ar || l.product.name}</div>
                  <div className="text-xs text-[var(--text-muted)]" dir="ltr">
                    {l.product.price} × {l.quantity} = {Math.round(l.product.price * l.quantity * 100) / 100}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="btn btn-ghost px-2.5 py-1" onClick={() => setQuantity(l.product.id, l.quantity - 1)}>−</button>
                  <span className="w-8 text-center text-sm font-bold" dir="ltr">{l.quantity}</span>
                  <button className="btn btn-ghost px-2.5 py-1" onClick={() => setQuantity(l.product.id, Math.min(l.quantity + 1, l.product.stock))}>+</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto border-t border-[var(--color-ink-100)] pt-3">
          <div className="mb-3 flex items-center justify-between text-lg font-bold">
            <span>الإجمالي</span>
            <span dir="ltr">{total}</span>
          </div>
          <label className="label">المبلغ المدفوع (اتركه فارغًا = المبلغ كامل)</label>
          <input
            className="input mb-3"
            dir="ltr"
            type="number"
            min="0"
            step="0.01"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            placeholder={String(total)}
          />
          {error && <div className="mb-3 rounded-xl bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{error}</div>}
          <button
            className="btn btn-primary w-full py-3 text-base"
            disabled={busy || cart.length === 0}
            onClick={checkout}
          >
            {busy ? 'جارٍ الحفظ…' : 'إتمام البيع وحفظ الفاتورة'}
          </button>
        </div>
      </section>
    </div>
  )
}
