import { useEffect, useState } from 'react'
import type { SaleWithItems, StoreSettings } from '../../../shared/types'
import { buildEscPosInvoice } from '../../../shared/escpos'

interface Props {
  data: SaleWithItems
  onNewSale: () => void
}

export default function ReceiptScreen({ data, onNewSale }: Props) {
  const { sale, items } = data
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [printingEsc, setPrintingEsc] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch store settings on mount for the print templates
  useEffect(() => {
    window.rafdLocal.storeSettings
      .get()
      .then(setSettings)
      .catch((e) => console.error('Failed to load store settings for receipt', e))
  }, [])

  const change = Math.round((sale.paid - sale.total) * 100) / 100

  // Trigger raw binary ESC/POS thermal printing
  async function handleThermalPrint() {
    setPrintingEsc(true)
    setError(null)
    try {
      const bytes = buildEscPosInvoice(data, settings)
      const success = await window.rafdLocal.printer.printRaw(bytes)
      if (!success) {
        setError('فشلت الطباعة الحرارية. تأكد من إعدادات منفذ الطابعة وتوصيل الكابل.')
      }
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setPrintingEsc(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div id="receipt-print-area" className="card p-6 shadow-md bg-white text-black border border-gray-200">
        <div className="mb-4 border-b border-dashed border-gray-300 pb-3 text-center">
          <h2 className="text-xl font-bold text-teal-600">
            {settings?.name_ar || settings?.name || 'رفد — نظام مبيعات'}
          </h2>
          {settings?.address && <div className="text-xs text-gray-500">{settings.address}</div>}
          {settings?.phone && <div className="text-xs text-gray-500">تلفون: {settings.phone}</div>}
          {settings?.tax_number && (
            <div className="text-xs text-gray-500">الرقم الضريبي: {settings.tax_number}</div>
          )}

          <div className="text-sm font-semibold text-gray-700 mt-2">إيصال مبيعات</div>
          <div className="mt-1 font-mono text-sm font-bold text-gray-800" dir="ltr">
            {sale.invoice_number}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 font-mono" dir="ltr">
            {new Date(sale.created_at).toLocaleString('ar-YE')}
          </div>
        </div>

        <table className="mb-4 w-full text-xs">
          <thead>
            <tr className="border-b border-dashed border-gray-300 text-gray-600">
              <th className="py-1 text-start font-bold">الصنف</th>
              <th className="py-1 text-center font-bold">الكمية / الوزن</th>
              <th className="py-1 text-end font-bold">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-gray-50">
                <td className="py-1.5 font-semibold text-gray-800">{item.product_name}</td>
                <td className="py-1.5 text-center text-gray-700" dir="ltr">
                  {item.sold_by_weight ? (
                    <span>{item.weight_g} جم × {item.unit_price}</span>
                  ) : (
                    <span>{item.quantity} × {item.unit_price}</span>
                  )}
                </td>
                <td className="py-1.5 text-end font-bold text-gray-900" dir="ltr">
                  {item.total.toLocaleString('ar-YE')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1.5 border-t border-dashed border-gray-300 pt-3 text-xs">
          <div className="flex justify-between font-bold text-gray-800">
            <span>الإجمالي الفرعي:</span>
            <span dir="ltr">
              {items.reduce((sum, i) => sum + i.total, 0).toLocaleString('ar-YE')} YER
            </span>
          </div>

          {sale.total < items.reduce((sum, i) => sum + i.total, 0) && (
            <div className="flex justify-between text-gray-600 font-bold">
              <span>الخصم:</span>
              <span dir="ltr">
                {(items.reduce((sum, i) => sum + i.total, 0) - sale.total).toLocaleString('ar-YE')} YER
              </span>
            </div>
          )}

          <div className="flex justify-between font-extrabold text-sm text-gray-900 border-t border-gray-100 pt-1.5">
            <span>الإجمالي النهائي:</span>
            <span dir="ltr" className="text-teal-700">
              {sale.total.toLocaleString('ar-YE')} YER
            </span>
          </div>

          <div className="flex justify-between text-gray-600 font-semibold">
            <span>المبلغ المدفوع:</span>
            <span dir="ltr">{sale.paid.toLocaleString('ar-YE')} YER</span>
          </div>

          {change > 0 ? (
            <div className="flex justify-between text-green-700 font-bold">
              <span>الباقي للعميل:</span>
              <span dir="ltr">{change.toLocaleString('ar-YE')} YER</span>
            </div>
          ) : sale.total - sale.paid > 0 ? (
            <div className="flex justify-between text-red-700 font-bold">
              <span>المتبقي كدين آجل:</span>
              <span dir="ltr">{(sale.total - sale.paid).toLocaleString('ar-YE')} YER</span>
            </div>
          ) : null}
        </div>

        {settings?.invoice_footer && (
          <div className="mt-5 border-t border-gray-100 pt-3 text-center text-[10px] text-gray-500 font-bold">
            {settings.invoice_footer}
          </div>
        )}

        <div className="mt-4 text-center text-[9px] text-gray-400 font-bold">
          نظام رفد POS المحلي — يعمل بالكامل بدون إنترنت
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600 text-center">
          ⚠️ {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        <button
          className="btn btn-primary flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1"
          disabled={printingEsc}
          onClick={handleThermalPrint}
        >
          {printingEsc ? '⏳ جارٍ الطباعة...' : '🖨️ طباعة حرارية (ESC/POS)'}
        </button>

        <button
          className="btn border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 px-4 py-2.5 text-xs font-bold flex-1"
          onClick={() => window.print()}
        >
          📄 طباعة عادية / PDF
        </button>

        <button
          className="btn border-gray-200 bg-white text-gray-600 hover:bg-gray-50 px-4 py-2.5 text-xs font-bold w-full"
          onClick={onNewSale}
        >
          🛒 فاتورة جديدة
        </button>
      </div>
    </div>
  )
}
