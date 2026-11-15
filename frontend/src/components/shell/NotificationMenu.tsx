import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useInboxStore } from '../../stores/inboxStore';
import { usePopover } from './usePopover';
import { notificationText } from './notificationText';

/** The bell. The unread count is the Inbox's "All" count, read from the database (`/api/inbox/counts`) and kept
 *  current by the socket events `inbox:counts` and `inbox:new`, or by a 60 second poll while the socket is down
 *  (inboxStore). The popover lists the latest open rows from `/api/inbox`; the full list is on the Inbox page. */
export function NotificationMenu() {
  const unreadCount = useInboxStore((s) => s.counts?.all ?? 0);
  const recent = useInboxStore((s) => s.recent);
  const { fetchRecent, markRead, markAllRead } = useInboxStore.getState();
  const { open, toggle, close, wrapRef, triggerRef } = usePopover();

  // The list is read when the popover opens, and again when the count moves while it is open.
  useEffect(() => {
    if (open) void fetchRecent();
  }, [open, unreadCount, fetchRecent]);

  return (
    <div className="popwrap" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="ibtn"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell />
        {unreadCount > 0 && <span className="dot" />}
      </button>
      {open && (
        <div className="sx-menu wide" role="menu">
          <div className="sx-who sx-row">
            <b>Notifications</b>
            <button type="button" className="mini" onClick={() => void markAllRead()}>Mark all as read</button>
          </div>
          {recent.length === 0 ? (
            <div className="sx-empty">No notifications</div>
          ) : (
            recent.map((n) => {
              const text = notificationText({ title: n.title, message: n.message, data: n.data, type: n.event });
              return (
                <button
                  type="button"
                  role="menuitem"
                  key={n.id}
                  className={n.isRead ? 'sx-note read' : 'sx-note'}
                  onClick={() => void markRead(n.id)}
                >
                  <b>{text.title}</b>
                  <small>{text.message}</small>
                </button>
              );
            })
          )}
          <Link to="/inbox" role="menuitem" className="sx-note" onClick={close}>
            <b>Open Inbox</b>
          </Link>
        </div>
      )}
    </div>
  );
}
