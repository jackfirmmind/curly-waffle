import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { useToast } from './Toast';
import Modal from './Modal';
import EmptyState from './EmptyState';
import { formatDate } from '../../lib/format';
import type { SessionNote } from '../../lib/types';
import { NotebookPen, Plus, Pencil, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';

interface Props {
  companyId: string;
  participantId: string;
  /** Coaches can write; participants get a read-only list of shared notes. */
  canEdit: boolean;
  emptyHint?: string;
}

const blank = () => ({
  session_date: new Date().toISOString().slice(0, 10),
  title: '',
  body: '',
  shared_with_participant: false,
});

export default function SessionNotes({ companyId, participantId, canEdit, emptyHint }: Props) {
  const { user } = useAuth();
  const { show } = useToast();

  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<SessionNote | null>(null);
  const [form, setForm] = useState(blank());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('session_notes')
      .select('*')
      .eq('participant_id', participantId)
      .order('session_date', { ascending: false })
      .order('created_at', { ascending: false });
    setNotes((data || []) as SessionNote[]);
    setLoading(false);
  }, [participantId]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(blank()); setModal(true); };

  const openEdit = (n: SessionNote) => {
    setEditing(n);
    setForm({
      session_date: n.session_date,
      title: n.title || '',
      body: n.body,
      shared_with_participant: n.shared_with_participant,
    });
    setModal(true);
  };

  const save = async () => {
    if (!form.body.trim() || !user) return;
    setSaving(true);
    const payload = {
      session_date: form.session_date,
      title: form.title.trim() || null,
      body: form.body.trim(),
      shared_with_participant: form.shared_with_participant,
    };

    if (editing) {
      const { error } = await supabase.from('session_notes').update(payload).eq('id', editing.id);
      setSaving(false);
      if (error) { show("Couldn't save that note.", 'error'); return; }
    } else {
      const { error } = await supabase.from('session_notes').insert({
        ...payload, company_id: companyId, participant_id: participantId, author_id: user.id,
      });
      setSaving(false);
      if (error) { show("Couldn't save that note.", 'error'); return; }
    }

    setModal(false);
    show(editing ? 'Note updated.' : 'Note saved.', 'success');
    load();
  };

  const toggleShare = async (n: SessionNote) => {
    const next = !n.shared_with_participant;
    setBusyId(n.id);
    const { error } = await supabase
      .from('session_notes').update({ shared_with_participant: next }).eq('id', n.id);
    setBusyId(null);
    if (error) { show("Couldn't update sharing.", 'error'); return; }
    setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, shared_with_participant: next } : x)));
    show(next ? 'Shared with them.' : 'Now private to you.', 'success');
  };

  const remove = async (n: SessionNote) => {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    setBusyId(n.id);
    const { error } = await supabase.from('session_notes').delete().eq('id', n.id);
    setBusyId(null);
    if (error) { show("Couldn't delete that note.", 'error'); return; }
    setNotes((prev) => prev.filter((x) => x.id !== n.id));
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">{notes.length} note{notes.length === 1 ? '' : 's'}</p>
        {canEdit && (
          <button onClick={openNew} className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} /> Add note
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-24 rounded-xl bg-ink-100 animate-pulse" />)}</div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={<NotebookPen size={22} />}
          title="No notes yet"
          description={emptyHint || (canEdit
            ? 'Paste your meeting summary or type what was discussed. Everything for this person stays here, newest first.'
            : 'Your coach has not shared any session notes with you yet.')}
        />
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl border border-ink-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-semibold text-ink-900">
                      {n.title || 'Session note'}
                    </span>
                    <span className="text-xs text-ink-400">{formatDate(n.session_date)}</span>
                    {n.shared_with_participant ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        <Eye size={10} /> SHARED
                      </span>
                    ) : canEdit && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold text-ink-500">
                        <EyeOff size={10} /> PRIVATE
                      </span>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => toggleShare(n)} disabled={busyId === n.id}
                      className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      title={n.shared_with_participant ? 'Make private to you' : 'Share with this person'}>
                      {busyId === n.id ? <Loader2 size={15} className="animate-spin" />
                        : n.shared_with_participant ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button onClick={() => openEdit(n)} className="rounded-md p-1.5 text-ink-400 hover:bg-brand-50 hover:text-brand-700" title="Edit">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => remove(n)} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" title="Delete">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{n.body}</p>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? 'Edit note' : 'New session note'}
        description="Paste a meeting summary or write it yourself."
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Session date</label>
              <input type="date" className="input" value={form.session_date}
                onChange={(e) => setForm({ ...form, session_date: e.target.value })} />
            </div>
            <div>
              <label className="label">Title (optional)</label>
              <input className="input" value={form.title} placeholder="e.g. Session 4 — delegation"
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input min-h-[220px] font-mono text-[13px]" value={form.body}
              placeholder="What was discussed, what was agreed, what happens next..."
              onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 hover:bg-ink-50">
            <input type="checkbox" className="mt-0.5" checked={form.shared_with_participant}
              onChange={(e) => setForm({ ...form, shared_with_participant: e.target.checked })} />
            <span className="text-sm">
              <span className="font-medium text-ink-900">Share this note with them</span>
              <span className="block text-xs text-ink-500">
                Off by default — notes are your private record. Turn on to let this person read it in their portal.
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-ink-100">
            <button onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving || !form.body.trim()} className="btn-primary inline-flex items-center gap-2">
              {saving && <Loader2 size={15} className="animate-spin" />} {editing ? 'Save changes' : 'Save note'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
