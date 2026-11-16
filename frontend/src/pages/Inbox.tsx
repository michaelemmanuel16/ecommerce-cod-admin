import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { useAuthStore } from '../stores/authStore';
import { InboxView } from './inbox/InboxView';
import { NotificationSettings } from './inbox/NotificationSettings';
import { VIEWS, adminLink } from './inbox/model';

/**
 * Inbox (M9-T37), built from docs/mockups/v2/inbox.html: everything that needs you in one list. The views, the rows and every action come from the Inbox API.
 * `?view=settings` opens the notification settings (M9-T39) in place of the list, as the mockup's gear does.
 */
export function Inbox() {
  useV2Page();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  if (params.get('view') === 'settings' && user) {
    return (
      <section className="inbx compact">
        <Link to="/inbox" className="back"><ArrowLeft aria-hidden="true" /> Inbox</Link>
        <div className="head"><div><h1>Notification settings</h1><p>Choose what reaches you, and on which channel.</p></div></div>
        <NotificationSettings user={user} />
      </section>
    );
  }
  return (
    <InboxView
      title="Inbox"
      subtitle="Everything that needs you: alerts, reminders, replies and team notes."
      views={VIEWS.map((v) => v.id)}
      linkFor={adminLink}
      settingsHref="/inbox?view=settings"
    />
  );
}
