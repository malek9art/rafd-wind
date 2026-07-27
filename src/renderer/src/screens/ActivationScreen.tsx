import { useState } from 'react'
import type { LicenseInfo } from '../../../shared/types'

interface Props {
  onActivated: (info: LicenseInfo) => void
}

export default function ActivationScreen({ onActivated }: Props) {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function activate() {
    setBusy(true)
    setError(null)
    try {
      const result = await window.rafdLocal.license.activate(key)
      if (result.ok) {
        onActivated(result.info)
      } else {
        setError(result.error)
      }
    } catch {
      setError('حدث خطأ غير متوقع أثناء التفعيل')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-lg p-8">
        <h1 className="mb-1 text-2xl font-bold text-[var(--primary)]">رفد — نقطة بيع</h1>
        <p className="mb-6 text-sm text-[var(--text-muted)]">
          تفعيل الترخيص مطلوب قبل أول استخدام. التحقق يتم محليًا بالكامل بدون إنترنت.
        </p>

        <label className="label" htmlFor="license-key">
          مفتاح التفعيل
        </label>
        <textarea
          id="license-key"
          className="input mb-4 h-28 resize-none font-mono text-xs"
          dir="ltr"
          placeholder="RAFD1.xxxx.yyyy"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />

        {error && (
          <div className="mb-4 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        <button
          className="btn btn-primary w-full py-3 text-base"
          disabled={busy || !key.trim()}
          onClick={activate}
        >
          {busy ? 'جارٍ التحقق…' : 'تفعيل'}
        </button>
      </div>
    </div>
  )
}
