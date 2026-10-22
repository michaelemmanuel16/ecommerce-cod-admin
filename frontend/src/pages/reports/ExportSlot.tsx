import { Download } from 'lucide-react';
import { Button } from '../../components/ui-v2';

/** The Export button of the header (F-1057). M3-T62 turns it into the Export menu; until then it does nothing. */
export function ExportSlot() {
  return (
    <Button variant="primary" disabled title="Export opens in the next update">
      <Download />
      Export
    </Button>
  );
}
