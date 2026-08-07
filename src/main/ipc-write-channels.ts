/**
 * تصنيف قنوات IPC (كتابة/قراءة-حرة) لبوابة قفل الكتابة (§8.3) —
 * وحدة نقية بلا استيراد electron حتى تُختبَر تصنيفاتها مباشرة بـVitest.
 *
 * قاعدة التصنيف (موثَّقة للمراجعة):
 *  - كتابة: كل ما يُدرج/يُعدِّل/يحذف بيانات أعمال (فواتير، دفاتر، كيانات، إعدادات).
 *  - حرّ: كل list/get/قراءة، auditLogs:list، users:login/logout/current
 *    (الدخول شرط القراءة نفسها تحت ترخيص منتهٍ)، license:status/fingerprint،
 *    وlicense:activate (طريق التجديد — حظره مع ترخيص منتهٍ يمنع التجديد ذاته).
 */
import { IPC } from '../shared/types'

export const WRITE_CHANNELS: ReadonlySet<string> = new Set<string>([
  IPC.productsCreate,
  IPC.productsUpdate,
  IPC.productsDelete,
  IPC.productsRestock,
  IPC.customersCreate,
  IPC.customersUpdate,
  IPC.customersDelete,
  IPC.customerLedgerAdd,
  IPC.suppliersCreate,
  IPC.suppliersUpdate,
  IPC.suppliersDelete,
  IPC.supplierLedgerAdd,
  IPC.purchasesCreate,
  IPC.purchasesUpdate,
  IPC.purchasesDelete,
  IPC.expensesCreate,
  IPC.expensesUpdate,
  IPC.expensesDelete,
  IPC.bankAccountsCreate,
  IPC.bankAccountsUpdate,
  IPC.bankAccountsDelete,
  IPC.paymentTerminalsCreate,
  IPC.paymentTerminalsUpdate,
  IPC.paymentTerminalsDelete,
  IPC.salesCreate,
  IPC.salesUpdate,
  IPC.salesVoid,
  IPC.salesDelete,
  IPC.usersBootstrap,
  IPC.usersCreate,
  IPC.usersUpdate,
  IPC.usersDelete,
  IPC.storeSettingsUpdate,
  IPC.backupsCreate,
  IPC.backupsRestore,
  IPC.backupsDelete,
  IPC.updaterDownload,
  IPC.updaterInstall
])

/** كل قناة ليست كتابة هي قناة حرة (لا تمرّ بالبوابة) */
export const FREE_CHANNELS: ReadonlySet<string> = new Set<string>(
  Object.values(IPC).filter((channel) => !WRITE_CHANNELS.has(channel))
)
