import { InboxView } from '../inbox/InboxView';
import { REP_VIEWS, repLink } from '../inbox/model';

/** The rep's Inbox (M9-T40): reminders, notifications and team notes for this rep. The API only returns the rep's own rows. */
export function RepInboxPage() {
  return (
    <InboxView
      title="Inbox"
      subtitle="Your reminders, mentions and notes."
      views={REP_VIEWS}
      linkFor={repLink}
      compact
    />
  );
}

export default RepInboxPage;
