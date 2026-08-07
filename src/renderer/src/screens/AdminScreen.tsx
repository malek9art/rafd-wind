import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AppUser,
  AuditLog,
  BankAccount,
  Expense,
  NewUser,
  PaymentTerminal,
  StoreSettings
} from '../../../shared/types'
import { unwrapIpcError } from '../App'

interface Props {
  user: AppUser
}

type AdminTab = 'settings' | 'users' | 'expenses' | 'banks' | 'terminals' | 'audit'

const EMPTY_SETTINGS: Partial<StoreSettings> = {
  name: '',
  name_ar: '',
  phone: '',
  email: '',
  address: '',
  currency: 'YER',
  tax_number: '',
  tax_enabled: 0,
  tax_rate: 0,
  tax_mode: 'exclusive',
  invoice_footer: '',
  printer_port: '',
  printer_baud_rate: 9600,
  receipt_width: 80
}

function errorText(error: unknown): string {
  return unwrapIpcError(error)
}

export default function AdminScreen({ user }: Props) {
  const isAdmin = user.role === 'admin'
  const tabs = useMemo<AdminTab[]>(
    () => (isAdmin ? ['settings', 'users', 'expenses', 'banks', 'terminals', 'audit'] : ['expenses', 'banks', 'terminals', 'audit']),
    [isAdmin]
  )
  const [tab, setTab] = useState<AdminTab>(tabs[0])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [settings, setSettings] = useState<Partial<StoreSettings>>(EMPTY_SETTINGS)
  const [users, setUsers] = useState<AppUser[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [terminals, setTerminals] = useState<PaymentTerminal[]>([])
  const [audit, setAudit] = useState<AuditLog[]>([])

  const [userForm, setUserForm] = useState({ full_name: '', role: 'cashier', pin: '' })
  const [expenseForm, setExpenseForm] = useState({ category: '', amount: '', payment_method: 'cash', expense_date: '', description: '' })
  const [bankForm, setBankForm] = useState({ bank_name: '', account_name: '', account_number: '', iban: '', currency: 'YER' })
  const [terminalForm, setTerminalForm] = useState({ name: '', provider: 'generic', connection_type: 'network', terminal_id: '' })

  const loadTab = useCallback(async (target: AdminTab) => {
    setError(null)
    try {
      if (target === 'settings') {
        const value = await window.rafdLocal.storeSettings.get()
        setSettings(value ? { ...value } : { ...EMPTY_SETTINGS })
      } else if (target === 'users') {
        setUsers(await window.rafdLocal.users.list())
      } else if (target === 'expenses') {
        setExpenses(await window.rafdLocal.expenses.list())
      } else if (target === 'banks') {
        setBanks(await window.rafdLocal.bankAccounts.list())
      } else if (target === 'terminals') {
        setTerminals(await window.rafdLocal.paymentTerminals.list())
      } else {
        setAudit(await window.rafdLocal.auditLogs.list({ limit: 300 }))
      }
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void loadTab(tab)
  }, [loadTab, tab])

  async function saveSettings() {
    setBusy(true)
    setError(null)
    try {
      await window.rafdLocal.storeSettings.update({
        name: settings.name?.trim() || null,
        name_ar: settings.name_ar?.trim() || null,
        phone: settings.phone?.trim() || null,
        email: settings.email?.trim() || null,
        address: settings.address?.trim() || null,
        currency: settings.currency?.trim() || 'YER',
        tax_number: settings.tax_number?.trim() || null,
        tax_enabled: Boolean(settings.tax_enabled),
        tax_rate: Number(settings.tax_rate ?? 0),
        tax_mode: settings.tax_mode || 'exclusive',
        invoice_footer: settings.invoice_footer?.trim() || null,
        printer_port: settings.printer_port?.trim() || null,
        printer_baud_rate: Number(settings.printer_baud_rate ?? 9600),
        receipt_width: Number(settings.receipt_width ?? 80)
      })
      await loadTab('settings')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function createManagedUser(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload: NewUser = {
        full_name: userForm.full_name.trim(),
        role: userForm.role,
        pin: userForm.pin || null
      }
      await window.rafdLocal.users.create(payload)
      setUserForm({ full_name: '', role: 'cashier', pin: '' })
      await loadTab('users')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function createManagedExpense(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await window.rafdLocal.expenses.create({
        category: expenseForm.category.trim(),
        amount: Number(expenseForm.amount),
        payment_method: expenseForm.payment_method,
        expense_date: expenseForm.expense_date || undefined,
        description: expenseForm.description.trim() || null
      })
      setExpenseForm({ category: '', amount: '', payment_method: 'cash', expense_date: '', description: '' })
      await loadTab('expenses')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function createManagedBank(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await window.rafdLocal.bankAccounts.create({
        bank_name: bankForm.bank_name.trim(),
        account_name: bankForm.account_name.trim(),
        account_number: bankForm.account_number.trim() || null,
        iban: bankForm.iban.trim() || null,
        currency: bankForm.currency.trim() || 'YER'
      })
      setBankForm({ bank_name: '', account_name: '', account_number: '', iban: '', currency: 'YER' })
      await loadTab('banks')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function createManagedTerminal(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await window.rafdLocal.paymentTerminals.create({
        name: terminalForm.name.trim(),
        provider: terminalForm.provider.trim() || 'generic',
        connection_type: terminalForm.connection_type,
        terminal_id: terminalForm.terminal_id.trim() || null
      })
      setTerminalForm({ name: '', provider: 'generic', connection_type: 'network', terminal_id: '' })
      await loadTab('terminals')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeExpense(id: number) {
    if (!window.confirm('هل تريد حذف المصروف؟')) return
    try {
      await window.rafdLocal.expenses.delete(id)
      await loadTab('expenses')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function toggleBank(bank: BankAccount) {
    try {
      await window.rafdLocal.bankAccounts.update(bank.id, { is_active: bank.is_active !== 1 })
      await loadTab('banks')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function removeBank(id: number) {
    if (!window.confirm('حذف الحساب البنكي سيزيله من قائمة الحسابات، مع إبقاء مراجع الفواتير التاريخية. متابعة؟')) return
    try {
      await window.rafdLocal.bankAccounts.delete(id)
      await loadTab('banks')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function toggleTerminal(terminal: PaymentTerminal) {
    try {
      await window.rafdLocal.paymentTerminals.update(terminal.id, { is_active: terminal.is_active !== 1 })
      await loadTab('terminals')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function removeTerminal(id: number) {
    if (!window.confirm('هل تريد حذف الطرفية؟')) return
    try {
      await window.rafdLocal.paymentTerminals.delete(id)
      await loadTab('terminals')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function removeUser(id: number) {
    if (!window.confirm('هل تريد حذف المستخدم؟')) return
    try {
      await window.rafdLocal.users.delete(id)
      await loadTab('users')
    } catch (err) {
      setError(errorText(err))
    }
  }

  const tabLabels: Record<AdminTab, string> = {
    settings: 'إعدادات المتجر',
    users: 'المستخدمون',
    expenses: 'المصروفات',
    banks: 'الحسابات البنكية',
    terminals: 'الطرفيات',
    audit: 'سجل التدقيق'
  }

  return (
    <div className="space-y-4 text-xs">
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <h2 className="me-3 text-base font-bold">⚙️ الإدارة والتشغيل</h2>
        {tabs.map((item) => (
          <button key={item} className={`btn px-3 py-1.5 text-xs ${tab === item ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(item)}>
            {tabLabels[item]}
          </button>
        ))}
      </div>

      {error && <div className="rounded-xl bg-[var(--danger)]/10 p-3 font-bold text-[var(--danger)]">⚠️ {error}</div>}

      {tab === 'settings' && isAdmin && (
        <section className="card max-w-3xl p-5">
          <h3 className="mb-4 text-base font-bold">إعدادات المتجر والفاتورة</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {([
              ['name_ar', 'اسم المتجر بالعربية'],
              ['name', 'الاسم الأساسي'],
              ['phone', 'الهاتف'],
              ['email', 'البريد الإلكتروني'],
              ['address', 'العنوان'],
              ['currency', 'العملة'],
              ['tax_number', 'الرقم الضريبي'],
              ['invoice_footer', 'تذييل الفاتورة'],
              ['printer_port', 'منفذ الطابعة الحرارية (مثل COM3)']
            ] as const).map(([key, label]) => (
              <label key={key} className="label">
                {label}
                <input className="input mt-1" value={String(settings[key] ?? '')} onChange={(event) => setSettings({ ...settings, [key]: event.target.value })} />
              </label>
            ))}
            <label className="label">
              نسبة الضريبة
              <input className="input mt-1" dir="ltr" type="number" min="0" step="0.01" value={Number(settings.tax_rate ?? 0)} onChange={(event) => setSettings({ ...settings, tax_rate: Number(event.target.value) })} />
            </label>
            <label className="label">
              سرعة الطابعة
              <input className="input mt-1" dir="ltr" type="number" min="1200" max="115200" step="1" value={Number(settings.printer_baud_rate ?? 9600)} onChange={(event) => setSettings({ ...settings, printer_baud_rate: Number(event.target.value) })} />
            </label>
            <label className="label">
              عرض الإيصال
              <select className="input mt-1" value={Number(settings.receipt_width ?? 80)} onChange={(event) => setSettings({ ...settings, receipt_width: Number(event.target.value) })}><option value={58}>58 ملم</option><option value={80}>80 ملم</option></select>
            </label>
            <label className="mt-6 flex items-center gap-2 font-bold">
              <input type="checkbox" checked={Boolean(settings.tax_enabled)} onChange={(event) => setSettings({ ...settings, tax_enabled: event.target.checked ? 1 : 0 })} />
              تفعيل الضريبة
            </label>
          </div>
          <button className="btn btn-primary mt-4" disabled={busy} onClick={() => void saveSettings()}>{busy ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button>
        </section>
      )}

      {tab === 'users' && isAdmin && (
        <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <form className="card h-fit space-y-3 p-5" onSubmit={createManagedUser}>
            <h3 className="text-base font-bold">إضافة مستخدم</h3>
            <label className="label">الاسم<input className="input mt-1" value={userForm.full_name} onChange={(event) => setUserForm({ ...userForm, full_name: event.target.value })} /></label>
            <label className="label">الدور<select className="input mt-1" value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}><option value="admin">Admin</option><option value="manager">Manager</option><option value="cashier">Cashier</option><option value="viewer">Viewer</option></select></label>
            <label className="label">PIN<input className="input mt-1 font-mono" dir="ltr" type="password" inputMode="numeric" value={userForm.pin} onChange={(event) => setUserForm({ ...userForm, pin: event.target.value })} /></label>
            <button className="btn btn-primary w-full" disabled={busy}>إضافة المستخدم</button>
          </form>
          <div className="card overflow-x-auto p-5"><h3 className="mb-3 text-base font-bold">المستخدمون ({users.length})</h3><table className="w-full"><thead><tr className="border-b"><th className="py-2 text-start">الاسم</th><th className="py-2 text-start">الدور</th><th className="py-2 text-start">الحالة</th><th /></tr></thead><tbody>{users.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{item.full_name}</td><td className="py-2">{item.role}</td><td className="py-2">{item.status}</td><td className="py-2 text-end">{item.id !== user.id && <button className="text-[var(--danger)]" onClick={() => void removeUser(item.id)}>حذف</button>}</td></tr>)}</tbody></table></div>
        </section>
      )}

      {tab === 'expenses' && (
        <section className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <form className="card h-fit space-y-3 p-5" onSubmit={createManagedExpense}><h3 className="text-base font-bold">تسجيل مصروف</h3><label className="label">الفئة<input className="input mt-1" value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })} /></label><label className="label">المبلغ<input className="input mt-1" dir="ltr" type="number" min="0.01" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} /></label><label className="label">طريقة الدفع<select className="input mt-1" value={expenseForm.payment_method} onChange={(event) => setExpenseForm({ ...expenseForm, payment_method: event.target.value })}><option value="cash">نقدي</option><option value="transfer">تحويل</option><option value="other">أخرى</option></select></label><label className="label">التاريخ<input className="input mt-1" type="date" value={expenseForm.expense_date} onChange={(event) => setExpenseForm({ ...expenseForm, expense_date: event.target.value })} /></label><label className="label">الوصف<textarea className="input mt-1" value={expenseForm.description} onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })} /></label><button className="btn btn-primary w-full" disabled={busy}>حفظ المصروف</button></form>
          <div className="card overflow-x-auto p-5"><h3 className="mb-3 text-base font-bold">المصروفات ({expenses.length})</h3><table className="w-full"><thead><tr className="border-b"><th className="py-2 text-start">الفئة</th><th className="py-2 text-start">المبلغ</th><th className="py-2 text-start">التاريخ</th><th /></tr></thead><tbody>{expenses.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{item.category}</td><td className="py-2" dir="ltr">{item.amount} YER</td><td className="py-2">{item.expense_date}</td><td className="py-2 text-end"><button className="text-[var(--danger)]" onClick={() => void removeExpense(item.id)}>حذف</button></td></tr>)}</tbody></table></div>
        </section>
      )}

      {tab === 'banks' && (
        <section className="grid gap-4 lg:grid-cols-[360px_1fr]"><form className="card h-fit space-y-3 p-5" onSubmit={createManagedBank}><h3 className="text-base font-bold">إضافة حساب بنكي</h3>{([['bank_name', 'اسم البنك'], ['account_name', 'اسم الحساب'], ['account_number', 'رقم الحساب'], ['iban', 'IBAN'], ['currency', 'العملة']] as const).map(([key, label]) => <label key={key} className="label">{label}<input className="input mt-1" value={bankForm[key]} onChange={(event) => setBankForm({ ...bankForm, [key]: event.target.value })} /></label>)}<button className="btn btn-primary w-full" disabled={busy}>حفظ الحساب</button></form><div className="card overflow-x-auto p-5"><h3 className="mb-3 text-base font-bold">الحسابات البنكية ({banks.length})</h3><table className="w-full"><thead><tr className="border-b"><th className="py-2 text-start">البنك</th><th className="py-2 text-start">الحساب</th><th className="py-2 text-start">الحالة</th><th /></tr></thead><tbody>{banks.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{item.bank_name}</td><td className="py-2">{item.account_name}</td><td className="py-2">{item.is_active === 1 ? 'نشط' : 'معطّل'}</td><td className="space-x-2 py-2 text-end"><button onClick={() => void toggleBank(item)}>تبديل</button><button className="text-[var(--danger)]" onClick={() => void removeBank(item.id)}>حذف</button></td></tr>)}</tbody></table></div></section>
      )}

      {tab === 'terminals' && (
        <section className="grid gap-4 lg:grid-cols-[360px_1fr]"><form className="card h-fit space-y-3 p-5" onSubmit={createManagedTerminal}><h3 className="text-base font-bold">إضافة طرفية</h3><label className="label">الاسم<input className="input mt-1" value={terminalForm.name} onChange={(event) => setTerminalForm({ ...terminalForm, name: event.target.value })} /></label><label className="label">المزود<input className="input mt-1" value={terminalForm.provider} onChange={(event) => setTerminalForm({ ...terminalForm, provider: event.target.value })} /></label><label className="label">نوع الاتصال<select className="input mt-1" value={terminalForm.connection_type} onChange={(event) => setTerminalForm({ ...terminalForm, connection_type: event.target.value })}><option value="network">شبكة</option><option value="serial">Serial</option><option value="usb">USB</option></select></label><label className="label">معرف الطرفية<input className="input mt-1" value={terminalForm.terminal_id} onChange={(event) => setTerminalForm({ ...terminalForm, terminal_id: event.target.value })} /></label><button className="btn btn-primary w-full" disabled={busy}>حفظ الطرفية</button></form><div className="card overflow-x-auto p-5"><h3 className="mb-3 text-base font-bold">الطرفيات ({terminals.length})</h3><table className="w-full"><thead><tr className="border-b"><th className="py-2 text-start">الاسم</th><th className="py-2 text-start">المزود</th><th className="py-2 text-start">الاتصال</th><th /></tr></thead><tbody>{terminals.map((item) => <tr key={item.id} className="border-b"><td className="py-2">{item.name}</td><td className="py-2">{item.provider}</td><td className="py-2">{item.connection_type}</td><td className="space-x-2 py-2 text-end"><button onClick={() => void toggleTerminal(item)}>تبديل</button><button className="text-[var(--danger)]" onClick={() => void removeTerminal(item.id)}>حذف</button></td></tr>)}</tbody></table></div></section>
      )}

      {tab === 'audit' && <section className="card overflow-x-auto p-5"><h3 className="mb-3 text-base font-bold">سجل التدقيق ({audit.length})</h3><table className="w-full"><thead><tr className="border-b"><th className="py-2 text-start">الوقت</th><th className="py-2 text-start">المستخدم</th><th className="py-2 text-start">العملية</th><th className="py-2 text-start">الكيان</th><th className="py-2 text-start">التفاصيل</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id} className="border-b"><td className="py-2" dir="ltr">{new Date(item.created_at).toLocaleString('ar-YE')}</td><td className="py-2">{item.user_id ?? '-'}</td><td className="py-2">{item.action}</td><td className="py-2">{item.entity_type ?? '-'}</td><td className="max-w-[320px] truncate py-2" dir="ltr">{item.meta ?? '-'}</td></tr>)}</tbody></table></section>}
    </div>
  )
}
