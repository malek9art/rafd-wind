/**
 * بوابة «قفل الكتابة» المركزية (§8.3) — تنفيذ قرار التصميم المعتمد في التكليف:
 * نقطة فحص واحدة تُطبَّق من ipc.ts على كل قناة كتابة (مصنَّفة مركزيًا في
 * ipc-write-channels.ts)، لا فحص مكرر يدوي داخل المستودعات.
 *
 * القاعدة:
 *  - منتهٍ (activated + expired): الكتابة ممنوعة برسالة صريحة؛ القراءة لا تمر
 *    من هنا أصلًا فتبقى حرة دائمًا (التاجر لا يُحتجَز رهينة — §8.3).
 *  - بلا ترخيص مُفعَّل: الكتابة ممنوعة أيضًا (دفاع عميق: منع الدخول الكامل في
 *    الواجهة يقابله منع كتابة في العملية الرئيسية — قرار موثَّق).
 * التفعيل (license:activate) لا يمرّ بهذه البوابة أبدًا — هو طريق التجديد ذاته.
 */
import { loadLicenseStatus, type LoadOptions } from './license'

export const EXPIRED_WRITE_MESSAGE =
  'انتهت صلاحية الترخيص — القراءة متاحة دائمًا، لكن عمليات الكتابة (بيع/شراء/تعديل) متوقفة. تواصل مع الإدارة للحصول على مفتاح جديد'
export const UNLICENSED_WRITE_MESSAGE = 'لا يوجد ترخيص مُفعَّل صالح — فعِّل الترخيص أولًا'

/**
 * options تُمرَّر كاملة إلى التحقق (now/publicKeyBase64 للاختبارات) —
 * الإنتاج يستدعي بلا خيارات فيستخدم الوقت الحالي والمفتاح المضمَّن.
 */
export function assertLicenseWritable(userDataDir: string, options: LoadOptions = {}): void {
  const status = loadLicenseStatus(userDataDir, options)
  if (!status.activated) throw new Error(UNLICENSED_WRITE_MESSAGE)
  if (status.expired) throw new Error(EXPIRED_WRITE_MESSAGE)
}
