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
      {(d) => {
        const feePartners = d.partners.filter((p) => Number(p.fees) > 0);
        const lostPartners = d.partners.filter((p) => p.unitsLost > 0);
        const hints = d.partners.filter((p) => p.hint);
        return (
        <Card title="Cost of failed deliveries" aside={`${monthOf(d.to)} · ${rangeLabel(d.from, d.to)}`} className="fincard">
          {d.partners.length === 0 ? (
            <EmptyState title="No failed or returned orders" text="Nothing failed or came back in these dates." />
          ) : (
            <>
              <div className="tablewrap">
                <table className="dt cohort" aria-label="Cost of failed deliveries">
                  <tbody>
                    <tr>
                      <td>
                        Fee kept on failed orders
                        <small>{feePartners.map((p) => `${p.name} ${p.failedOrders} failed or returned`).join(', ') || 'No fee was kept'}</small>
                        {hints.map((p) => <small key={p.partnerId ?? 'none'}>{p.name}: {p.hint}</small>)}
                      </td>
                      <td className="r num">{money(d.fees)}</td>
                    </tr>
                    <tr>
                      <td>
                        Returned units lost
                        <small>{lostPartners.map((p) => `${p.unitsLost} missing at ${p.name}`).join(', ') || 'No unit is missing'}</small>
                      </td>
                      <td className="r num">{money(d.lostCost)}</td>
                    </tr>
                    <tr className="tot">
                      <td>Total</td>
                      <td className="r num">{money(d.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="note">This is the direct cash cost. It leaves out the lost sale and the ad spend behind each failed order.</p>
            </>
          )}
        </Card>
        );
      }}
    </Part>
  );
}
