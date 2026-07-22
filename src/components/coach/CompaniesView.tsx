import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../lib/AuthContext';
import Modal from '../ui/Modal';
import EmptyState from '../ui/EmptyState';
import { Building2, Plus, Pencil, Trash2, Users, ArrowRight, Calendar, FileText, CheckCircle2, Clock } from 'lucide-react';
import type { Company } from '../../lib/types';

interface CompanyWithStats extends Company {
  participantCount: number;
  assignmentCount: number;
  meetingCount: number;
  submissionCount: number;
  needsReview: number;
  complete: number;
}

interface Props {
  onOpenCompany: (company: Company) => void;
  refreshKey?: number;
}

export default function CompaniesView({ onOpenCompany, refreshKey }: Props) {
  const { user } = useAuth();
  const { show } = useToast();
  const [companies, setCompanies] = useState<CompanyWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: '', industry: '', description: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.consultantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, industry, description, created_at, consultant_id')
      .eq('consultant_id', user.consultantId)
      .order('created_at', { ascending: false });

    if (error) {
      show('Failed to load companies.', 'error');
      setLoading(false);
      return;
    }

    const enriched: CompanyWithStats[] = [];
    for (const c of data || []) {
      const [p, a, m] = await Promise.all([
        supabase.from('participants').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
        supabase.from('assignments').select('id').eq('company_id', c.id),
        supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
      ]);
      const assignmentIds = (a.data || []).map((x) => x.id);
      let subs: any[] = [];
      if (assignmentIds.length) {
        const { data: sData } = await supabase.from('assignment_submissions').select('id, status').in('assignment_id', assignmentIds);
        subs = sData || [];
      }
      const needsReview = subs.filter((s) => s.status === 'submitted').length;
      const complete = subs.filter((s) => s.status === 'approved' || s.status === 'reviewed').length;
      enriched.push({
        ...c,
        participantCount: p.count || 0,
        assignmentCount: a.data?.length || 0,
        meetingCount: m.count || 0,
        submissionCount: subs.length,
        needsReview,
        complete,
      });
    }
    setCompanies(enriched);
    setLoading(false);
  }, [user?.consultantId, show]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', industry: '', description: '' });
    setModalOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditing(company);
    setForm({ name: company.name, industry: company.industry || '', description: company.description || '' });
    setModalOpen(true);
  };

  const save = async () => {
    if (!user?.consultantId || !form.name.trim()) return;
    setSaving(true);
    if (editing) {
      const { error } = await supabase
        .from('companies')
        .update({ name: form.name.trim(), industry: form.industry.trim() || null, description: form.description.trim() || null })
        .eq('id', editing.id);
      if (error) show('Failed to update company.', 'error');
      else show('Company updated.');
    } else {
      const { error } = await supabase
        .from('companies')
        .insert({ consultant_id: user.consultantId, name: form.name.trim(), industry: form.industry.trim() || null, description: form.description.trim() || null });
      if (error) show('Failed to create company.', 'error');
      else show('Company created.');
    }
    setSaving(false);
    setModalOpen(false);
    load();
  };

  const remove = async (company: Company) => {
    if (!confirm(`Delete "${company.name}" and all its data?`)) return;
    const { error } = await supabase.from('companies').delete().eq('id', company.id);
    if (error) show('Failed to delete company.', 'error');
    else {
      show('Company deleted.');
      load();
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card h-44 animate-pulse bg-ink-100/50" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-ink-500">
          {companies.length} {companies.length === 1 ? 'company' : 'companies'} in your portfolio
        </p>
        <button onClick={openCreate} className="btn-primary">
          <Plus size={16} /> Add company
        </button>
      </div>

      {companies.length === 0 ? (
        <EmptyState
          icon={<Building2 size={24} />}
          title="No companies yet"
          description="Add your first company to start managing participants, assignments, and meetings."
          action={
            <button onClick={openCreate} className="btn-primary">
              <Plus size={16} /> Add your first company
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => {
            // Calculate status
            const hasOutstanding = c.needsReview > 0;
            return (
              <div key={c.id} className={`card-hover group flex flex-col p-5 animate-fade-in ${hasOutstanding ? 'border-amber-200 bg-amber-50/30' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${hasOutstanding ? 'bg-amber-100 text-amber-700' : 'bg-brand-50 text-brand-600'}`}>
                    <Building2 size={20} />
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => openEdit(c)} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(c)} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3 className="mt-3 font-display text-base font-semibold text-ink-900">{c.name}</h3>
                {c.industry && <p className="text-xs text-ink-500 mt-0.5">{c.industry}</p>}
                {c.description && <p className="mt-2 text-sm text-ink-600 line-clamp-2">{c.description}</p>}

                {/* Status indicators */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {c.needsReview > 0 && (
                    <span className="flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                      <Clock size={12} /> {c.needsReview} to review
                    </span>
                  )}
                  {c.complete > 0 && (
                    <span className="flex items-center gap-1.5 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 size={12} /> {c.complete} complete
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-ink-900 font-semibold text-sm">
                      <Users size={13} className="text-ink-400" /> {c.participantCount}
                    </div>
                    <div className="text-[10px] text-ink-400 uppercase tracking-wide">People</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-ink-900 font-semibold text-sm">
                      <FileText size={13} className="text-ink-400" /> {c.assignmentCount}
                    </div>
                    <div className="text-[10px] text-ink-400 uppercase tracking-wide">Tasks</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-ink-900 font-semibold text-sm">
                      <Calendar size={13} className="text-ink-400" /> {c.meetingCount}
                    </div>
                    <div className="text-[10px] text-ink-400 uppercase tracking-wide">Meetings</div>
                  </div>
                </div>

                <button
                  onClick={() => onOpenCompany(c)}
                  className={`mt-4 flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors ${hasOutstanding ? 'border-amber-300 text-amber-700 hover:bg-amber-100' : 'border-ink-200 text-ink-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700'}`}
                >
                  Open workspace <ArrowRight size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit company' : 'Add company'}
        description={editing ? 'Update company details.' : 'Create a new company workspace.'}
      >
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="c-name">Company name</label>
            <input id="c-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Corp" />
          </div>
          <div>
            <label className="label" htmlFor="c-industry">Industry <span className="text-ink-400 font-normal">(optional)</span></label>
            <input id="c-industry" className="input" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Technology, Healthcare..." />
          </div>
          <div>
            <label className="label" htmlFor="c-desc">Description <span className="text-ink-400 font-normal">(optional)</span></label>
            <textarea id="c-desc" className="input min-h-[80px] resize-y" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Brief description..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving || !form.name.trim()} className="btn-primary">
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create company'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
