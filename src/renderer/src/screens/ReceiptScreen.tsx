import type { SaleWithItems } from '../../../shared/types'

interface Props {
  data: SaleWithItems
  onNewSale: () => void
}

export default function ReceiptScreen({ data, onNewSale }: Props) {
  const { sale, items } = data
  const change = Math.round((sale.paid - sale.total) * 100) / 100

  return (
    <div className="mx-auto max-w-md">
      <div id="receipt-print-area" className="card p-6">
        <div className="mb-4 border-b border-dashed border-[var(--color-ink-300)] pb-3 text-center">
          <h2 className="text-xl font-bold text-[var(--primary)]">رفد — نقطة بيع</h2>
          <div className="text-sm text-[var(--text-muted)]">إيصال بيع</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {sale.invoice_number}
          </div>
          <div className="text-xs text-[var(--text-muted)]" dir="ltr">
            {new Date(sale.created_at).toLocaleString('ar')}
          </div>
        </div>

        <table className="mb-4 w-full text-sm">
          <thead>
            <tr className="border-b border-dashed border-[var(--color-ink-300)] text-[var(--text-muted)]">
              <th className="py-1 text-start text-xs font-semibold">الصنف</th>
              <th className="py-1 text-center text-xs font-semibold">كمية</th>
              <th className="py-1 text-end text-xs font-semibold">المبلغ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="py-1.5">{item.product_name}</td>
                <td className="py-1.5 text-center" dir="ltr">
                  {item.quantity} × {item.unit_price}
                </td>
                <td className="py-1.5 text-end" dir="ltr">
                  {item.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1 border-t border-dashed border-[var(--color-ink-300)] pt-3 text-sm">
          <div className="flex justify-between font-bold">
            <span>الإجمالي</span>
            <span dir="ltr">{sale.total}</span>
          </div>
          <div className="flex justify-between text-[var(--text-muted)]">
            <span>المدفوع</span>
            <span dir="ltr">{sale.paid}</span>
          </div>
          {change > 0 && (
            <div className="flex justify-between text-[var(--text-muted)]">
              <span>الباقي للعميل</span>
              <span dir="ltr">{change}</span>
            </div>
          )}
        </div>

        <div className="mt-4 text-center text-xs text-[var(--text-muted)]">شكرًا لتسوقكم معنا</div>
      </div>

      <div className="mt-4 flex gap-3 print:hidden">
        <button className="btn btn-primary flex-1" onClick={() => window.print()}>
          طباعة الإيصال
        </button>
        <button className="btn btn-ghost flex-1" onClick={onNewSale}>
          بيع جديد
        </button>
      </div>
    </div>
  )
}
