import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { platformService, Announcement } from '../../services/platform.service';

const typeStyles: Record<string, string> = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  maintenance: 'bg-red-50 text-red-800 border-red-200',
};

export const AnnouncementBanner: React.FC = () => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const { announcements } = await platformService.getActiveAnnouncements();
        const dismissed = JSON.parse(sessionStorage.getItem('dismissed-announcements') || '[]');
        setAnnouncements(announcements.filter(a => !dismissed.includes(a.id)));
      } catch { /* silent — banner is non-critical */ }
    };

    fetchAnnouncements();
    const interval = setInterval(fetchAnnouncements, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const dismiss = (id: string) => {
    const dismissed = JSON.parse(sessionStorage.getItem('dismissed-announcements') || '[]');
    sessionStorage.setItem('dismissed-announcements', JSON.stringify([...dismissed, id]));
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  };

  if (announcements.length === 0) return null;

  return (
    <div className="space-y-1">
      {announcements.map(a => (
        <div key={a.id} className={`flex items-center justify-between px-4 py-2 border rounded-lg text-sm ${typeStyles[a.type] || typeStyles.info}`}>
          <span><strong>{a.title}</strong> — {a.body}</span>
          <button onClick={() => dismiss(a.id)} className="ml-4 p-1 hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
