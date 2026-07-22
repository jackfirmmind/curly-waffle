import { useState, useCallback } from 'react';
import { supabase } from './lib/supabase';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import AuthPage from './components/AuthPage';
import AppShell from './components/AppShell';
import OverviewView from './components/coach/OverviewView';
import CompaniesView from './components/coach/CompaniesView';
import CompanyWorkspace from './components/coach/CompanyWorkspace';
import ParticipantDashboard from './components/participant/ParticipantDashboard';
import { LayoutDashboard, Building2 } from 'lucide-react';
import type { Company } from './lib/types';

function CoachApp() {
  const [view, setView] = useState<string>('overview');
  const [openCompany, setOpenCompany] = useState<Company | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<string>('participants');
  const [refreshKey, setRefreshKey] = useState(0);

  const navItems = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
    { id: 'companies', label: 'Companies', icon: <Building2 size={16} /> },
  ];

  const handleNavigate = (id: string) => {
    if (id.startsWith('company:')) {
      const parts = id.split(':');
      const companyId = parts[1];
      const tab = parts[2] || 'participants';
      (async () => {
        const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
        if (data) {
          setOpenCompany(data as Company);
          setWorkspaceTab(tab);
          setView('workspace');
        }
      })();
      return;
    }
    setView(id);
    setOpenCompany(null);
  };

  const handleOpenCompany = (c: Company) => {
    setOpenCompany(c);
    setView('workspace');
  };

  const handleBack = () => {
    setOpenCompany(null);
    setView('companies');
    setRefreshKey((k) => k + 1);
  };

  let content;
  if (openCompany && view === 'workspace') {
    content = <CompanyWorkspace key={openCompany.id + workspaceTab} company={openCompany} onBack={handleBack} initialTab={workspaceTab as any} />;
  } else if (view === 'overview') {
    content = <OverviewView onNavigate={handleNavigate} />;
  } else {
    content = <CompaniesView onOpenCompany={handleOpenCompany} refreshKey={refreshKey} />;
  }

  const activeNav = view === 'workspace' ? 'companies' : view;

  return (
    <AppShell navItems={navItems} activeView={activeNav} onNavigate={handleNavigate} roleLabel="Coach">
      {content}
    </AppShell>
  );
}

function ParticipantApp() {
  const navItems = [
    { id: 'dashboard', label: 'My Dashboard', icon: <LayoutDashboard size={16} /> },
  ];

  const handleNavigate = useCallback((_link: string) => {
    // Participant links like "participant:assignments" — just stay on dashboard
  }, []);

  return (
    <AppShell navItems={navItems} activeView="dashboard" onNavigate={handleNavigate} roleLabel="Participant">
      <ParticipantDashboard />
    </AppShell>
  );
}

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-full border-2 border-brand-200 border-t-brand-600 animate-spin" />
          <p className="text-sm text-ink-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  return user.role === 'consultant' ? <CoachApp /> : <ParticipantApp />;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </AuthProvider>
  );
}
