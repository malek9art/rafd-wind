import { useCallback, useEffect, useState } from 'react'
import type { LicenseInfo, SaleWithItems } from '../../shared/types'
import ActivationScreen from './screens/ActivationScreen'
import ProductsScreen from './screens/ProductsScreen'
import InventoryScreen from './screens/InventoryScreen'
import SuppliersScreen from './screens/SuppliersScreen'
import PurchasesScreen from './screens/PurchasesScreen'
import CustomersScreen from './screens/CustomersScreen'
import ReportsScreen from './screens/ReportsScreen'
import PosScreen from './screens/PosScreen'
import ReceiptScreen from './screens/ReceiptScreen'

type Phase = 'loading' | 'activation' | 'app'
type View = { tab: 'pos' | 'products' | 'inventory' | 'suppliers' | 'purchases' | 'customers' | 'reports'; receipt: SaleWithItems | null }

export function unwrapIpcError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Electron يُسبق رسائل المعالجات بـ"Error invoking remote method ...: Error: <الرسالة>"
  const marker = 'Error: '
  const idx = raw.lastIndexOf(marker)
  return idx >= 0 ? raw.slice(idx + marker.length) : raw
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null)
  const [view, setView] = useState<View>({ tab: 'pos', receipt: null })

  useEffect(() => {
    window.rafdLocal.license
      .status()
      .then((status) => {
        if (status.activated) {
          setLicenseInfo(status.info)
          setPhase('app')
        } else {
          setPhase('activation')
        }
      })
      .catch(() => setPhase('activation'))
  }, [])

  const onActivated = useCallback((info: LicenseInfo) => {
    setLicenseInfo(info)
    setPhase('app')
  }, [])

  const onSaleCompleted = useCallback((sale: SaleWithItems) => {
    setView((v) => ({ ...v, receipt: sale }))
  }, [])

  if (phase === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-[var(--text-muted)]">
        جارٍ التحميل…
      </div>
    )
  }

  if (phase === 'activation') {
    return <ActivationScreen onActivated={onActivated} />
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-[var(--sidebar)] px-5 py-3 text-[var(--sidebar-text)] print:hidden">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold">رفد — نقطة بيع</h1>
          <nav className="flex gap-2">
            <button
              className={`btn px-4 py-1.5 text-sm ${view.tab === 'pos' && !view.receipt ? 'bg-white/15' : 'bg-transparent'}`}
              onClick={() => setView({ tab: 'pos', receipt: null })}
            >
              شاشة البيع
            </button>
            <button
              className={`btn px-4 py-1.5 text-sm ${view.tab === 'products' ? 'bg-white/15' : 'bg-transparent'}`}
              onClick={() => setView({ tab: 'products', receipt: null })}
            >
              المنتجات
            </button>
            <button
              className={`btn px-4 py-1.5 text-sm ${view.tab === 'inventory' ? 'bg-white/15' : 'bg-transparent'}`}
              onClick={() => setView({ tab: 'inventory', receipt: null })}
            >
              إدارة المخزون
            </button>
            <button
              className={`btn px-4 py-1.5 text-sm ${view.tab === 'suppliers' ? 'bg-white/15' : 'bg-transparent'}`}
              onClick={() => setView({ tab: 'suppliers', receipt: null })}
            >
              الموردون
            </button>
            <button
              className={`btn px-4 py-1.5 text-sm ${view.tab === 'purchases' ? 'bg-white/15' : 'bg-transparent'}`}
              onClick={() => setView({ tab: 'purchases', receipt: null })}
            >
              المشتريات
            </button>
            <button
              className={`btn px-4 py-1.5 text-sm ${view.tab === 'customers' ? 'bg-white/15' : 'bg-transparent'}`}
              onClick={() => setView({ tab: 'customers', receipt: null })}
            >
              العملاء
            </button>
            <button
              className={`btn px-4 py-1.5 text-sm ${view.tab === 'reports' ? 'bg-white/15' : 'bg-transparent'}`}
              onClick={() => setView({ tab: 'reports', receipt: null })}
            >
              تقارير النشاط
            </button>
          </nav>
        </div>
        {licenseInfo && (
          <div className="text-xs opacity-80">
            {licenseInfo.customer} — باقة {licenseInfo.plan} — حتى {licenseInfo.expires_at.slice(0, 10)}
          </div>
        )}
      </header>

      <main className="flex-1 p-5">
        {view.receipt ? (
          <ReceiptScreen
            data={view.receipt}
            onNewSale={() => setView({ tab: 'pos', receipt: null })}
          />
        ) : view.tab === 'products' ? (
          <ProductsScreen />
        ) : view.tab === 'inventory' ? (
          <InventoryScreen />
        ) : view.tab === 'suppliers' ? (
          <SuppliersScreen />
        ) : view.tab === 'purchases' ? (
          <PurchasesScreen />
        ) : view.tab === 'customers' ? (
          <CustomersScreen />
        ) : view.tab === 'reports' ? (
          <ReportsScreen />
        ) : (
          <PosScreen onSaleCompleted={onSaleCompleted} />
        )}
      </main>
    </div>
  )
}
