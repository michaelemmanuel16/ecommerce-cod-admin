import type { ReactNode } from 'react';
import { Tag } from '../../components/ui-v2';
import type { CustomerRow } from '../../services/customers.service';
import { RISK_LABEL, RISK_TONE } from './model';

/** Risk tag with the "Not reachable" and "Blocked" tags beside it (F-350). */
export function RiskTags({ row, children }: { row: Pick<CustomerRow, 'risk' | 'notReachable' | 'codBlocked'>; children?: ReactNode }) {
  return (
    <div className="tags2">
      <Tag tone={RISK_TONE[row.risk]}>{RISK_LABEL[row.risk]}</Tag>
      {row.notReachable && <Tag tone="n">Not reachable</Tag>}
      {row.codBlocked && <Tag tone="n">Blocked</Tag>}
      {children}
    </div>
  );
}
