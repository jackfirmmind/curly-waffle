import { useState, useRef, useEffect } from 'react';
import { Bell, CheckCheck, FileText, Calendar, Star, MessageSquare, FolderOpen } from 'lucide-react';
import { useNotifications } from '../../lib/useNotifications';
import { formatRelative } from '../../lib/format';
import type { NotificationType } from '../../lib/types';

const iconMap: Record<NotificationType, typeof Bell> = {
  new_assignment: FileText,
  submission_received: MessageSquare,
  feedback_received: Star,
  meeting_scheduled: Calendar,
  media_uploaded: FolderOpen,
};

const colorMap: Record<NotificationType, string> = {
  new_assignment: 'bg-brand-50 text-brand-600',
  submission_received: 'bg-emerald-50 text-emerald-600',
  feedback_received: 'bg-amber-50 text-amber-600',
  meeting_scheduled: 'bg-violet-50 text-violet-600',
  media_uploaded: 'bg-sky-50 text-sky-600',
};

interface Props {
  onNavigate: (link: string) => void;
}

export default function NotificationBell({ onNavigate }: Props) {
  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleClick = (notifId: string, link: string | null, readAt: string | null) => {
    if (!readAt) markAsRead(notifId);
    if (link) onNavigate(link);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-ink-200 bg-white shadow-lift animate-scale-in origin-top-right">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h3 className="font-display text-sm font-semibold text-ink-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={24} className="mx-auto text-ink-300" />
                <p className="mt-2 text-sm text-ink-400">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-ink-50">
                {notifications.map((n) => {
                  const Icon = iconMap[n.type] || Bell;
                  const color = colorMap[n.type] || 'bg-ink-100 text-ink-600';
                  const unread = !n.read_at;
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n.id, n.link, n.read_at)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50 ${unread ? 'bg-brand-50/30' : ''}`}
                    >
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink-900 truncate">{n.title}</p>
                          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                        </div>
                        {n.body && <p className="mt-0.5 text-xs text-ink-500 line-clamp-2">{n.body}</p>}
                        <p className="mt-1 text-[11px] text-ink-400">{formatRelative(n.created_at)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
