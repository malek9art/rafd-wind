# رفد Desktop (rafd-wind)

تطبيق سطح مكتب لويندوز لنظام نقاط بيع/محاسبة يعمل **بدون إنترنت 100%**.
المرجع الكامل للمشروع: [docs/RAFD_DESKTOP_ARCHITECTURE.md](docs/RAFD_DESKTOP_ARCHITECTURE.md) (قراءة إلزامية قبل أي عمل).

## الحالة

**المرحلة 0 — الهيكل العظمي (Walking Skeleton):**
Electron + electron-vite + React/TS/Tailwind v4 · SQLite (better-sqlite3) محلية في `userData` ·
تفعيل Ed25519 بمفتاح تجريبي · مسار: تفعيل → منتج → بيع → حفظ → إيصال ·
بناء `.exe` (NSIS) واختباره على GitHub Actions `windows-latest`.

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `npm ci` | تثبيت الاعتمادات |
| `npm test` | اختبارات Vitest (وحدة للترخيص + تكامل SQLite بملف حقيقي) |
| `npm run typecheck` | فحص الأنواع (main/preload + renderer) |
| `npm run build` | بناء الإنتاج إلى `out/` |
| `npm run dev` | تشغيل تطويري (يتطلب ثنائية Electron — غير متاحة في بيئة وكيل Linux الحالية) |
| `npm run keygen` | توليد مفتاح تفعيل **تجريبي** (المرحلة 0 فقط — §8) |
| `npm run package:win` | إنتاج مثبّت NSIS في `dist/` (ينفَّذ على windows-latest) |

## التحقق على ويندوز حقيقي

كل Push على فرع `arena/**` يشغّل `.github/workflows/build-win.yml`:
بناء → تثبيت صامت → تشغيل فعلي → فحص دخاني (تفعيل+بيع) داخل التطبيق المُثبَّت →
إعادة تشغيل للتحقق من الثبات → تحقق مستقل من ملف SQLite بعملية Node منفصلة →
رفع المثبّت كـartifact + كتابة sha256/الحجم في `ci-status/LATEST.md`.
