import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import type { Product, Customer, BankAccount, SaleWithItems } from '../../../shared/types'
import { unwrapIpcError } from '../App'

interface CartLine {
  product: Product
  quantity: number
  weight_g: number | null
  sold_by_weight: boolean
}

interface SuspendedBasket {
  id: string
  name: string
  cart: CartLine[]
  selectedCustomerId: string
  discount: string
  paymentMethod: string
  bankAccountId: string
  paid: string
  createdAt: string
}

interface Props {
  onSaleCompleted: (sale: SaleWithItems) => void
}

// Memory-only shift counters (persisted as long as POS screen is alive or within session)
let shiftSalesCountGlobal = 0
let shiftSalesTotalGlobal = 0

export default function PosScreen({ onSaleCompleted }: Props) {
  // Database entities
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])

  // Selection states
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')

  // Search and Category filters
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('الكل')

  // Cart and pricing
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState('')
  const [paid, setPaid] = useState('')

  // Shift counter (in-memory, reads from globals)
  const [shiftSalesCount, setShiftSalesCount] = useState(shiftSalesCountGlobal)
  const [shiftSalesTotal, setShiftSalesTotal] = useState(shiftSalesTotalGlobal)

  // Suspended baskets
  const [suspendedBaskets, setSuspendedBaskets] = useState<SuspendedBasket[]>([])
  const [showSuspendedModal, setShowSuspendedModal] = useState(false)

  // UI state
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Refs for focusing
  const searchInputRef = useRef<HTMLInputElement>(null)
  const customerSelectRef = useRef<HTMLSelectElement>(null)
  const paidInputRef = useRef<HTMLInputElement>(null)

  // Load database lists
  const refresh = useCallback(async () => {
    try {
      const pList = await window.rafdLocal.products.list()
      setProducts(pList)
    } catch (e) {
      setError(unwrapIpcError(e))
    }

    try {
      const cList = await window.rafdLocal.customers.list()
      setCustomers(cList)
    } catch (e) {
      setError(unwrapIpcError(e))
    }

    try {
      const bList = await window.rafdLocal.bankAccounts.list()
      setBankAccounts(bList)
    } catch (e) {
      setError(unwrapIpcError(e))
    }
  }, [])

  // Load suspended baskets from local storage
  const refreshSuspendedBaskets = useCallback(() => {
    const data = localStorage.getItem('rafd_suspended_baskets')
    if (data) {
      try {
        setSuspendedBaskets(JSON.parse(data))
      } catch {
        setSuspendedBaskets([])
      }
    } else {
      setSuspendedBaskets([])
    }
  }, [])

  useEffect(() => {
    refresh()
    refreshSuspendedBaskets()
  }, [refresh, refreshSuspendedBaskets])

  // Get distinct categories
  const categories = useMemo(() => {
    const list = new Set(products.map((p) => p.category))
    return ['الكل', ...Array.from(list)]
  }, [products])

  // Filter products based on search query (sku, barcode, name) and category
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = selectedCategory === 'الكل' || p.category === selectedCategory
      const query = searchQuery.trim().toLowerCase()
      const matchesSearch =
        query === '' ||
        (p.name_ar || p.name).toLowerCase().includes(query) ||
        (p.sku || '').toLowerCase().includes(query) ||
        (p.barcode || '').toLowerCase().includes(query)
      return matchesCategory && matchesSearch
    })
  }, [products, selectedCategory, searchQuery])

  // Subtotal calculation
  const subtotal = useMemo(() => {
    const val = cart.reduce((sum, line) => {
      if (line.sold_by_weight) {
        return sum + line.product.price * ((line.weight_g || 0) / 1000)
      } else {
        return sum + line.product.price * line.quantity
      }
    }, 0)
    return Math.round(val * 100) / 100
  }, [cart])

  // Final Total after discount
  const total = useMemo(() => {
    const disc = Number(discount) || 0
    const val = subtotal - disc
    return Math.max(0, Math.round(val * 100) / 100)
  }, [subtotal, discount])

  // Remaining change to return to customer
  const change = useMemo(() => {
    const paidVal = paid === '' ? total : Number(paid)
    const diff = paidVal - total
    return diff > 0 ? Math.round(diff * 100) / 100 : 0
  }, [paid, total])

  // Add a product to the cart
  function addToCart(product: Product) {
    setError(null)
    setCart((prev) => {
      const existingIndex = prev.findIndex((l) => l.product.id === product.id)
      const isWeighed = !!product.sell_by_weight

      if (existingIndex > -1) {
        const existing = prev[existingIndex]
        if (isWeighed) {
          // Add 250g as standard step for weighable products
          const currentWeight = existing.weight_g || 0
          const newWeight = currentWeight + 250
          if (newWeight / 1000 > product.stock) {
            setError(`المخزون غير كافٍ للمنتج «${product.name_ar || product.name}» المتبقي: ${product.stock}`)
            return prev
          }
          const updated = [...prev]
          updated[existingIndex] = { ...existing, weight_g: newWeight }
          return updated
        } else {
          const newQty = existing.quantity + 1
          if (newQty > product.stock) {
            setError(`المخزون غير كافٍ للمنتج «${product.name_ar || product.name}» المتبقي: ${product.stock}`)
            return prev
          }
          const updated = [...prev]
          updated[existingIndex] = { ...existing, quantity: newQty }
          return updated
        }
      }

      // Initial add
      if (isWeighed) {
        const initialWeight = 250 // default to 250g
        if (initialWeight / 1000 > product.stock) {
          setError(`المخزون غير كافٍ للمنتج «${product.name_ar || product.name}» المتبقي: ${product.stock}`)
          return prev
        }
        return [...prev, { product, quantity: 1, weight_g: initialWeight, sold_by_weight: true }]
      } else {
        if (product.stock < 1) {
          setError(`المنتج «${product.name_ar || product.name}» نافد من المخزون`)
          return prev
        }
        return [...prev, { product, quantity: 1, weight_g: null, sold_by_weight: false }]
      }
    })
  }

  // Set manual weight in grams
  function setLineWeight(productId: number, weightG: number) {
    setError(null)
    setCart((prev) =>
      prev.map((l) => {
        if (l.product.id !== productId) return l
        if (weightG / 1000 > l.product.stock) {
          setError(`الوزن المطلوب (${weightG / 1000} كجم) يتجاوز المخزون المتاح للمنتج «${l.product.name_ar || l.product.name}» المتاح: ${l.product.stock}`)
          return l
        }
        return { ...l, weight_g: weightG }
      })
    )
  }

  // Set quantity for non-weighed items
  function setQuantity(productId: number, qty: number) {
    setError(null)
    setCart((prev) => {
      if (qty <= 0) {
        return prev.filter((l) => l.product.id !== productId)
      }
      return prev.map((l) => {
        if (l.product.id !== productId) return l
        if (qty > l.product.stock) {
          setError(`الكمية المطلوبة (${qty}) تتجاوز المخزون المتاح للمنتج «${l.product.name_ar || l.product.name}» المتاح: ${l.product.stock}`)
          return l
        }
        return { ...l, quantity: qty }
      })
    })
  }

  // Keyboard wedge barcode handler: if barcode is typed and matches exactly one product, add it to cart!
  function handleBarcodeSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) return

    const matched = products.find(
      (p) =>
        p.barcode === searchQuery.trim() ||
        (p.sku && p.sku.toLowerCase() === searchQuery.trim().toLowerCase())
    )

    if (matched) {
      addToCart(matched)
      setSearchQuery('')
    }
  }

  // Suspend the current basket (Local storage only, max 20)
  function suspendCart() {
    if (cart.length === 0) {
      setError('السلة فارغة، لا يمكن تعليقها')
      return
    }

    const existingStr = localStorage.getItem('rafd_suspended_baskets') || '[]'
    let existing: SuspendedBasket[] = []
    try {
      existing = JSON.parse(existingStr)
    } catch {
      existing = []
    }

    if (existing.length >= 20) {
      setError('وصلت للحد الأقصى للسلات المعلقة (20 سلة). يرجى تفعيل أو إفراغ إحداها أولاً.')
      return
    }

    const defaultName = `سلة #${existing.length + 1} (${new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })})`
    const name = prompt('يرجى إدخال اسم أو رقم تعريف لهذه السلة:', defaultName) || defaultName

    const newBasket: SuspendedBasket = {
      id: String(Date.now()),
      name,
      cart,
      selectedCustomerId,
      discount,
      paymentMethod,
      bankAccountId,
      paid,
      createdAt: new Date().toISOString()
    }

    const updated = [...existing, newBasket]
    localStorage.setItem('rafd_suspended_baskets', JSON.stringify(updated))

    // Clear current cart states
    setCart([])
    setDiscount('')
    setPaid('')
    setSelectedCustomerId('')
    setPaymentMethod('cash')
    setBankAccountId('')
    setError(null)
    refreshSuspendedBaskets()
  }

  // Retrieve / restore a suspended basket
  function resumeBasket(basket: SuspendedBasket) {
    setCart(basket.cart)
    setSelectedCustomerId(basket.selectedCustomerId || '')
    setDiscount(basket.discount || '')
    setPaymentMethod(basket.paymentMethod || 'cash')
    setBankAccountId(basket.bankAccountId || '')
    setPaid(basket.paid || '')

    // Remove from suspended
    deleteSuspendedBasket(basket.id)
    setShowSuspendedModal(false)
    setError(null)
  }

  // Delete a suspended basket
  function deleteSuspendedBasket(id: string) {
    const existingStr = localStorage.getItem('rafd_suspended_baskets') || '[]'
    let existing: SuspendedBasket[] = []
    try {
      existing = JSON.parse(existingStr)
    } catch {
      existing = []
    }
    const updated = existing.filter((b) => b.id !== id)
    localStorage.setItem('rafd_suspended_baskets', JSON.stringify(updated))
    refreshSuspendedBaskets()
  }

  // Clear current active cart
  function clearCart() {
    if (window.confirm('هل أنت متأكد من رغبتك في إفراغ السلة الحالية بالكامل؟')) {
      setCart([])
      setDiscount('')
      setPaid('')
      setSelectedCustomerId('')
      setPaymentMethod('cash')
      setBankAccountId('')
      setError(null)
    }
  }

  // Final checkout of sale to SQLite database
  async function checkout() {
    if (cart.length === 0) {
      setError('السلة فارغة')
      return
    }

    setBusy(true)
    setError(null)

    try {
      const payload = {
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          weight_g: l.sold_by_weight ? l.weight_g : null,
          sold_by_weight: l.sold_by_weight ? 1 : 0
        })),
        paid: paid === '' ? total : Number(paid),
        customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
        payment_method: paymentMethod,
        bank_account_id: paymentMethod === 'transfer' && bankAccountId ? Number(bankAccountId) : null,
        discount: discount ? Number(discount) : 0
      }

      const sale = await window.rafdLocal.sales.create(payload)

      // Increment Shift Counter and Shift Sales Total
      shiftSalesCountGlobal += 1
      shiftSalesTotalGlobal += sale.sale.total
      setShiftSalesCount(shiftSalesCountGlobal)
      setShiftSalesTotal(shiftSalesTotalGlobal)

      // Clear local states
      setCart([])
      setDiscount('')
      setPaid('')
      setSelectedCustomerId('')
      setPaymentMethod('cash')
      setBankAccountId('')

      refresh()
      onSaleCompleted(sale)
    } catch (e) {
      setError(unwrapIpcError(e))
    } finally {
      setBusy(false)
    }
  }

  // Keyboard shortcuts listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'F2') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'F4') {
        e.preventDefault()
        if (!busy && cart.length > 0) {
          checkout()
        }
      } else if (e.key === 'F6') {
        e.preventDefault()
        suspendCart()
      } else if (e.key === 'F8') {
        e.preventDefault()
        customerSelectRef.current?.focus()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setShowSuspendedModal(false)
        setError(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cart, paid, discount, selectedCustomerId, paymentMethod, bankAccountId, busy, products])

  // Reset shift counter manually
  function resetShift() {
    if (window.confirm('هل أنت متأكد من رغبتك في تصفير عداد المبيعات والمبالغ للمناوبة الحالية؟')) {
      shiftSalesCountGlobal = 0
      shiftSalesTotalGlobal = 0
      setShiftSalesCount(0)
      setShiftSalesTotal(0)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* SHIFT COUNTER & MAIN STATS BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏪</span>
            <div>
              <div className="text-xs text-[var(--text-muted)] font-bold">مبيعات المناوبة</div>
              <div className="text-base font-bold text-[var(--primary)]">{shiftSalesCount} فاتورة</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">💰</span>
            <div>
              <div className="text-xs text-[var(--text-muted)] font-bold">إجمالي نقد المناوبة</div>
              <div className="text-base font-bold text-[var(--accent)]" dir="ltr">
                {shiftSalesTotal.toLocaleString('ar-YE')} YER
              </div>
            </div>
          </div>
          <button
            onClick={resetShift}
            className="btn btn-ghost px-2.5 py-1 text-xs text-[var(--danger)] hover:bg-red-500/10"
            title="تصفير المناوبة الحالية"
          >
            🔄 تصفير العداد
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Suspended baskets trigger */}
          <button
            onClick={() => setShowSuspendedModal(true)}
            className="btn relative flex items-center gap-1.5 rounded-xl border border-[var(--color-ink-200)] px-3 py-1.5 text-sm hover:bg-[var(--bg)] font-semibold"
          >
            📥 السلات المعلّقة
            {suspendedBaskets.length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-xs text-white font-bold">
                {suspendedBaskets.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_minmax(330px,410px)]">
        {/* PRODUCTS SIDE (LEFT) */}
        <section className="card flex flex-col p-5">
          {/* SEARCH AND FILTERS */}
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
            <form onSubmit={handleBarcodeSearchSubmit} className="relative flex-1">
              <span className="absolute inset-y-0 right-3 flex items-center text-[var(--text-muted)]">
                🔍
              </span>
              <input
                ref={searchInputRef}
                id="product-search-input"
                className="input pr-9 w-full"
                type="text"
                placeholder="بحث عن منتج بالاسم، SKU، أو باركود... (F2)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 left-3 flex items-center text-xs text-[var(--text-muted)] hover:text-red-500"
                >
                  ❌
                </button>
              )}
            </form>

            <div className="flex items-center gap-2 overflow-x-auto py-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`btn px-3 py-1 text-xs rounded-lg font-bold transition ${
                    selectedCategory === cat
                      ? 'bg-[var(--primary)] text-white'
                      : 'bg-[var(--bg)] text-[var(--text-muted)] hover:bg-[var(--color-ink-100)]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <h2 className="mb-3 text-sm font-bold text-[var(--text-muted)] flex items-center gap-1">
            📦 قائمة المنتجات المتاحة ({filteredProducts.length})
          </h2>

          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <span className="text-4xl mb-2">📭</span>
              <p className="text-sm text-[var(--text-muted)]">
                لا توجد منتجات تطابق البحث أو الفئة الحالية.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 overflow-y-auto max-h-[550px] p-1">
              {filteredProducts.map((p) => {
                const isOutOfStock = p.stock <= 0
                return (
                  <button
                    key={p.id}
                    disabled={isOutOfStock}
                    className={`btn flex flex-col items-stretch gap-1 rounded-2xl border p-3 text-start transition duration-150 relative ${
                      isOutOfStock
                        ? 'border-red-100 bg-red-500/5 opacity-50 cursor-not-allowed'
                        : 'border-[var(--color-ink-100)] bg-[var(--bg-elevated)] hover:border-[var(--primary)] hover:shadow-md'
                    }`}
                    onClick={() => addToCart(p)}
                  >
                    {p.sell_by_weight === 1 && (
                      <span
                        className="absolute top-2 left-2 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] text-orange-700 font-bold"
                        title="يباع بالوزن"
                      >
                        ⚖️ ميزان
                      </span>
                    )}
                    <span className="font-bold text-sm text-[var(--text)] line-clamp-1">
                      {p.name_ar || p.name}
                    </span>
                    <span className="text-xs font-semibold text-[var(--primary)]" dir="ltr">
                      {p.price.toLocaleString('ar-YE')} YER
                    </span>
                    <span
                      className={`text-[10px] font-bold ${
                        p.stock > p.min_stock
                          ? 'text-[var(--text-muted)]'
                          : p.stock > 0
                            ? 'text-[var(--warning)]'
                            : 'text-[var(--danger)]'
                      }`}
                    >
                      {p.stock > 0
                        ? `المخزون: ${p.stock} ${p.unit}`
                        : 'نفد من المخزون'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* CART & CHECKOUT SIDE (RIGHT) */}
        <section className="card flex flex-col p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold flex items-center gap-1.5">
              🛒 سلة البيع الحالية
              {cart.length > 0 && (
                <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-xs text-[var(--primary)] font-bold">
                  {cart.length} أصناف
                </span>
              )}
            </h2>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs text-[var(--danger)] hover:underline font-bold"
              >
                🗑️ إفراغ السلة
              </button>
            )}
          </div>

          {/* CUSTOMER SELECTOR */}
          <div className="mb-4">
            <label className="label text-xs font-bold text-[var(--text-muted)] flex items-center gap-1">
              👤 العميل للطلب (F8)
            </label>
            <select
              ref={customerSelectRef}
              id="customer-select"
              className="input text-sm w-full py-1.5"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
            >
              <option value="">عميل نقدي سريع (بدون تسجيل آجل)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.balance > 0 ? `(عليه دين: ${c.balance})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* CART LINES LIST */}
          <div className="flex-1 overflow-y-auto max-h-[350px] mb-4 space-y-2 pr-1">
            {cart.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--text-muted)] flex flex-col items-center justify-center">
                <span className="text-3xl mb-1">🛒</span>
                السلة فارغة. اضغط على المنتجات لإضافتها هنا.
              </div>
            ) : (
              cart.map((l) => (
                <div
                  key={l.product.id}
                  className="flex flex-col gap-2 rounded-xl border border-[var(--color-ink-150)] p-2.5 bg-[var(--bg)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-[var(--text)]">
                        {l.product.name_ar || l.product.name}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]" dir="ltr">
                        {l.product.price} ×{' '}
                        {l.sold_by_weight ? `${l.weight_g} جم` : `${l.quantity} وحدة`} ={' '}
                        {(l.sold_by_weight
                          ? l.product.price * ((l.weight_g || 0) / 1000)
                          : l.product.price * l.quantity
                        ).toLocaleString('ar-YE')}{' '}
                        YER
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      {l.sold_by_weight ? (
                        /* Weighable controls */
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            className="input w-16 py-0.5 text-center text-xs font-bold"
                            dir="ltr"
                            min="10"
                            step="10"
                            value={l.weight_g || 0}
                            onChange={(e) => setLineWeight(l.product.id, Number(e.target.value) || 0)}
                          />
                          <span className="text-[10px] font-bold text-[var(--text-muted)]">جرام</span>
                        </div>
                      ) : (
                        /* Standard qty controls */
                        <div className="flex items-center gap-1">
                          <button
                            className="btn bg-[var(--bg-elevated)] border border-[var(--color-ink-200)] px-2 py-0.5 text-xs hover:bg-[var(--color-ink-100)]"
                            onClick={() => setQuantity(l.product.id, l.quantity - 1)}
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-xs font-bold" dir="ltr">
                            {l.quantity}
                          </span>
                          <button
                            className="btn bg-[var(--bg-elevated)] border border-[var(--color-ink-200)] px-2 py-0.5 text-xs hover:bg-[var(--color-ink-100)]"
                            onClick={() => setQuantity(l.product.id, l.quantity + 1)}
                          >
                            +
                          </button>
                        </div>
                      )}

                      <button
                        className="btn border-transparent p-1 text-[var(--danger)] hover:bg-red-500/10 rounded-lg ml-1"
                        onClick={() => setQuantity(l.product.id, 0)}
                        title="حذف من السلة"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Manual trial weight entry quick SELECT CHIPS */}
                  {l.sold_by_weight && (
                    <div className="flex flex-wrap items-center gap-1 border-t border-dashed border-[var(--color-ink-200)] pt-1.5">
                      <span className="text-[9px] font-bold text-[var(--text-muted)]">
                        ميزان تجريبي (جم):
                      </span>
                      {[100, 250, 500, 750, 1000, 1500, 2000].map((w) => (
                        <button
                          key={w}
                          onClick={() => setLineWeight(l.product.id, w)}
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold transition ${
                            l.weight_g === w
                              ? 'bg-[var(--accent)] text-white'
                              : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--color-ink-200)] hover:bg-[var(--color-ink-100)]'
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* CHECKOUT PRICING AND ACTIONS */}
          <div className="border-t border-[var(--color-ink-200)] pt-3 space-y-2 text-xs">
            <div className="flex items-center justify-between text-[var(--text-muted)] font-bold">
              <span>الإجمالي الفرعي:</span>
              <span dir="ltr">{subtotal.toLocaleString('ar-YE')} YER</span>
            </div>

            {/* DISCOUNT INPUT */}
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-[var(--text-muted)]">الخصم المباشر (YER):</span>
              <input
                type="number"
                className="input w-24 py-1 text-left font-bold"
                dir="ltr"
                min="0"
                step="1"
                placeholder="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>

            {/* PAYMENT METHOD SELECTOR */}
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-[var(--text-muted)]">طريقة الدفع:</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`px-2.5 py-1 rounded font-bold ${
                    paymentMethod === 'cash'
                      ? 'bg-[var(--primary)] text-white'
                      : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--color-ink-200)]'
                  }`}
                >
                  💵 كاش
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('transfer')}
                  className={`px-2.5 py-1 rounded font-bold ${
                    paymentMethod === 'transfer'
                      ? 'bg-[var(--primary)] text-white'
                      : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--color-ink-200)]'
                  }`}
                >
                  💳 تحويل
                </button>
              </div>
            </div>

            {/* BANK ACCOUNT DROP-DOWN */}
            {paymentMethod === 'transfer' && (
              <div className="bg-[var(--bg)] p-2 rounded-lg border border-[var(--color-ink-150)]">
                <label className="label text-[10px] font-bold text-[var(--text-muted)] mb-1">
                  اختر الحساب البنكي المستقبل للتحويل:
                </label>
                <select
                  className="input text-xs w-full py-1"
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                >
                  <option value="">-- اختر الحساب --</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bank_name} - {b.account_name} ({b.currency})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* TOTAL PRICE */}
            <div className="flex items-center justify-between text-base font-extrabold border-t border-dashed border-[var(--color-ink-200)] pt-2 text-[var(--text)]">
              <span>الإجمالي النهائي:</span>
              <span className="text-xl text-[var(--accent)] font-mono" dir="ltr">
                {total.toLocaleString('ar-YE')} YER
              </span>
            </div>

            {/* PAID INPUT */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="font-bold text-[var(--text-muted)]">المبلغ المدفوع (YER):</span>
              <input
                ref={paidInputRef}
                type="number"
                className="input w-28 py-1 text-left font-bold"
                dir="ltr"
                min="0"
                step="0.01"
                placeholder={String(total)}
                value={paid}
                onChange={(e) => setPaid(e.target.value)}
              />
            </div>

            {/* REMAINING CHANGE / DEBT WARNING */}
            <div className="flex items-center justify-between font-bold text-xs bg-[var(--bg)] p-2 rounded-lg border border-[var(--color-ink-150)]">
              {Number(paid || total) >= total ? (
                <>
                  <span className="text-green-700">الباقي للعميل (المسترجع):</span>
                  <span className="text-green-700 font-mono" dir="ltr">
                    {change.toLocaleString('ar-YE')} YER
                  </span>
                </>
              ) : (
                <>
                  <span className="text-red-700">المبلغ المتبقي كدين آجل:</span>
                  <span className="text-red-700 font-mono" dir="ltr">
                    {(total - Number(paid || total)).toLocaleString('ar-YE')} YER
                  </span>
                </>
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-[var(--danger)]/10 p-3 text-xs text-[var(--danger)] font-bold text-center">
                ⚠️ {error}
              </div>
            )}

            {/* ACTION BUTTONS */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="btn border-[var(--color-ink-200)] px-3 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)] text-xs font-bold"
                onClick={suspendCart}
                title="تعليق السلة الحالية (F6)"
              >
                📥 تعليق (F6)
              </button>

              <button
                className="btn btn-primary flex-1 py-3 text-sm font-extrabold rounded-xl shadow-md transition"
                disabled={busy || cart.length === 0}
                onClick={checkout}
              >
                {busy ? 'إتمام الحفظ…' : '💾 إتمام البيع وحفظ الفاتورة (F4)'}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* SUSPENDED BASKETS MODAL DIALOG */}
      {showSuspendedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 bg-[var(--bg-elevated)] shadow-2xl rounded-2xl">
            <div className="flex items-center justify-between border-b border-[var(--color-ink-100)] pb-3 mb-4">
              <h3 className="text-base font-extrabold flex items-center gap-1.5">
                📥 قائمة السلات المعلقة ({suspendedBaskets.length} / 20)
              </h3>
              <button
                onClick={() => setShowSuspendedModal(false)}
                className="text-xs text-[var(--text-muted)] hover:text-red-500 font-bold"
              >
                ❌ إغلاق (Escape)
              </button>
            </div>

            {suspendedBaskets.length === 0 ? (
              <p className="py-12 text-center text-sm text-[var(--text-muted)]">
                لا توجد سلات معلقة حاليًا.
              </p>
            ) : (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {suspendedBaskets.map((basket) => {
                  const basketTotal = basket.cart.reduce((sum, item) => {
                    if (item.sold_by_weight) {
                      return sum + item.product.price * ((item.weight_g || 0) / 1000)
                    } else {
                      return sum + item.product.price * item.quantity
                    }
                  }, 0) - (Number(basket.discount) || 0)

                  return (
                    <div
                      key={basket.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[var(--color-ink-150)] bg-[var(--bg)] hover:bg-[var(--color-ink-100)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-[var(--text)] truncate">
                          {basket.name}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          أصناف: {basket.cart.length} | الإجمالي:{' '}
                          {Math.max(0, basketTotal).toLocaleString('ar-YE')} YER |{' '}
                          {new Date(basket.createdAt).toLocaleTimeString('ar-YE')}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => resumeBasket(basket)}
                          className="btn btn-primary px-3 py-1 text-[10px] font-bold"
                        >
                          🔄 استرجاع
                        </button>
                        <button
                          onClick={() => deleteSuspendedBasket(basket.id)}
                          className="btn border-[var(--color-ink-200)] text-[var(--danger)] hover:bg-red-500/10 px-2 py-1 text-[10px] font-bold"
                        >
                          🗑️ حذف
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
