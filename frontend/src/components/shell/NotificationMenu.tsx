import { Bell } from 'lucide-react';
import { useNotificationsStore } from '../../stores/notificationsStore';
import { usePopover } from './usePopover';

/** The bell. It keeps what the old header bell did (the latest notifications, mark as read) until the Inbox page and
 *  the database count arrive (M3-T36); the mockup links the bell to the Inbox. */
export function NotificationMenu() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotificationsStore();
  const { open, toggle, wrapRef, triggerRef } = usePopover();

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
            notifications.slice(0, 10).map((n) => (
              <button
                type="button"
                role="menuitem"
                key={n.id}
                className={n.read ? 'sx-note read' : 'sx-note'}
                onClick={() => markAsRead(n.id)}
              >
                <b>{n.title}</b>
                <small>{n.message}</small>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
