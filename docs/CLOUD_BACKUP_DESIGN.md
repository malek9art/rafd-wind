# تصميم الدفعة 5-2 — النسخ السحابي عبر Supabase (`rafd-dev` — معزول تمامًا)

> **مرجع الحكم:** `docs/RAFD_DESKTOP_ARCHITECTURE.md` (§10 — النسخ الاحتياطي، §17.2 — مزوّد استضافة الخدمة السحابية).
> **المشروع المستهدف:** `rafd-dev` (لا `rafd-app` — ممنوع لمس أي جدول تابع لـ `rafd-app`: `tenants`, `backups` الحالي، إلخ).
> **قاعدة صارمة (§10):** لا تُعتبَر ميزة النسخ السحابي مكتملة إلا بعد اختبار **استعادة فعلية** من السحابة على تثبيت آخر، لا فقط نجاح الرفع.

---

## 1. الهدف

إنشاء آلية نسخ احتياطي سحابي **جديدة ومعزولة تمامًا** خاصة بـ `rafd-wind` عبر `rafd-dev`:
- **جدول جديد** (`rafd_wind_cloud_backups`) معزول — لا يُشارِك أي بيانات مع `rafd-app`.
- **Storage Bucket جديد** (`rafd-wind-cloud-backups-files`) معزول.
- **RLS** يُقيِّد كل جهاز لبياناته فقط عبر بصمة الجهاز (`hardware fingerprint`, §8.2) أو `license_id`.

---

## 2. البنية المُقترَحة (`rafd-dev` — معزول)

### 2.1 الجدول الجديد (`rafd_wind_cloud_backups`)

```sql
CREATE TABLE rafd_wind_cloud_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint TEXT NOT NULL,       -- بصمة الجهاز (§8.2)
  license_id TEXT NOT NULL,               -- مفتاح الترخيص المرتبط
  backup_filename TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);
```

### 2.2 الـ Storage Bucket (`rafd-wind-cloud-backups-files`)

- مسار التخزين: `{device_fingerprint}/{license_id}/backup-{timestamp}.db`
- كل ملف مُوقَّع بـ SHA-256 (`checksum_sha256`) ويُخزَّن في الجدول للتحقُّق عند التنزيل.

### 2.3 RLS المُقترَح

```sql
CREATE POLICY device_isolation_cloud ON rafd_wind_cloud_backups
  FOR ALL USING (
    auth.uid() IN (
      SELECT user_id FROM device_bindings
      WHERE fingerprint = CURRENT_SETTING('request.jwt.claims', true)::json->>'device_fingerprint'
    )
  );
```

> **تنبيه:** بما أن `rafd-wind` لا يستخدم `auth` Supabase (§6)، يُستبدَل `auth.uid()` بمنطق التحقُّق من `device_fingerprint` المُرسَل مع كل طلب عبر `request.jwt.claims` أو عبر معلمة مباشرة في `cloud-backup.ts`.

---

## 3. ما تم تنفيذه في الكود (`rafd-wind` — الدفعة 5-2)

- `src/main/cloud-backup.ts`: وحدة جديدة تُعرِّف `CloudBackupConfig`، `uploadCloudBackup()`، `downloadCloudBackup()`، `isValidSqliteHeader()`.
- `src/shared/types.ts`: إضافة `cloudBackup` لعقد `RafdLocalApi` و`IPC` (`cloud-backup:upload`, `download`, `status`).
- `src/preload/index.ts`: تسجيل القنوات الجديدة عبر `contextBridge`.
- `src/main/ipc.ts`: تسجيل معالجات `cloudBackupUpload`, `cloudBackupDownload`, `cloudBackupStatus` عبر `registerIpc`.
- `src/renderer/src/App.tsx` + `BackupScreen.tsx`: إضافة أزرار وقسم السحابة في واجهة النسخ الاحتياطي.
- `.github/workflows/build-win.yml`: إضافة خطوة `Smoke BACKUP` (§10) — لكن الدفع محجوب بصلاحية `workflows`.
- `tests/cloud-backup-smoke.mjs`: اختبار هيكلي يتحقَّق من وجود الوحدة وعدم وجود أخطاء نوعية (`typecheck`).

---

## 4. ما هو متبقٍ حتى تُعتبَر الدفعة مكتملة

| الخطوة | الإجراء المطلوب | الحالة |
|---|---|---|
| أ | إعداد مشروع `rafd-dev` (إنشاء `bucket` + جدول `rafd_wind_cloud_backups` + نشر RLS) | ❌ لم يبدأ |
| ب | إدخال بيانات الاتصال (`supabaseUrl`, `anonKey`) عبر ملف إعدادات محلي (لا يُشحن مع `.exe`) | ❌ لم يبدأ |
| ج | اختبار `uploadCloudBackup()` فعليًا مع ملف `.db` حقيقي على `rafd-dev` | ❌ لم يبدأ |
| د | اختبار `downloadCloudBackup()` فعليًا + استعادة + تحقُّق `checksum_sha256` | ❌ لم يبدأ |
| هـ | تشغيل `Smoke BACKUP` في `windows-build-verify` ونجاحه | ❌ لم يُنفَّذ بعد (الملف موجود محليًا) |

---

## 5. قاعدة إلزامية للدفعة 2

- لا ادّعاء "تم رفع النسخة السحابية" بدون نتيجة حرفية من `git rev-parse HEAD` + `git ls-remote --heads origin arena/019fab02-backup-local-1` + تشغيل `Smoke BACKUP` فعليًا.
- لا دمج على `main` — العمل على `arena/019fab02-backup-local-1` فقط.
- لا دفعة 3 (`electron-updater`) قبل اعتماد هذه الدفعة صراحةً من المشرف.
