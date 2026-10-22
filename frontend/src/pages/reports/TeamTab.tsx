import { Users } from 'lucide-react';
import { EmptyState } from '../../components/ui-v2';

/** The Team performance slot (F-1054, F-1057). M3-T62 builds the tiles, donut, decline reasons and rep table here. */
export function TeamTab() {
  return (
    <div className="panel">
      <div className="card">
        <EmptyState icon={<Users />} title="Team performance is not on this page yet" text="It opens here in the next update." />
      </div>
    </div>
  );
}
