import { useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useNotificationsStore } from '../../stores/notificationsStore';
import { usePopover } from './usePopover';
import { notificationText } from './notificationText';

/** The bell. The count is read from the database (GET /api/notifications/unread-count) on load and again on every
 *  socket event `notification`. The popover keeps what the old header bell did (the latest notifications, mark as read)
 *  until the Inbox page arrives (M9); the mockup links the bell to the Inbox. */
export function NotificationMenu() {
  const { notifications, unreadCount, markAsRead, markAllAsRead, fetchUnreadCount, fetchNotifications } = useNotificationsStore();
  const { open, toggle, wrapRef, triggerRef } = usePopover();

  useEffect(() => {
    void fetchUnreadCount();
  }, [fetchUnreadCount]);

  // The list is read when the popover opens, and again when the count moves while it is open.
  useEffect(() => {
    if (open) void fetchNotifications();
  }, [open, unreadCount, fetchNotifications]);

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
            <button type="button" className="mini" onClick={markAllAsRead}>Mark all as read</button>
          </div>
          {notifications.length === 0 ? (
            <div className="sx-empty">No notifications</div>
          ) : (
            notifications.slice(0, 10).map((n) => {
              const text = notificationText(n);
              return (
                <button
                  type="button"
                  role="menuitem"
                  key={n.id}
                  className={n.read ? 'sx-note read' : 'sx-note'}
                  onClick={() => markAsRead(n.id)}
                >
                  <b>{text.title}</b>
                  <small>{text.message}</small>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
