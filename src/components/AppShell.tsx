import { ReactNode, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Sparkles, LogOut, Menu, ChevronRight, User as UserIcon } from 'lucide-react';
import NotificationBell from './ui/NotificationBell';
import Avatar from './ui/Avatar';
import ProfileModal from './ui/ProfileModal';

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

interface AppShellProps {
  navItems: NavItem[];
  activeView: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
  roleLabel: string;
}

export default function AppShell({ navItems, activeView, onNavigate, children, roleLabel }: AppShellProps) {
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const activeItem = navItems.find((n) => n.id === activeView);

  const Sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-ink-100">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Sparkles size={18} />
        </div>
        <div>
          <div className="font-display text-base font-bold text-ink-900 leading-none">Portal</div>
          <div className="text-[11px] text-ink-400 mt-0.5">{roleLabel}</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const active = item.id === activeView;
          return (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                setMobileOpen(false);
              }}
              className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
              }`}
            >
              <span className={active ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-600'}>
                {item.icon}
              </span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  active ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-700'
                }`}>
                  {item.badge}
                </span>
              )}
              {active && <ChevronRight size={14} className="text-brand-500" />}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-ink-100 p-3">
        <button
          onClick={() => { setProfileOpen(true); setMobileOpen(false); }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-ink-100"
        >
          <Avatar name={user?.fullName || user?.email || 'User'} avatarUrl={user?.avatarUrl} emoji={user?.vibeEmoji} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium text-ink-900">{user?.fullName || 'User'}</div>
            <div className="truncate text-xs text-ink-400">{user?.status || user?.email}</div>
          </div>
        </button>
        <button
          onClick={() => { setProfileOpen(true); setMobileOpen(false); }}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <UserIcon size={16} />
          Profile
        </button>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-600 transition-colors hover:bg-red-50 hover:text-red-700"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-ink-200 bg-white lg:block">
        {Sidebar}
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-lift animate-slide-in-right">
            {Sidebar}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink-200 bg-white/90 backdrop-blur px-4 py-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="hidden lg:block">
            {activeItem && <h1 className="font-display text-lg font-bold text-ink-900">{activeItem.label}</h1>}
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell onNavigate={(link) => onNavigate(link)} />
            <div className="hidden sm:flex items-center gap-2">
              <Avatar name={user?.fullName || user?.email || 'User'} avatarUrl={user?.avatarUrl} emoji={user?.vibeEmoji} size="sm" onClick={() => setProfileOpen(true)} />
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 max-w-7xl mx-auto">
          {activeItem && (
            <div className="mb-6 animate-fade-in lg:hidden">
              <h1 className="font-display text-2xl font-bold text-ink-900">{activeItem.label}</h1>
            </div>
          )}
          {children}
        </main>
      </div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} mode="self" />
    </div>
  );
}
