import { Card, EmptyState } from '../../../components/ui-v2';
import type { FailedDeliveryCost } from '../../../services/financeReports.service';
import { rangeLabel } from '../../reports/format';
import { money, monthOf } from './format';
import { Part } from './Part';
import type { FinanceBlock } from './useBlock';

/** The cost of failed deliveries (F-926, M5-T26): fees partners kept on failed and returned orders, plus returned units that never came back. */
export function FailedCostCard({ block }: { block: FinanceBlock<FailedDeliveryCost> }) {
  return (
    <Part name="Cost of failed deliveries" block={block} height={260}>
      {(d) => (
        <Card title="Cost of failed deliveries" aside={`${monthOf(d.to)} · ${rangeLabel(d.from, d.to)}`} className="fincard">
          {d.partners.length === 0 ? (
            <EmptyState title="No failed or returned orders" text="Nothing failed or came back in these dates." />
          ) : (
            <>
              <div className="tablewrap">
                <table className="dt cohort" aria-label="Cost of failed deliveries">
                  <thead>
                    <tr><th>Partner</th><th className="r">Fees kept</th><th className="r">Units lost</th><th className="r">Total</th></tr>
                  </thead>
                  <tbody>
                    {d.partners.map((p) => (
                      <tr key={p.partnerId ?? 'none'}>
                        <td>
                          {p.name}
                          <small>{p.failedOrders} failed or returned</small>
                          {p.hint && <small>{p.hint}</small>}
                        </td>
                        <td className="r num">{money(p.fees)}</td>
                        <td className="r num">{p.unitsLost}<small>{money(p.lostCost)}</small></td>
                        <td className="r num">{money(p.total)}</td>
                      </tr>
                    ))}
                    <tr className="tot">
                      <td>Total</td>
                      <td className="r num">{money(d.fees)}</td>
                      <td className="r num">{d.unitsLost}<small>{money(d.lostCost)}</small></td>
                      <td className="r num">{money(d.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="note">This is the direct cash cost. It leaves out the lost sale and the ad spend behind each failed order.</p>
            </>
          )}
        </Card>
      )}
    </Part>
  );
}
