import { Drawer } from '../../components/ui-v2';
import type { InboxSubject } from '../../services/inbox.service';
import { ThreadPanel } from './ThreadPanel';
import { subjectLabel } from './model';

interface Props {
  subject: InboxSubject | null;
  onClose: () => void;
  /** The thread was opened or written to: the row may now be read. */
  onTouched?: () => void;
}

/** A team note thread in a drawer (M9-T37). The notes themselves are ThreadPanel. */
export function ThreadDrawer({ subject, onClose, onTouched }: Props) {
  return (
    <Drawer
      open={!!subject}
      onClose={onClose}
      title={subject ? `${subjectLabel(subject)} thread` : 'Thread'}
      description="Team notes on this item. Type @ to mention a teammate."
    >
      <ThreadPanel subject={subject} onTouched={onTouched} />
    </Drawer>
  );
}
