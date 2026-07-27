/**
 * بصمة الجهاز (الوثيقة §8.2) — مزيج مستقر نسبيًا: معرّف اللوحة/النظام (SMBIOS
 * UUID) + الرقم التسلسلي للقرص الأساسي. **لا** تُبنى من عنوان MAC وحده (يتغيّر
 * بتبديل كرت الشبكة)، وتتحمّل بطبيعتها تغييرات العتاد البسيطة المذكورة في §8.2
 * (ترقية ذاكرة، تبديل شاشة، تبديل كرت شبكة) لأن مصدريها لا يتأثران بها.
 *
 * التجميع حتمي: نفس المكوّنات تعطي نفس البصمة دائمًا (sha256). لو تعذّر الحصول
 * على أي مصدر عتادي (آلة افتراضية مقيّدة مثلًا) يُستخدَم hostname كبديل مُعلَن —
 * تغيير اسم الجهاز نادر ومتعمَّد، ويبقى أفضل من لا شيء مع توثيق الحدّ.
 *
 * الاختبار: الحقن (exec/mكوّنات) بدل المحاكاة الصمّاء؛ لا شبكة ولا مكتبات خارجية.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { hostname, platform } from 'node:os'

/** بادئة إصدار خوارزم البصمة — تغييرها مستقبلًا = بصمات جديدة (قرار إداري موثَّق) */
export const FINGERPRINT_SALT = 'RAFD-FP1'

export interface FingerprintComponents {
  /** معرّف اللوحة/النظام (SMBIOS UUID) إن توفّر */
  board?: string
  /** الرقم التسلسلي للقرص الأساسي إن توفّر */
  disk?: string
}

export type ShellExec = (command: string) => string

const defaultExec: ShellExec = (command) =>
  execSync(command, { timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).toString()

function firstMeaningfulLine(raw: string): string {
  const line = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0)
  return line ?? ''
}

/** UUID أصفار بالكامل يظهر في عتاد/افتراضيات رديئة — يُعامَل كغير موجود */
function isUsableUuid(uuid: string): boolean {
  const hexOnly = uuid.replace(/-/g, '')
  return hexOnly.length > 0 && !/^0+$/.test(hexOnly)
}

/** جمع المكوّنات بحسب المنصة؛ كل مصدر مستقل الفشل (مصدر معطوب لا يسقط الآخر) */
export function collectFingerprintComponents(
  exec: ShellExec = defaultExec,
  osPlatform: NodeJS.Platform = platform()
): FingerprintComponents {
  const out: FingerprintComponents = {}
  if (osPlatform === 'win32') {
    // PowerShell CIM المدعوم رسميًا في ويندوز 10/11 (wmic مهجور)
    try {
      const uuid = firstMeaningfulLine(
        exec('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"')
      )
      if (isUsableUuid(uuid)) out.board = uuid.toLowerCase()
    } catch {
      /* مصدر اللوحة غير متاح */
    }
    try {
      const serial = firstMeaningfulLine(
        exec(
          'powershell -NoProfile -Command "(Get-CimInstance Win32_DiskDrive | Select-Object -First 1).SerialNumber"'
        )
      )
      if (serial) out.disk = serial.toLowerCase()
    } catch {
      /* مصدر القرص غير متاح */
    }
  } else if (osPlatform === 'linux') {
    try {
      const uuid = firstMeaningfulLine(exec('cat /sys/class/dmi/id/product_uuid'))
      if (isUsableUuid(uuid)) out.board = uuid.toLowerCase()
    } catch {
      /* يتطلب صلاحيات غالبًا */
    }
    try {
      const serial = firstMeaningfulLine(exec('lsblk -dn -o SERIAL'))
      if (serial) out.disk = serial.toLowerCase()
    } catch {
      /* غير متاح */
    }
  } else if (osPlatform === 'darwin') {
    try {
      const uuid = firstMeaningfulLine(
        exec("ioreg -rd1 -c IOPlatformExpertDevice | awk -F'\"' '/IOPlatformUUID/{print $4}'")
      )
      if (isUsableUuid(uuid)) out.board = uuid.toLowerCase()
    } catch {
      /* غير متاح */
    }
  }
  return out
}

/**
 * تجميع حتمي للبصمة: نفس المكوّنات (بأي ترتيب استدعاء) تعطي الناتج ذاته.
 * عند غياب كل المصادر العتادية يدخل hostname الممرَّر كعنصر ثالث ثابت.
 */
export function componentsToFingerprint(
  components: FingerprintComponents,
  fallbackHost: string = hostname()
): string {
  const hasHardware = Boolean(components.board || components.disk)
  const hostPart = hasHardware ? '' : fallbackHost.toLowerCase()
  const base = `${FINGERPRINT_SALT}|${components.board ?? ''}|${components.disk ?? ''}|${hostPart}`
  return createHash('sha256').update(base).digest('hex')
}

let cached: string | null = null

/** بصمة الجهاز الحالية — تُحسب مرة واحدة ثم تُخزَّن في الذاكرة (استدعاء الصدفة مكلف) */
export function getDeviceFingerprint(exec: ShellExec = defaultExec): string {
  if (!cached) cached = componentsToFingerprint(collectFingerprintComponents(exec))
  return cached
}

/** يُستخدم في الاختبارات فقط لإعادة ضبط التخزين المؤقت */
export function _resetFingerprintCache(): void {
  cached = null
}
