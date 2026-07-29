import { useState } from 'react'
import { unwrapIpcError } from '../App'

export default function BackupScreen() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [rollbackPath, setRollbackPath] = useState<string | null>(null)

  async function handleManualBackup() {
    setBusy(true); setMessage(null); setRollbackPath(null)
    try {
      const result = await window.rafdLocal.backup.manualSave()
      if (result.ok && result.path) setMessage('✅ تم حفظ النسخة الاحتياطية: ' + result.path)
      else setMessage('❌ فشل حفظ النسخة: ' + (result.error ?? 'تم الإلغاء'))
    } catch (e) { setMessage('❌ خطأ أثناء إنشاء النسخة: ' + unwrapIpcError(e)) }
    finally { setBusy(false) }
  }

  async function handleRestore() {
    setBusy(true); setMessage(null); setRollbackPath(null)
    try {
      const result = await window.rafdLocal.backup.restore()
      if (result.ok) {
        setRollbackPath(result.rollbackPath ?? null)
        setMessage('✅ تم الاستعادة. يرجى إغلاق وإعادة فتح التطبيق.' + (result.rollbackPath ? ' تراجع: ' + result.rollbackPath : ''))
      } else setMessage('❌ فشل الاستعادة: ' + (result.error ?? 'غير معروف'))
    } catch (e) { setMessage('❌ خطأ أثناء الاستعادة: ' + unwrapIpcError(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex flex-col gap-6 p-5">
      <h2 className="text-xl font-extrabold text-[var(--text)]">النسخ الاحتياطي والاستعادة</h2>
      <section className="card p-5 flex flex-col gap-3">
        <h3 className="font-bold text-[var(--text)]">إنشاء نسخة احتياطية يدويًا</h3>
        <p className="text-xs text-[var(--text-muted)]">تُنشئ نسخة احتياطية كاملة عبر db.backup() ثم تُحفظ عبر حوار نظام التشغيل.</p>
        <button onClick={handleManualBackup} disabled={busy} className="btn btn-primary self-start">📥 إنشاء نسخة احتياطية</button>
      </section>
      <section className="card p-5 flex flex-col gap-3">
        <h3 className="font-bold text-[var(--text)]">استعادة من نسخة احتياطية</h3>
        <p className="text-xs text-[var(--text-muted)]">تُنشئ نسخة تراجع تلقائية للملف الحالي، تُتحقق من رأس SQLite، ثم تُستبدل.</p>
        <button onClick={handleRestore} disabled={busy} className="btn btn-danger self-start">🔄 استعادة من ملف</button>
        {rollbackPath && <div className="text-xs text-[var(--success)] font-bold">📄 نسخة التراجع: {rollbackPath}</div>}
      </section>
      {message && (
        <div className={`rounded-xl p-3 text-xs font-bold text-center ${message.startsWith('✅') ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--danger)]/10 text-[var(--danger)]'}`}>
          {message}
        </div>
      )}
    </div>
  )
}
