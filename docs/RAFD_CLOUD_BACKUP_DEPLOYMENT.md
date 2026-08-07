# تشغيل النسخ السحابي عبر Supabase

هذه الخطوات خارج بيئة الوكيل لأنها تحتاج مشروع Supabase وبياناته السرية.
لا تضع `SUPABASE_SERVICE_ROLE_KEY` داخل تطبيق Electron أو داخل المستودع.

## 1. إنشاء/اختيار مشروع Supabase

أنشئ مشروعًا خاصًا بالنسخ الاحتياطية، ثم ثبّت Supabase CLI وسجّل الدخول:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
```

## 2. تطبيق مخطط قاعدة البيانات

من جذر المستودع:

```bash
supabase db push
```

سيُنشئ ذلك:

- جدول `rafd_backup_clients`.
- bucket خاصًا باسم `rafd-backups`.
- عدم وجود RLS policies عامة على بيانات العملاء.

## 3. ضبط أسرار Edge Function

```bash
supabase secrets set \
  SUPABASE_URL="https://<PROJECT_REF>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<SERVICE_ROLE_KEY>"
```

المفتاح `SUPABASE_SERVICE_ROLE_KEY` يبقى داخل Supabase فقط.

## 4. نشر الدالة

```bash
supabase functions deploy backup-api --no-verify-jwt
```

الدالة تطبق مصادقة خاصة عبر:

```text
x-rafd-backup-token
```

ولا تعتمد على مفتاح service role من تطبيق العميل.

## 5. إنشاء token لمتجر

ولّد token عشوائيًا طويلًا خارج المستودع، ثم احسب SHA256 له. مثال باستخدام Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

ثم احسب hash للـtoken، وأدخل فقط الـhash داخل Supabase:

```sql
insert into public.rafd_backup_clients (store_id, token_hash)
values ('store-001', '<SHA256_HEX_OF_TOKEN>');
```

يُسلَّم token الخام للعميل عبر قناة آمنة خارج GitHub والدردشة، ولا يُحفظ في الكود.

## 6. اختبار الدالة يدويًا

عنوان الدالة:

```text
https://<PROJECT_REF>.supabase.co/functions/v1/backup-api
```

قائمة النسخ:

```bash
curl -H "x-rafd-backup-token: <TOKEN>" \
  "https://<PROJECT_REF>.supabase.co/functions/v1/backup-api/store-001"
```

رفع ملف مشفر:

```bash
curl -X POST \
  -H "x-rafd-backup-token: <TOKEN>" \
  -H "x-rafd-sha256: <SHA256_OF_ENCRYPTED_FILE>" \
  --data-binary @backup.rafd.enc \
  "https://<PROJECT_REF>.supabase.co/functions/v1/backup-api/store-001/backup-001"
```

## ما يحتاج ربطًا لاحقًا داخل التطبيق

بعد توفير:

- endpoint النهائي.
- store ID.
- token الخاص بالمتجر.
- قرار مكان حفظ token على Windows.

يتم ربط `backup-crypto.ts` مع عميل الرفع، وإضافة:

- رفع النسخة المشفرة.
- retry عند انقطاع الإنترنت.
- progress.
- download/restore من السحابة.
- حذف النسخ حسب سياسة الاحتفاظ.

لا يُسمح برفع النسخة SQLite الخام؛ الرفع يجب أن يكون للملف المشفر فقط.
