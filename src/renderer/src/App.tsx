import { useCallback, useEffect, useState } from 'react'
import type { AppUser, LicenseInfo, LicenseStatus, SaleWithItems } from '../../shared/types'
import ActivationScreen from './screens/ActivationScreen'
import LoginScreen from './screens/LoginScreen'
import SetupAdminScreen from './screens/SetupAdminScreen'
import ProductsScreen from './screens/ProductsScreen'
import InventoryScreen from './screens/InventoryScreen'
import SuppliersScreen from './screens/SuppliersScreen'
import PurchasesScreen from './screens/PurchasesScreen'
import CustomersScreen from './screens/CustomersScreen'
import ReportsScreen from './screens/ReportsScreen'
import AdminScreen from './screens/AdminScreen'
import PosScreen from './screens/PosScreen'
import ReceiptScreen from './screens/ReceiptScreen'

type Phase = 'loading' | 'activation' | 'setup' | 'login' | 'app'
type View = {
  tab: 'pos' | 'products' | 'inventory' | 'suppliers' | 'purchases' | 'customers' | 'reports' | 'admin'
  receipt: SaleWithItems | null
}
type ActiveLicenseStatus = Extract<LicenseStatus, { activated: true }>

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
  const [licenseState, setLicenseState] = useState<ActiveLicenseStatus | null>(null)
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null)
  const [view, setView] = useState<View>({ tab: 'pos', receipt: null })

  const chooseAuthenticationPhase = useCallback(async () => {
    const count = await window.rafdLocal.users.count()
    setPhase(count === 0 ? 'setup' : 'login')
  }, [])

  const loadLicenseAndAuthentication = useCallback(async () => {
    try {
      const status = await window.rafdLocal.license.status()
      if (!status.activated) {
        setLicenseState(null)
        setPhase('activation')
        return
      }
      setLicenseInfo(status.info)
      setLicenseState(status)
      await chooseAuthenticationPhase()
    } catch {
      setPhase('activation')
    }
  }, [chooseAuthenticationPhase])

  useEffect(() => {
    void loadLicenseAndAuthentication()
  }, [loadLicenseAndAuthentication])

  const onActivated = useCallback(
    async (info: LicenseInfo) => {
      setLicenseInfo(info)
      try {
        const status = await window.rafdLocal.license.status()
        if (status.activated) setLicenseState(status)
        await chooseAuthenticationPhase()
      } catch {
        setPhase('activation')
      }
    },
    [chooseAuthenticationPhase]
  )

  const onLoggedIn = useCallback((user: AppUser) => {
    setCurrentUser(user)
    setPhase('app')
  }, [])

  const onAdminCreated = useCallback((user: AppUser) => {
    setCurrentUser(user)
    setPhase('app')
  }, [])

  const logout = useCallback(async () => {
    await window.rafdLocal.users.logout()
    setCurrentUser(null)
    setView({ tab: 'pos', receipt: null })
    setPhase('login')
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

  if (phase === 'setup') {
    return <SetupAdminScreen onCreated={onAdminCreated} />
  }

  if (phase === 'login') {
    return <LoginScreen onLoggedIn={onLoggedIn} />
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-[var(--sidebar)] px-5 py-3 text-[var(--sidebar-text)] print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold">رفد — نقطة بيع</h1>
            <nav className="flex flex-wrap gap-2">
              <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'pos' && !view.receipt ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'pos', receipt: null })}>شاشة البيع</button>
              <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'products' ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'products', receipt: null })}>المنتجات</button>
              <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'inventory' ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'inventory', receipt: null })}>إدارة المخزون</button>
              <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'suppliers' ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'suppliers', receipt: null })}>الموردون</button>
              <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'purchases' ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'purchases', receipt: null })}>المشتريات</button>
              <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'customers' ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'customers', receipt: null })}>العملاء</button>
              <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'reports' ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'reports', receipt: null })}>تقارير النشاط</button>
              {currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
                <button className={`btn px-4 py-1.5 text-sm ${view.tab === 'admin' ? 'bg-white/15' : 'bg-transparent'}`} onClick={() => setView({ tab: 'admin', receipt: null })}>الإدارة</button>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs opacity-90">
            {licenseInfo && <span>{licenseInfo.customer} — باقة {licenseInfo.plan} — حتى {licenseInfo.expires_at.slice(0, 10)}</span>}
            {currentUser && <span className="rounded-full bg-white/10 px-3 py-1">{currentUser.full_name} — {currentUser.role}</span>}
            <button className="btn border border-white/20 px-3 py-1 text-xs hover:bg-white/10" onClick={() => void logout()}>تسجيل الخروج</button>
          </div>
        </div>
        {licenseState?.expired && (
          <div className="mt-3 rounded-xl bg-red-500/20 px-3 py-2 text-xs font-bold text-red-100">
            انتهت صلاحية الترخيص: القراءة متاحة، لكن عمليات الكتابة متوقفة. تواصل مع الإدارة للتجديد.
          </div>
        )}
        {licenseState?.expiring_soon && !licenseState.expired && (
          <div className="mt-3 rounded-xl bg-amber-400/20 px-3 py-2 text-xs font-bold text-amber-100">
            تنبيه: الترخيص يقترب من الانتهاء خلال {licenseState.days_left} يومًا.
          </div>
        )}
      </header>

      <main className="flex-1 p-5">
        {view.receipt ? (
          <ReceiptScreen data={view.receipt} onNewSale={() => setView({ tab: 'pos', receipt: null })} />
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
        ) : view.tab === 'admin' && currentUser ? (
          <AdminScreen user={currentUser} />
        ) : (
          <PosScreen onSaleCompleted={onSaleCompleted} />
        )}
      </main>
    </div>
  )
}
