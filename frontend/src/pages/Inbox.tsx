import { useV2Page } from '../components/shell/useV2Page';
import { InboxView } from './inbox/InboxView';
import { VIEWS, adminLink } from './inbox/model';

/** Inbox (M9-T37), built from docs/mockups/v2/inbox.html: everything that needs you in one list. The views, the rows and every action come from the Inbox API. */
export function Inbox() {
  useV2Page();
  return (
    <InboxView
      title="Inbox"
      subtitle="Everything that needs you: alerts, reminders, replies and team notes."
      views={VIEWS.map((v) => v.id)}
      linkFor={adminLink}
    />
  );
}
