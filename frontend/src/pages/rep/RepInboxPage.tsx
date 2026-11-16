import { InboxView } from '../inbox/InboxView';
import { REP_VIEWS, isNoteSubject, repLink } from '../inbox/model';
import { useRepChat } from '../../components/rep/RepChatPanel';

/** The rep's Inbox (M9-T40): reminders, notifications and team notes for this rep. The API only returns the rep's own rows. A conversation row opens the chat panel over the Inbox. */
export function RepInboxPage() {
  const { openConversation, openNotes } = useRepChat();
  return (
    <InboxView
      title="Inbox"
      subtitle="Your reminders, mentions and notes."
      views={REP_VIEWS}
      linkFor={repLink}
      openerFor={(s, kind) => {
        if (s.type === 'conversation') return () => openConversation(s.id);
        if (isNoteSubject(s) && (kind === 'note' || kind === 'mention')) return () => openNotes(s);
        return null;
      }}
      hideThread
      compact
    />
  );
}

export default RepInboxPage;
