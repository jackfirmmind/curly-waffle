import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../ui/Toast';
import Modal from '../ui/Modal';
import EmptyState from '../ui/EmptyState';
import Avatar from '../ui/Avatar';
import ProfileModal from '../ui/ProfileModal';
import MediaLibrary from '../ui/MediaLibrary';
import ForumView from '../ui/ForumView';
import SessionNotes from '../ui/SessionNotes';
import { listFiles, type StoredFile } from '../../lib/storage';
import { notifyParticipants } from '../../lib/notify';
import { Plus, Pencil, Trash2, Mail, UserPlus, ArrowLeft, Users, FileText, Calendar, CheckCircle2, Clock, XCircle, MessageSquare, ListChecks, AlertCircle, ChevronUp, ChevronDown, Paperclip, FolderOpen, MessagesSquare, NotebookPen, Video } from 'lucide-react';
import type { Company, Participant, ParticipantRole, Assignment, AssignmentSubmission, Meeting, SubmissionStatus, AssignmentQuestion, AssignmentAnswer, QuestionType } from '../../lib/types';
import { formatDate, formatDateTime, formatRelative, initials, isOverdue, roleBadgeClass } from '../../lib/format';

interface Props {
  company: Company;
  onBack: () => void;
  initialTab?: Tab;
}

type Tab = 'participants' | 'assignments' | 'meetings' | 'reviews' | 'media' | 'forum' | 'notes';

interface AssignmentWithMeta extends Assignment {
  recipientCount: number;
  submissionCount: number;
  reviewCount: number;
  files: StoredFile[];
  questions: AssignmentQuestion[];
}

interface SubmissionWithMeta extends AssignmentSubmission {
  participant?: Participant;
  assignment?: Assignment;
  files: StoredFile[];
  answers: AssignmentAnswer[];
  questions?: AssignmentQuestion[];
}

interface QuestionDraft {
  id?: string;
  question_type: QuestionType;
  question_text: string;
  options: string[];
  required: boolean;
  order_index: number;
}

export default function CompanyWorkspace({ company, onBack, initialTab }: Props) {
  const { show } = useToast();
  const [tab, setTab] = useState<Tab>(initialTab || 'participants');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [assignments, setAssignments] = useState<AssignmentWithMeta[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionWithMeta[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [pModal, setPModal] = useState(false);
  const [editingP, setEditingP] = useState<Participant | null>(null);
  const [pForm, setPForm] = useState({ full_name: '', email: '', role: 'participant' as ParticipantRole });
  const [aModal, setAModal] = useState(false);
  const [editingA, setEditingA] = useState<Assignment | null>(null);
  const [aForm, setAForm] = useState({ title: '', description: '', due_date: '' });
  const [aRecipients, setARecipients] = useState<Set<string>>(new Set());
  const [aAll, setAAll] = useState(false);
  const [aQuestions, setAQuestions] = useState<QuestionDraft[]>([]);
  const [mModal, setMModal] = useState(false);
  const [editingM, setEditingM] = useState<Meeting | null>(null);
  const [mForm, setMForm] = useState({ title: '', description: '', scheduled_at: '', duration_minutes: 60, location: '' });
  const [saving, setSaving] = useState(false);

  // Review modal
  const [reviewModal, setReviewModal] = useState<SubmissionWithMeta | null>(null);
  const [viewProfile, setViewProfile] = useState<Participant | null>(null);
  const [mediaTarget, setMediaTarget] = useState<string>('__coach__');
  const [notesTarget, setNotesTarget] = useState<string>('');
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewStatus, setReviewStatus] = useState<SubmissionStatus>('reviewed');

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [p, a, m, s] = await Promise.all([
      supabase.from('participants').select('*').eq('company_id', company.id).order('created_at', { ascending: false }),
      supabase.from('assignments').select('*').eq('company_id', company.id).order('created_at', { ascending: false }),
      supabase.from('meetings').select('*').eq('company_id', company.id).order('scheduled_at', { ascending: true }),
      supabase.from('assignment_submissions').select('*').order('submitted_at', { ascending: false }),
    ]);
    const pData = p.data || [];
    const aData = a.data || [];
    const mData = m.data || [];
    const sData = s.data || [];
    setParticipants(pData);
    setMeetings(mData);
    setSubmissions(sData.map((s) => ({ ...s, files: [], answers: [], participant: undefined, assignment: undefined })));

    // Load recipients, questions, files for each assignment
    const aIds = aData.map((x) => x.id);
    let recipientMap: Record<string, number> = {};
    let questionMap: Record<string, AssignmentQuestion[]> = {};

    if (aIds.length) {
      const [recipients, questions] = await Promise.all([
        supabase.from('assignment_recipients').select('assignment_id, participant_id').in('assignment_id', aIds),
        supabase.from('assignment_questions').select('*').in('assignment_id', aIds).order('order_index', { ascending: true }),
      ]);
      (recipients.data || []).forEach((r) => {
        recipientMap[r.assignment_id] = (recipientMap[r.assignment_id] || 0) + 1;
      });
      (questions.data || []).forEach((q) => {
        questionMap[q.assignment_id] = questionMap[q.assignment_id] || [];
        questionMap[q.assignment_id].push(q);
      });
    }

    const assignmentsWithMeta: AssignmentWithMeta[] = [];
    for (const assignment of aData) {
      const files = await listFiles('assignment-attachments', assignment.id);
      const subs = sData.filter((s) => s.assignment_id === assignment.id);
      const reviewed = subs.filter((s) => s.status !== 'submitted' && s.status !== 'draft').length;
      assignmentsWithMeta.push({
        ...assignment,
        recipientCount: recipientMap[assignment.id] || 0,
        submissionCount: subs.length,
        reviewCount: reviewed,
        files,
        questions: questionMap[assignment.id] || [],
      });
    }
    setAssignments(assignmentsWithMeta);

    // Enrich submissions with participant/assignment info
    setSubmissions((prev) =>
      prev.map((s) => ({
        ...s,
        participant: pData.find((pp) => pp.id === s.participant_id),
        assignment: aData.find((aa) => aa.id === s.assignment_id),
      }))
    );

    setLoading(false);
  }, [company.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Participant handlers
  const openCreateP = () => {
    setEditingP(null);
    setPForm({ full_name: '', email: '', role: 'participant' });
    setPModal(true);
  };
  const openEditP = (p: Participant) => {
    setEditingP(p);
    setPForm({ full_name: p.full_name, email: p.email, role: p.role });
    setPModal(true);
  };
  const saveP = async () => {
    if (!pForm.full_name.trim() || !pForm.email.trim()) return;
    setSaving(true);
    if (editingP) {
      const { error } = await supabase.from('participants').update({
        full_name: pForm.full_name.trim(), email: pForm.email.trim(), role: pForm.role,
      }).eq('id', editingP.id);
      if (error) show(error.message, 'error'); else show('Participant updated.');
    } else {
      const { error } = await supabase.from('participants').insert({
        company_id: company.id, full_name: pForm.full_name.trim(), email: pForm.email.trim().toLowerCase(), role: pForm.role,
      });
      if (error) show(error.message, 'error'); else show('Participant added.');
    }
    setSaving(false); setPModal(false); loadAll();
  };
  const removeP = async (p: Participant) => {
    if (!confirm(`Remove ${p.full_name}?`)) return;
    const { error } = await supabase.from('participants').delete().eq('id', p.id);
    if (error) show('Failed to remove.', 'error'); else { show('Removed.'); loadAll(); }
  };

  // Question builder handlers
  const addQuestion = (type: QuestionType) => {
    setAQuestions((prev) => [
      ...prev,
      { question_type: type, question_text: '', options: type === 'multiple_choice' || type === 'checkboxes' ? [''] : [], required: true, order_index: prev.length },
    ]);
  };
  const updateQuestion = (index: number, updates: Partial<QuestionDraft>) => {
    setAQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...updates } : q)));
  };
  const removeQuestion = (index: number) => {
    setAQuestions((prev) => prev.filter((_, i) => i !== index).map((q, i) => ({ ...q, order_index: i })));
  };
  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    setAQuestions((prev) => {
      const next = [...prev];
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      [next[index], next[newIndex]] = [next[newIndex], next[index]];
      return next.map((q, i) => ({ ...q, order_index: i }));
    });
  };
  const addOption = (qIndex: number) => {
    setAQuestions((prev) => prev.map((q, i) => (i === qIndex ? { ...q, options: [...(q.options || []), ''] } : q)));
  };
  const updateOption = (qIndex: number, oIndex: number, value: string) => {
    setAQuestions((prev) => prev.map((q, i) => (i === qIndex ? { ...q, options: (q.options || []).map((o, j) => (j === oIndex ? value : o)) } : q)));
  };
  const removeOption = (qIndex: number, oIndex: number) => {
    setAQuestions((prev) => prev.map((q, i) => (i === qIndex ? { ...q, options: (q.options || []).filter((_, j) => j !== oIndex) } : q)));
  };

  // Assignment handlers
  const openCreateA = () => {
    setEditingA(null);
    setAForm({ title: '', description: '', due_date: '' });
    setARecipients(new Set());
    setAAll(false);
    setAQuestions([]);
    setAModal(true);
  };
  const openEditA = async (a: AssignmentWithMeta) => {
    setEditingA(a);
    setAForm({ title: a.title, description: a.description, due_date: a.due_date || '' });
    setAModal(true);
    // Load existing recipients and questions
    const [{ data: recData }, { data: qData }] = await Promise.all([
      supabase.from('assignment_recipients').select('participant_id').eq('assignment_id', a.id),
      supabase.from('assignment_questions').select('*').eq('assignment_id', a.id).order('order_index', { ascending: true }),
    ]);
    const ids = new Set((recData || []).map((r) => r.participant_id));
    setARecipients(ids);
    setAAll(ids.size === participants.length && participants.length > 0);
    setAQuestions((qData || []).map((q) => ({ ...q, options: q.options || [] })));
  };
  const toggleRecipient = (id: string) => {
    const next = new Set(aRecipients);
    if (next.has(id)) next.delete(id); else next.add(id);
    setARecipients(next);
    setAAll(next.size === participants.length && participants.length > 0);
  };
  const toggleAll = () => {
    if (aAll) { setARecipients(new Set()); setAAll(false); }
    else { setARecipients(new Set(participants.map((p) => p.id))); setAAll(true); }
  };
  const saveA = async () => {
    if (!aForm.title.trim() || !aForm.description.trim()) return;
    if (aQuestions.some((q) => !q.question_text.trim())) { show('All questions need text.', 'error'); return; }
    setSaving(true);
    const payload = {
      company_id: company.id,
      title: aForm.title.trim(),
      description: aForm.description.trim(),
      due_date: aForm.due_date || null,
    };
    let assignmentId: string;
    if (editingA) {
      const { data, error } = await supabase.from('assignments').update(payload).eq('id', editingA.id).select().maybeSingle();
      if (error) { show(error.message, 'error'); setSaving(false); return; }
      assignmentId = data!.id;
      // Delete old questions, insert new
      await supabase.from('assignment_questions').delete().eq('assignment_id', assignmentId);
      await supabase.from('assignment_recipients').delete().eq('assignment_id', assignmentId);
    } else {
      const { data, error } = await supabase.from('assignments').insert(payload).select().maybeSingle();
      if (error) { show(error.message, 'error'); setSaving(false); return; }
      assignmentId = data!.id;
    }
    // Insert recipients
    const recipientRows = Array.from(aRecipients).map((pid) => ({ assignment_id: assignmentId, participant_id: pid }));
    if (recipientRows.length) {
      await supabase.from('assignment_recipients').insert(recipientRows);
    }
    // Insert questions
    const questionRows = aQuestions.map((q, i) => ({
      assignment_id: assignmentId,
      order_index: i,
      question_type: q.question_type,
      question_text: q.question_text.trim(),
      options: q.options && q.options.length > 0 ? q.options : null,
      required: q.required,
    }));
    if (questionRows.length) {
      await supabase.from('assignment_questions').insert(questionRows);
    }
    // Notify participants (only for new assignments)
    if (!editingA && aRecipients.size > 0) {
      await notifyParticipants(
        Array.from(aRecipients),
        'new_assignment',
        `New assignment: ${aForm.title.trim()}`,
        company.name,
        `company:${company.id}:assignments`
      );
    }
    show(editingA ? 'Assignment updated.' : 'Assignment created.');
    setSaving(false); setAModal(false); loadAll();
  };
  const removeA = async (a: AssignmentWithMeta) => {
    if (!confirm(`Delete "${a.title}"?`)) return;
    const { error } = await supabase.from('assignments').delete().eq('id', a.id);
    if (error) show('Failed to delete.', 'error'); else { show('Deleted.'); loadAll(); }
  };

  // Meeting handlers
  const openCreateM = () => {
    setEditingM(null);
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    setMForm({ title: '', description: '', scheduled_at: now.toISOString().slice(0, 16), duration_minutes: 60, location: '' });
    setMModal(true);
  };
  const openEditM = (m: Meeting) => {
    setEditingM(m);
    setMForm({ title: m.title, description: m.description || '', scheduled_at: m.scheduled_at.slice(0, 16), duration_minutes: m.duration_minutes, location: m.location || '' });
    setMModal(true);
  };
  const saveM = async () => {
    if (!mForm.title.trim() || !mForm.scheduled_at) return;
    setSaving(true);
    const payload = {
      company_id: company.id,
      title: mForm.title.trim(),
      description: mForm.description.trim() || null,
      scheduled_at: new Date(mForm.scheduled_at).toISOString(),
      duration_minutes: mForm.duration_minutes,
      location: mForm.location.trim() || null,
    };
    if (editingM) {
      const { error } = await supabase.from('meetings').update(payload).eq('id', editingM.id);
      if (error) show(error.message, 'error'); else show('Updated.');
    } else {
      const { error } = await supabase.from('meetings').insert(payload);
      if (error) show(error.message, 'error'); else {
        show('Scheduled.');
        const pIds = participants.map((p) => p.id);
        if (pIds.length) {
          await notifyParticipants(pIds, 'meeting_scheduled', `Meeting: ${mForm.title.trim()}`, company.name, `company:${company.id}:meetings`);
        }
      }
    }
    setSaving(false); setMModal(false); loadAll();
  };
  const removeM = async (m: Meeting) => {
    if (!confirm(`Delete "${m.title}"?`)) return;
    const { error } = await supabase.from('meetings').delete().eq('id', m.id);
    if (error) show('Failed.', 'error'); else { show('Deleted.'); loadAll(); }
  };

  // Review submission
  const openReview = async (s: SubmissionWithMeta) => {
    // Load answers and questions for this assignment
    const [answersRes, questionsRes, files] = await Promise.all([
      supabase.from('assignment_answers').select('*').eq('submission_id', s.id),
      supabase.from('assignment_questions').select('*').eq('assignment_id', s.assignment_id).order('order_index', { ascending: true }),
      listFiles('submission-files', s.id),
    ]);

    const questions = (questionsRes.data || []).map((q) => ({ ...q, options: q.options || [] }));
    const answers = answersRes.data || [];

    // Also get the assignment to include its title and questions
    const { data: assignment } = await supabase.from('assignments').select('*').eq('id', s.assignment_id).maybeSingle();

    setReviewModal({
      ...s,
      assignment: assignment || s.assignment,
      answers,
      files,
      questions,
    });
    setReviewFeedback(s.consultant_feedback || '');
    setReviewStatus(s.status === 'approved' ? 'approved' : s.status === 'changes_requested' ? 'changes_requested' : 'reviewed');
  };
  const saveReview = async () => {
    if (!reviewModal) return;
    setSaving(true);
    const { error } = await supabase.from('assignment_submissions').update({
      consultant_feedback: reviewFeedback.trim() || null,
      reviewed_at: new Date().toISOString(),
      status: reviewStatus,
    }).eq('id', reviewModal.id);
    if (error) show(error.message, 'error');
    else {
      show('Review saved.');
      if (reviewModal.participant) {
        await notifyParticipants(
          [reviewModal.participant.id],
          'feedback_received',
          `Feedback on: ${reviewModal.assignment?.title || 'submission'}`,
          reviewStatus === 'approved' ? 'Approved!' : reviewStatus === 'changes_requested' ? 'Changes requested.' : 'Reviewed.',
          `participant:assignments`
        );
      }
    }
    setSaving(false); setReviewModal(null); loadAll();
  };

  ;

  const meetingUrl = (loc: string | null): string | null =>
    (loc && /^https?:\/\//i.test(loc.trim()) ? loc.trim() : null);

  const tabs: { id: Tab; label: string; icon: typeof Users; count: number }[] = [
    { id: 'participants', label: 'Participants', icon: Users, count: participants.length },
    { id: 'assignments', label: 'Assignments', icon: FileText, count: assignments.length },
    { id: 'meetings', label: 'Meetings', icon: Calendar, count: meetings.length },
    { id: 'reviews', label: 'Reviews', icon: CheckCircle2, count: submissions.filter((s) => s.status !== 'submitted' && s.status !== 'draft').length },
    { id: 'media', label: 'Media', icon: FolderOpen, count: participants.length },
    { id: 'forum', label: 'Forum', icon: MessagesSquare, count: 0 },
    { id: 'notes', label: 'Notes', icon: NotebookPen, count: participants.length },
  ];

  const statusBadge = (status: SubmissionStatus) => {
    switch (status) {
      case 'approved': return <span className="badge-green"><CheckCircle2 size={12} /> Approved</span>;
      case 'reviewed': return <span className="badge-brand"><CheckCircle2 size={12} /> Reviewed</span>;
      case 'changes_requested': return <span className="badge-red"><XCircle size={12} /> Changes requested</span>;
      case 'draft': return <span className="badge-gray"><Clock size={12} /> Draft</span>;
      default: return <span className="badge-amber"><Clock size={12} /> Submitted</span>;
    }
  };

  // Stats for company card
  const needsReviewCount = submissions.filter((s) => s.status === 'submitted').length;
  const completeCount = submissions.filter((s) => s.status === 'approved' || s.status === 'reviewed').length;

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft size={16} /> All companies
      </button>

      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{company.name}</h1>
          {company.industry && <p className="text-sm text-ink-500 mt-1">{company.industry}</p>}
          {company.description && <p className="text-sm text-ink-600 mt-2 max-w-2xl">{company.description}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {needsReviewCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-sm font-medium text-amber-700">{needsReviewCount} to review</span>
            </div>
          )}
          {completeCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5">
              <CheckCircle2 size={14} className="text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700">{completeCount} complete</span>
            </div>
          )}
        </div>
      </div>

      {/* To Review section */}
      {needsReviewCount > 0 && tab !== 'assignments' && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-amber-50/0 p-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-amber-600" />
            <h3 className="font-display text-sm font-semibold text-amber-800">To Review ({needsReviewCount})</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {submissions.filter((s) => s.status === 'submitted').slice(0, 6).map((s) => (
              <button
                key={s.id}
                onClick={() => openReview(s)}
                className="flex items-center gap-3 rounded-lg bg-white border border-amber-200 p-3 text-left hover:border-amber-300 hover:bg-amber-50/50 transition-colors"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">{initials(s.participant?.full_name || '?')}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate">{s.participant?.full_name}</div>
                  <div className="text-xs text-ink-500 truncate">{s.assignment?.title}</div>
                </div>
                <MessageSquare size={14} className="text-amber-500 shrink-0" />
              </button>
            ))}
          </div>
          {needsReviewCount > 6 && (
            <button onClick={() => setTab('assignments')} className="mt-2 text-xs font-medium text-amber-700 hover:text-amber-800">
              View all {needsReviewCount} submissions
            </button>
          )}
        </div>
      )}

      <div className="mb-6 flex gap-1 overflow-x-auto scrollbar-thin border-b border-ink-200">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
            <t.icon size={15} /> {t.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === t.id ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card h-64 animate-pulse bg-ink-100/50" />
      ) : (
        <div className="animate-fade-in">
          {/* PARTICIPANTS */}
          {tab === 'participants' && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-ink-500">{participants.length} {participants.length === 1 ? 'person' : 'people'}</p>
                <button onClick={openCreateP} className="btn-primary"><UserPlus size={16} /> Add participant</button>
              </div>
              {participants.length === 0 ? (
                <EmptyState icon={<Users size={24} />} title="No participants" description="Add participants to this company." action={<button onClick={openCreateP} className="btn-primary"><UserPlus size={16} /> Add</button>} />
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full">
                      <thead className="bg-ink-50 border-b border-ink-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase">Name</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase">Email</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase">Role</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase">Status</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-ink-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100">
                        {participants.map((p) => (
                          <tr key={p.id} className="hover:bg-ink-50/50">
                            <td className="px-4 py-3">
                              <button onClick={() => setViewProfile(p)} className="flex items-center gap-3 text-left group">
                                <Avatar name={p.full_name} avatarUrl={p.avatar_url} emoji={p.vibe_emoji} size="xs" onClick={() => setViewProfile(p)} />
                                <span className="text-sm font-medium text-ink-900 group-hover:text-brand-700">{p.full_name}</span>
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm text-ink-600">
                              <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 hover:text-brand-700" title={`Email ${p.full_name}`}>
                                <Mail size={14} className="text-ink-400" /> {p.email}
                              </a>
                            </td>
                            <td className="px-4 py-3"><span className={roleBadgeClass(p.role)}>{p.role}</span></td>
                            <td className="px-4 py-3">{p.user_id ? <span className="badge-green">Active</span> : <span className="badge-amber">Pending</span>}</td>
                            <td className="px-4 py-3 text-right">
                              <button onClick={() => openEditP(p)} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100"><Pencil size={14} /></button>
                              <button onClick={() => removeP(p)} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ASSIGNMENTS */}
          {tab === 'assignments' && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-ink-500">{assignments.length} assignments</p>
                <button onClick={openCreateA} className="btn-primary"><Plus size={16} /> New assignment</button>
              </div>
              {assignments.length === 0 ? (
                <EmptyState icon={<FileText size={24} />} title="No assignments" description="Create assignments for participants." action={<button onClick={openCreateA} className="btn-primary"><Plus size={16} /> New</button>} />
              ) : (
                <div className="space-y-3">
                  {assignments.map((a) => {
                    const subs = submissions.filter((s) => s.assignment_id === a.id);
                    const needsReview = subs.filter((s) => s.status === 'submitted').length;
                    const overdue = isOverdue(a.due_date);
                    return (
                      <div key={a.id} className="card-hover p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-display text-base font-semibold text-ink-900">{a.title}</h3>
                              {overdue && !subs.length && <span className="badge-red">Overdue</span>}
                              {a.due_date && !overdue && <span className="badge-gray">Due {formatRelative(a.due_date)}</span>}
                              {a.questions.length > 0 && <span className="badge-amber"><ListChecks size={10} /> {a.questions.length} questions</span>}
                            </div>
                            <p className="mt-1.5 text-sm text-ink-600 line-clamp-2">{a.description}</p>
                            <div className="mt-3 flex items-center gap-4 text-xs text-ink-500 flex-wrap">
                              <span>{a.recipientCount} recipient{a.recipientCount !== 1 ? 's' : ''}</span>
                              <span className="flex items-center gap-1">
                                <span className={needsReview > 0 ? 'text-amber-600 font-semibold' : ''}>{subs.length}</span> submitted
                              </span>
                              {needsReview > 0 && (
                                <span className="flex items-center gap-1 text-amber-600 font-semibold">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{needsReview} to review
                                </span>
                              )}
                            </div>
                            {a.recipientCount > 0 && (
                              <div className="mt-2 h-1.5 w-full max-w-xs rounded-full bg-ink-100 overflow-hidden">
                                <div className="h-full bg-brand-500" style={{ width: `${a.recipientCount > 0 ? (subs.length / a.recipientCount) * 100 : 0}%` }} />
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openEditA(a)} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100"><Pencil size={14} /></button>
                            <button onClick={() => removeA(a)} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                          </div>
                        </div>
                        {subs.length > 0 && (
                          <div className="mt-4 border-t border-ink-100 pt-3">
                            <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">Submissions</p>
                            <div className="space-y-2">
                              {subs.map((s) => (
                                <div key={s.id} className={`flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-ink-50/50 ${s.status === 'submitted' ? 'border-amber-200 bg-amber-50/30' : 'border-ink-100'}`}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-[10px] font-semibold">{initials(s.participant?.full_name || '?')}</div>
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium text-ink-900 truncate">{s.participant?.full_name}</div>
                                        <div className="text-xs text-ink-400">{formatDate(s.submitted_at)}</div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {statusBadge(s.status)}
                                    <button onClick={() => openReview(s)} className="btn-secondary !py-1.5 !px-3 text-xs"><MessageSquare size={12} /> Review</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* MEETINGS */}
          {tab === 'meetings' && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <button onClick={openCreateM} className="btn-primary"><Plus size={16} /> Schedule</button>
              </div>
              {meetings.length === 0 ? (
                <EmptyState icon={<Calendar size={24} />} title="No meetings" description="Schedule meetings with this company." action={<button onClick={openCreateM} className="btn-primary"><Plus size={16} /> Schedule</button>} />
              ) : (
                <div className="space-y-3">
                  {meetings.map((m) => {
                    const past = new Date(m.scheduled_at).getTime() < Date.now();
                    return (
                      <div key={m.id} className={`card-hover p-5 ${past ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex gap-4">
                            <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg ${past ? 'bg-ink-100 text-ink-500' : 'bg-brand-50 text-brand-700'}`}>
                              <span className="text-[10px] uppercase font-semibold leading-none">{new Date(m.scheduled_at).toLocaleString(undefined, { month: 'short' })}</span>
                              <span className="text-lg font-bold leading-tight">{new Date(m.scheduled_at).getDate()}</span>
                            </div>
                            <div>
                              <h3 className="font-display text-base font-semibold text-ink-900">{m.title}</h3>
                              <p className="mt-0.5 text-sm text-ink-600">{formatDateTime(m.scheduled_at)} · {m.duration_minutes} min{m.location && !meetingUrl(m.location) && ` · ${m.location}`}</p>
                              {m.description && <p className="mt-1.5 text-sm text-ink-500 line-clamp-2">{m.description}</p>}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {meetingUrl(m.location) && !past && (
                              <a href={meetingUrl(m.location)!} target="_blank" rel="noopener noreferrer"
                                className="btn-primary mr-1 whitespace-nowrap inline-flex items-center gap-1.5 px-3 py-1.5 text-sm">
                                <Video size={14} /> Join
                              </a>
                            )}
                            <button onClick={() => openEditM(m)} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100"><Pencil size={14} /></button>
                            <button onClick={() => removeM(m)} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* REVIEWS - Coach's review history */}
          {tab === 'reviews' && (
            <div>
              {submissions.filter((s) => s.status !== 'submitted' && s.status !== 'draft').length === 0 ? (
                <EmptyState icon={<CheckCircle2 size={24} />} title="No reviews yet" description="Reviewed submissions will appear here." />
              ) : (
                <div className="space-y-3">
                  {submissions.filter((s) => s.status !== 'submitted' && s.status !== 'draft').map((s) => {
                    const p = participants.find((pp) => pp.id === s.participant_id);
                    const a = assignments.find((aa) => aa.id === s.assignment_id);
                    return (
                      <div key={s.id} className="card p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-semibold text-ink-500 uppercase">{a?.title}</span>
                              {s.status === 'approved' && <span className="badge-green"><CheckCircle2 size={10} /> Approved</span>}
                              {s.status === 'reviewed' && <span className="badge-brand"><CheckCircle2 size={10} /> Reviewed</span>}
                              {s.status === 'changes_requested' && <span className="badge-red"><XCircle size={10} /> Changes requested</span>}
                            </div>
                            <h4 className="font-display text-sm font-semibold text-ink-900">{p?.full_name}</h4>
                            {s.consultant_feedback && <p className="mt-2 text-sm text-ink-700 bg-ink-50 rounded-lg p-3">{s.consultant_feedback}</p>}
                            <p className="text-xs text-ink-400 mt-2">Reviewed {formatDate(s.reviewed_at || s.submitted_at)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* MEDIA */}
          {tab === 'media' && (
            <div>
              <div className="mb-4">
                <label className="label">Whose media</label>
                <select className="input w-auto min-w-[240px]" value={mediaTarget} onChange={(e) => setMediaTarget(e.target.value)}>
                  <option value="__coach__">My own files</option>
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-ink-500">
                  {mediaTarget === '__coach__'
                    ? 'Files only you can see.'
                    : '1-on-1 files are visible to this person and you. Private files are visible to coaches only.'}
                </p>
              </div>

              <MediaLibrary
                key={mediaTarget}
                companyId={company.id}
                participantId={mediaTarget === '__coach__' ? null : mediaTarget}
                canChoosePrivate={true}
                emptyHint={mediaTarget === '__coach__'
                  ? 'Upload files for your own reference.'
                  : 'Upload documents, images, or video for this person.'}
              />
            </div>
          )}

          {/* FORUM */}
          {tab === 'forum' && (
            <ForumView companyId={company.id} isCoach={true} />
          )}

          {/* SESSION NOTES */}
          {tab === 'notes' && (
            <div>
              <div className="mb-4">
                <label className="label">Whose notes</label>
                <select className="input w-auto min-w-[240px]" value={notesTarget}
                  onChange={(e) => setNotesTarget(e.target.value)}>
                  <option value="">Select a person...</option>
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-ink-500">
                  Your running record for this person. Private to you unless you share a note.
                </p>
              </div>

              {notesTarget ? (
                <SessionNotes key={notesTarget} companyId={company.id} participantId={notesTarget} canEdit={true} />
              ) : (
                <EmptyState icon={<NotebookPen size={22} />} title="Pick a person"
                  description="Choose someone above to see and add their session notes." />
              )}
            </div>
          )}
        </div>
      )}

      {/* Participant Modal */}
      <Modal open={pModal} onClose={() => setPModal(false)} title={editingP ? 'Edit' : 'Add participant'} size="md">
        <div className="space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={pForm.full_name} onChange={(e) => setPForm({ ...pForm, full_name: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" type="email" value={pForm.email} onChange={(e) => setPForm({ ...pForm, email: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Role</label>
            <div className="grid grid-cols-3 gap-2">
              {(['leadership', 'management', 'participant'] as ParticipantRole[]).map((r) => (
                <button key={r} type="button" onClick={() => setPForm({ ...pForm, role: r })} className={`rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-all ${pForm.role === r ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20' : 'border-ink-200 hover:border-ink-300'}`}>{r}</button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setPModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={saveP} disabled={saving || !pForm.full_name.trim() || !pForm.email.trim()} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </Modal>

      {/* Assignment Modal with Form Builder */}
      <Modal open={aModal} onClose={() => setAModal(false)} title={editingA ? 'Edit assignment' : 'New assignment'} size="xl">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="label">Title</label>
              <input className="input" value={aForm.title} onChange={(e) => setAForm({ ...aForm, title: e.target.value })} placeholder="Leadership Assessment" />
            </div>
            <div>
              <label className="label">Due date</label>
              <input type="date" className="input" value={aForm.due_date} onChange={(e) => setAForm({ ...aForm, due_date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input min-h-[80px]" value={aForm.description} onChange={(e) => setAForm({ ...aForm, description: e.target.value })} placeholder="Instructions for participants..." />
          </div>

          {/* Form Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label !mb-0">Questions <span className="text-ink-400 font-normal">(optional)</span></label>
              <div className="flex gap-1">
                <button type="button" onClick={() => addQuestion('short_text')} className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50">+ Short text</button>
                <button type="button" onClick={() => addQuestion('long_text')} className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50">+ Long text</button>
                <button type="button" onClick={() => addQuestion('multiple_choice')} className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50">+ Multiple choice</button>
                <button type="button" onClick={() => addQuestion('checkboxes')} className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50">+ Checkboxes</button>
                <button type="button" onClick={() => addQuestion('file_upload')} className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-50">+ File upload</button>
              </div>
            </div>
            {aQuestions.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-ink-200 py-6 text-center text-sm text-ink-400">
                No questions yet. Add questions above to create a form for participants to fill out.
              </div>
            ) : (
              <div className="space-y-3">
                {aQuestions.map((q, qIndex) => (
                  <div key={qIndex} className="rounded-lg border border-ink-200 bg-ink-50/50 p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex flex-col gap-0.5 pt-1">
                        <button type="button" onClick={() => moveQuestion(qIndex, 'up')} disabled={qIndex === 0} className="rounded p-0.5 text-ink-400 hover:bg-white hover:text-ink-700 disabled:opacity-30"><ChevronUp size={14} /></button>
                        <button type="button" onClick={() => moveQuestion(qIndex, 'down')} disabled={qIndex === aQuestions.length - 1} className="rounded p-0.5 text-ink-400 hover:bg-white hover:text-ink-700 disabled:opacity-30"><ChevronDown size={14} /></button>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <select value={q.question_type} onChange={(e) => updateQuestion(qIndex, { question_type: e.target.value as QuestionType, options: e.target.value === 'multiple_choice' || e.target.value === 'checkboxes' ? [''] : [] })} className="rounded border border-ink-200 bg-white px-2 py-1 text-xs">
                            <option value="short_text">Short text</option>
                            <option value="long_text">Long text</option>
                            <option value="multiple_choice">Multiple choice</option>
                            <option value="checkboxes">Checkboxes</option>
                            <option value="file_upload">File upload</option>
                          </select>
                          <label className="flex items-center gap-1 text-xs text-ink-500">
                            <input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(qIndex, { required: e.target.checked })} className="rounded" />
                            Required
                          </label>
                        </div>
                        <input className="input" value={q.question_text} onChange={(e) => updateQuestion(qIndex, { question_text: e.target.value })} placeholder="Question text..." />
                      </div>
                      <button type="button" onClick={() => removeQuestion(qIndex)} className="rounded p-1 text-ink-400 hover:bg-white hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                    {(q.question_type === 'multiple_choice' || q.question_type === 'checkboxes') && (
                      <div className="ml-7 space-y-1.5">
                        {(q.options || []).map((opt, oIndex) => (
                          <div key={oIndex} className="flex items-center gap-2">
                            <div className={`h-4 w-4 rounded-full border border-ink-300 ${q.question_type === 'checkboxes' ? 'rounded-sm' : 'rounded-full'}`} />
                            <input className="input flex-1" value={opt} onChange={(e) => updateOption(qIndex, oIndex, e.target.value)} placeholder={`Option ${oIndex + 1}`} />
                            <button type="button" onClick={() => removeOption(qIndex, oIndex)} className="text-ink-400 hover:text-red-600"><XCircle size={14} /></button>
                          </div>
                        ))}
                        <button type="button" onClick={() => addOption(qIndex)} className="text-xs text-brand-600 hover:text-brand-700 ml-0.5">+ Add option</button>
                      </div>
                    )}
                    {q.question_type === 'file_upload' && (
                      <div className="ml-7 rounded border border-dashed border-ink-200 p-3 text-center text-xs text-ink-400">Participants will upload a file here</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recipients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label !mb-0">Recipients</label>
              {participants.length > 0 && (
                <button type="button" onClick={toggleAll} className="text-xs font-medium text-brand-600">{aAll ? 'Deselect all' : 'Select all'}</button>
              )}
            </div>
            {participants.length === 0 ? (
              <p className="text-sm text-ink-400 rounded-lg bg-ink-50 p-3">Add participants first.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-1 rounded-lg border border-ink-200 p-2">
                {participants.map((p) => {
                  const selected = aRecipients.has(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => toggleRecipient(p.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${selected ? 'bg-brand-50' : 'hover:bg-ink-50'}`}>
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${selected ? 'border-brand-600 bg-brand-600' : 'border-ink-300'}`}>
                        {selected && <CheckCircle2 size={12} className="text-white" />}
                      </div>
                      <span className="text-sm font-medium text-ink-900">{p.full_name}</span>
                      <span className={roleBadgeClass(p.role)}>{p.role}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setAModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={saveA} disabled={saving || !aForm.title.trim()} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </Modal>

      {/* Meeting Modal */}
      <Modal open={mModal} onClose={() => setMModal(false)} title={editingM ? 'Edit meeting' : 'Schedule meeting'} size="md">
        <div className="space-y-4">
          <div>
            <label className="label">Title</label>
            <input className="input" value={mForm.title} onChange={(e) => setMForm({ ...mForm, title: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date & time</label>
              <input type="datetime-local" className="input" value={mForm.scheduled_at} onChange={(e) => setMForm({ ...mForm, scheduled_at: e.target.value })} />
            </div>
            <div>
              <label className="label">Duration (min)</label>
              <select className="input" value={mForm.duration_minutes} onChange={(e) => setMForm({ ...mForm, duration_minutes: Number(e.target.value) })}>
                <option value={30}>30</option>
                <option value={60}>60</option>
                <option value={90}>90</option>
                <option value={120}>120</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input" value={mForm.location} onChange={(e) => setMForm({ ...mForm, location: e.target.value })} placeholder="Zoom link or room" />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input min-h-[80px]" value={mForm.description} onChange={(e) => setMForm({ ...mForm, description: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setMModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={saveM} disabled={saving || !mForm.title.trim() || !mForm.scheduled_at} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </Modal>

      {/* Review Modal */}
      <Modal open={!!reviewModal} onClose={() => setReviewModal(null)} title="Review submission" size="xl">
        {reviewModal && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-sm font-semibold">{initials(reviewModal.participant?.full_name || '?')}</div>
              <div>
                <div className="text-base font-medium text-ink-900">{reviewModal.participant?.full_name}</div>
                <div className="text-xs text-ink-400">{reviewModal.assignment?.title} · Submitted {formatDate(reviewModal.submitted_at)}</div>
              </div>
            </div>

            {/* Participant's written response */}
            {reviewModal.content && reviewModal.content.trim() && (
              <div>
                <p className="label">Participant's response</p>
                <div className="rounded-lg bg-ink-50 p-4 text-sm text-ink-700 whitespace-pre-wrap">{reviewModal.content}</div>
              </div>
            )}

            {/* Form Questions and Answers */}
            {reviewModal.questions && reviewModal.questions.length > 0 && (
              <div>
                <p className="label">Form responses</p>
                <div className="space-y-3">
                  {reviewModal.questions.map((q, qIndex) => {
                    const answer = reviewModal.answers.find((a) => a.question_id === q.id);
                    return (
                      <div key={q.id} className="rounded-lg border border-ink-200 bg-ink-50/50 p-4">
                        <div className="flex items-start gap-2 mb-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand-100 text-brand-700 text-[10px] font-bold">{qIndex + 1}</span>
                          <p className="text-sm font-medium text-ink-900">{q.question_text}</p>
                        </div>
                        {(() => {
                          if (q.question_type === 'file_upload') {
                            const fileAnswer = reviewModal.answers.find((a) => a.question_id === q.id && a.file_path);
                            if (fileAnswer?.file_path && fileAnswer?.file_name) {
                              return (
                                <div className="ml-7 flex items-center gap-2 rounded-lg bg-white border border-ink-200 p-2">
                                  <Paperclip size={14} className="text-brand-500" />
                                  <a
                                    href="#"
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      const { data } = await supabase.storage.from('portal-files').createSignedUrl(fileAnswer.file_path!, 3600);
                                      if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                                    }}
                                    className="text-sm text-brand-600 hover:text-brand-700 underline"
                                  >
                                    {fileAnswer.file_name}
                                  </a>
                                </div>
                              );
                            }
                            return <p className="ml-7 text-sm text-ink-400 italic">No file uploaded</p>;
                          }
                          if (q.question_type === 'multiple_choice' || q.question_type === 'checkboxes') {
                            const choices = answer?.answer_choices;
                            if (!choices || !Array.isArray(choices) || choices.length === 0) return <p className="ml-7 text-sm text-ink-400 italic">No answer</p>;
                            return (
                              <div className="ml-7 space-y-1">
                                {choices.map((c, i) => (
                                  <div key={i} className="flex items-center gap-2 text-sm text-ink-700">
                                    <CheckCircle2 size={14} className="text-brand-500" />
                                    <span>{c}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          }
                          // short_text or long_text
                          if (!answer?.answer_text?.trim()) return <p className="ml-7 text-sm text-ink-400 italic">No answer</p>;
                          return (
                            <div className="ml-7 rounded bg-white p-2 text-sm text-ink-700">
                              {answer.answer_text}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Submitted files (standalone, not per-question) */}
            {reviewModal.files.length > 0 && (
              <div>
                <p className="label">Uploaded files</p>
                <div className="space-y-2">
                  {reviewModal.files.map((f) => (
                    <div key={f.id || f.path} className="flex items-center gap-2 rounded-lg border border-ink-200 p-3 bg-white">
                      <Paperclip size={16} className="text-ink-400" />
                      <span className="text-sm text-ink-700 flex-1">{f.name}</span>
                      <button
                        onClick={async () => {
                          const { data } = await supabase.storage.from('portal-files').createSignedUrl(f.path, 3600);
                          if (data?.signedUrl) window.open(data.signedUrl, '_blank');
                        }}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Section */}
            <div className="border-t border-ink-100 pt-4">
              <p className="label">Status</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'reviewed', label: 'Reviewed' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'changes_requested', label: 'Request changes' },
                ] as const).map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setReviewStatus(opt.value)} className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${reviewStatus === opt.value ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 hover:border-ink-300'}`}>{opt.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Feedback for participant</label>
              <textarea className="input min-h-[100px]" value={reviewFeedback} onChange={(e) => setReviewFeedback(e.target.value)} placeholder="Write feedback that the participant will see..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setReviewModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={saveReview} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save review'}</button>
            </div>
          </div>
        )}
      </Modal>

      <ProfileModal
        open={!!viewProfile}
        onClose={() => setViewProfile(null)}
        mode="view"
        profile={viewProfile ? {
          name: viewProfile.full_name,
          email: viewProfile.email,
          avatarUrl: viewProfile.avatar_url,
          status: viewProfile.status,
          vibeEmoji: viewProfile.vibe_emoji,
          roleLabel: viewProfile.role,
          companyId: company.id,
          participantId: viewProfile.id,
        } : undefined}
      />
    </div>
  );
}
