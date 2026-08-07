import { useState } from 'react'
import type { AppUser } from '../../../shared/types'
import { unwrapIpcError } from '../App'

interface Props {
  onLoggedIn: (user: AppUser) => void
}

export default function LoginScreen({ onLoggedIn }: Props) {
  const [identifier, setIdentifier] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!identifier.trim() || !pin) return
    setBusy(true)
    setError(null)
    try {
      const user = await window.rafdLocal.users.login(identifier.trim(), pin)
      onLoggedIn(user)
    } catch (err) {
      setError(unwrapIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form className="card w-full max-w-md p-8" onSubmit={submit}>
        <h1 className="mb-1 text-2xl font-bold text-[var(--primary)]">رفد — تسجيل الدخول</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          أدخل اسم المستخدم أو رقم الهاتف ثم رمز PIN للمتابعة.
        </p>

        <label className="label" htmlFor="login-identifier">اسم المستخدم أو الهاتف</label>
        <input
          id="login-identifier"
          className="input mb-4"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          autoFocus
          autoComplete="username"
        />

        <label className="label" htmlFor="login-pin">PIN</label>
        <input
          id="login-pin"
          className="input mb-4 font-mono"
          dir="ltr"
          type="password"
          inputMode="numeric"
          maxLength={12}
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          autoComplete="current-password"
        />

        {error && (
          <div className="mb-4 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        <button className="btn btn-primary w-full py-3 text-base" disabled={busy || !identifier.trim() || !pin}>
          {busy ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
        </button>
      </form>
    </div>
  )
}
