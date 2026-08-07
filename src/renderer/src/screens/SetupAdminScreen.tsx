import { useState } from 'react'
import type { AppUser } from '../../../shared/types'
import { unwrapIpcError } from '../App'

interface Props {
  onCreated: (user: AppUser) => void
}

export default function SetupAdminScreen({ onCreated }: Props) {
  const [fullName, setFullName] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!fullName.trim()) {
      setError('اسم المدير مطلوب')
      return
    }
    if (!/^\d{4,12}$/.test(pin)) {
      setError('PIN يجب أن يكون أرقامًا فقط، من 4 إلى 12 خانة')
      return
    }
    if (pin !== confirmPin) {
      setError('تأكيد PIN غير مطابق')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const user = await window.rafdLocal.users.bootstrap(fullName.trim(), pin)
      onCreated(user)
    } catch (err) {
      setError(unwrapIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form className="card w-full max-w-md p-8" onSubmit={submit}>
        <h1 className="mb-1 text-2xl font-bold text-[var(--primary)]">إعداد مدير المتجر</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          هذه الخطوة تظهر مرة واحدة فقط لإنشاء أول مستخدم بصلاحيات مدير كاملة.
        </p>

        <label className="label" htmlFor="admin-name">اسم المدير</label>
        <input
          id="admin-name"
          className="input mb-4"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          autoFocus
        />

        <label className="label" htmlFor="admin-pin">PIN المدير</label>
        <input
          id="admin-pin"
          className="input mb-4 font-mono"
          dir="ltr"
          type="password"
          inputMode="numeric"
          maxLength={12}
          value={pin}
          onChange={(event) => setPin(event.target.value)}
        />

        <label className="label" htmlFor="admin-pin-confirm">تأكيد PIN</label>
        <input
          id="admin-pin-confirm"
          className="input mb-4 font-mono"
          dir="ltr"
          type="password"
          inputMode="numeric"
          maxLength={12}
          value={confirmPin}
          onChange={(event) => setConfirmPin(event.target.value)}
        />

        {error && (
          <div className="mb-4 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        <button className="btn btn-primary w-full py-3 text-base" disabled={busy}>
          {busy ? 'جارٍ إنشاء المدير…' : 'إنشاء المدير والمتابعة'}
        </button>
      </form>
    </div>
  )
}
