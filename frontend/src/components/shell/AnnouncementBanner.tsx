import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { platformService, type Announcement } from '../../services/platform.service';

// Platform announcement (F-108): info, warning or maintenance. Dismissed for the session.
const DISMISSED_KEY = 'dismissed-announcements';

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // not remembered; it shows again after reload
  }
}

export function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const { announcements } = await platformService.getActiveAnnouncements();
        const dismissed = readDismissed();
        setAnnouncements(announcements.filter((a) => !dismissed.includes(a.id)));
      } catch {
        // the banner is not critical: no banner, no error toast
      }
    };

    load();
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const dismiss = (id: string) => {
    writeDismissed([...readDismissed(), id]);
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
  };

  if (announcements.length === 0) return null;

  return (
    <>
      {announcements.map((a) => (
        <div key={a.id} className={`banner ${a.type}`} role="status">
          <span><b>{a.title}</b> {a.body}</span>
          <button type="button" className="ibtn sm" onClick={() => dismiss(a.id)} aria-label="Dismiss announcement">
            <X />
          </button>
        </div>
      ))}
    </>
  );
}
