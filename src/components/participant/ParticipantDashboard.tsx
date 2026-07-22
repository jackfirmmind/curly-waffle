import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { useToast } from '../ui/Toast';
import Modal from '../ui/Modal';
import EmptyState from '../ui/EmptyState';
import FileUpload from '../ui/FileUpload';
import { listFiles, deleteFileMetadata, uploadFile, type StoredFile } from '../../lib/storage';
import { notifyCoach } from '../../lib/notify';
import { FileText, Calendar, CheckCircle2, Clock, Building2, MapPin, MessageSquare, Paperclip, XCircle, AlertCircle, ListChecks, Video, FolderOpen, MessagesSquare, NotebookPen } from 'lucide-react';
import MediaLibrary from '../ui/MediaLibrary';
import ForumView from '../ui/ForumView';
import SessionNotes from '../ui/SessionNotes';
import type { Company, Assignment, Meeting, AssignmentSubmission, Participant, SubmissionStatus, AssignmentQuestion, AssignmentAnswer } from '../../lib/types';
import { formatDate, formatDateTime, formatRelative, isOverdue, roleBadgeClass } from '../../lib/format';

interface QuestionWithAnswer extends AssignmentQuestion {
  answer?: AssignmentAnswer;
}

interface AssignmentWithFiles extends Assignment {
  files: StoredFile[];
  questions: QuestionWithAnswer[];
  isRecipient: boolean;
}

export default function ParticipantDashboard() {
  const { user } = useAuth();
  const { show } = useToast();
  const [company, setCompany] = useState<Company | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [assignments, setAssignments] = useState<AssignmentWithFiles[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'assignments' | 'meetings' | 'media' | 'forum' | 'notes'>('assignments');

  const [submitModal, setSubmitModal] = useState<AssignmentWithFiles | null>(null);
  const [submitText, setSubmitText] = useState('');
  const [submitFiles, setSubmitFiles] = useState<StoredFile[]>([]);
  const [existingSubmission, setExistingSubmission] = useState<AssignmentSubmission | null>(null);
  const [formAnswers, setFormAnswers] = useState<Record<string, { text?: string; choices?: string[]; file?: File }>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.participantId) { setLoading(false); return; }
    const { data: p } = await supabase.from('participants').select('*').eq('id', user.participantId).maybeSingle();
    if (!p) { setLoading(false); return; }
    setParticipant(p);
    const { data: comp } = await supabase.from('companies').select('*').eq('id', p.company_id).maybeSingle();
    setCompany(comp);

    // Get assignments this participant is a recipient of
    const { data: recipientLinks } = await supabase.from('assignment_recipients').select('assignment_id').eq('participant_id', p.id);
    const assignmentIds = (recipientLinks || []).map((r) => r.assignment_id);

    let assignmentData: Assignment[] = [];
    if (assignmentIds.length) {
      const { data: aData } = await supabase.from('assignments').select('*').in('id', assignmentIds).order('created_at', { ascending: false });
      assignmentData = aData || [];
    }

    // Load questions for each assignment
    const assignmentsWithFiles: AssignmentWithFiles[] = [];
    for (const a of assignmentData) {
      const [files, questions] = await Promise.all([
        listFiles('assignment-attachments', a.id),
        supabase.from('assignment_questions').select('*').eq('assignment_id', a.id).order('order_index', { ascending: true }),
      ]);
      assignmentsWithFiles.push({
        ...a,
        files,
        questions: (questions.data || []).map((q) => ({ ...q, options: q.options || [] })),
        isRecipient: true,
      });
    }
    setAssignments(assignmentsWithFiles);

    const [m, s] = await Promise.all([
      supabase.from('meetings').select('*').eq('company_id', p.company_id).order('scheduled_at', { ascending: true }),
      supabase.from('assignment_submissions').select('*').eq('participant_id', p.id),
    ]);
    setMeetings(m.data || []);
    setSubmissions(s.data || []);
    setLoading(false);
  }, [user?.participantId]);

  useEffect(() => { load(); }, [load]);

  const openSubmit = async (a: AssignmentWithFiles) => {
    const existing = submissions.find((s) => s.assignment_id === a.id);
    setExistingSubmission(existing || null);
    setSubmitText(existing?.content || '');
    setSubmitModal(a);
    if (existing) {
      const files = await listFiles('submission-files', existing.id);
      setSubmitFiles(files);
      // Load existing answers
      const { data: answers } = await supabase.from('assignment_answers').select('*').eq('submission_id', existing.id);
      const answerMap: Record<string, { text?: string; choices?: string[] }> = {};
      (answers || []).forEach((ans) => {
        answerMap[ans.question_id] = {
          text: ans.answer_text || undefined,
          choices: (ans.answer_choices as string[]) || undefined,
        };
      });
      setFormAnswers(answerMap);
    } else {
      setSubmitFiles([]);
      setFormAnswers({});
    }
  };

  const updateFormAnswer = (questionId: string, field: 'text' | 'choices' | 'file', value: string | string[] | File) => {
    setFormAnswers((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], [field]: value },
    }));
  };

  const toggleChoice = (questionId: string, choice: string, isCheckbox: boolean) => {
    setFormAnswers((prev) => {
      const current = prev[questionId]?.choices || [];
      if (isCheckbox) {
        const next = current.includes(choice) ? current.filter((c) => c !== choice) : [...current, choice];
        return { ...prev, [questionId]: { ...prev[questionId], choices: next } };
      } else {
        return { ...prev, [questionId]: { ...prev[questionId], choices: [choice] } };
      }
    });
  };

  const saveSubmission = async () => {
    if (!submitModal || !user?.participantId) return;
    if (!submitText.trim() && submitModal.questions.length === 0) {
      show('Please write a response.', 'error');
      return;
    }
    // Validate required questions
    const missingRequired = submitModal.questions.filter((q) => q.required).some((q) => {
      const ans = formAnswers[q.id];
      if (q.question_type === 'file_upload') return !ans?.file && !(existingSubmission?.id && submitFiles.length > 0);
      if (q.question_type === 'multiple_choice' || q.question_type === 'checkboxes') return !ans?.choices?.length;
      return !ans?.text?.trim();
    });
    if (missingRequired) {
      show('Please answer all required questions.', 'error');
      return;
    }

    setSaving(true);
    let submissionId: string;

    if (existingSubmission) {
      const { data, error } = await supabase.from('assignment_submissions').update({
        content: submitText.trim(),
        submitted_at: new Date().toISOString(),
        status: 'submitted',
      }).eq('id', existingSubmission.id).select().maybeSingle();
      if (error) { show(error.message, 'error'); setSaving(false); return; }
      submissionId = data!.id;
    } else {
      const { data, error } = await supabase.from('assignment_submissions').insert({
        assignment_id: submitModal.id,
        participant_id: user.participantId,
        content: submitText.trim(),
        status: 'submitted',
        has_files: false,
      }).select().maybeSingle();
      if (error) { show(error.message, 'error'); setSaving(false); return; }
      submissionId = data!.id;
    }

    // Save form answers
    for (const q of submitModal.questions) {
      const ans = formAnswers[q.id];
      if (!ans) continue;

      // Handle file upload questions
      if (q.question_type === 'file_upload' && ans.file) {
        const result = await uploadFile('submission-files', user.id, ans.file, submissionId);
        if (result) {
          await supabase.from('assignment_answers').upsert({
            submission_id: submissionId,
            question_id: q.id,
            file_path: result.path,
            file_name: result.name,
          }, { onConflict: 'submission_id,question_id' });
        }
      } else {
        await supabase.from('assignment_answers').upsert({
          submission_id: submissionId,
          question_id: q.id,
          answer_text: ans.text || null,
          answer_choices: ans.choices || null,
        }, { onConflict: 'submission_id,question_id' });
      }
    }

    // Update has_files flag
    const currentFiles = await listFiles('submission-files', submissionId);
    await supabase.from('assignment_submissions').update({ has_files: currentFiles.length > 0 }).eq('id', submissionId);

    // Notify coach
    if (company && !existingSubmission) {
      await notifyCoach(company.id, 'submission_received', `New submission: ${submitModal.title}`, participant?.full_name, `company:${company.id}:assignments`);
    }

    show('Assignment submitted!');
    setSaving(false);
    setSubmitModal(null);
    load();
  };

  const handleFileDelete = async (fileId: string, path: string) => {
    const ok = await deleteFileMetadata(fileId, path);
    if (ok) {
      show('Deleted.');
      if (submitModal && existingSubmission) {
        const files = await listFiles('submission-files', existingSubmission.id);
        setSubmitFiles(files);
      }
      load();
    } else show('Failed.', 'error');
  };

  if (loading) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="card h-40 animate-pulse bg-ink-100/50" />)}</div>;
  }

  if (!company || !participant) {
    return (
      <EmptyState
        icon={<Building2 size={24} />}
        title="You're not currently linked to any company"
        description="If you think this is a mistake, please reach out to your coach."
      />
    );
  }

  const upcomingMeetings = meetings.filter((m) => new Date(m.scheduled_at).getTime() > Date.now());
  const pastMeetings = meetings.filter((m) => new Date(m.scheduled_at).getTime() <= Date.now());
  const meetingUrl = (loc: string | null): string | null => (loc && /^https?:\/\//i.test(loc.trim()) ? loc.trim() : null);

  // Calculate due/overdue tasks and completed
  const pendingAssignments = assignments.filter((a) => !submissions.some((s) => s.assignment_id === a.id));
  const overdueAssignments = pendingAssignments.filter((a) => isOverdue(a.due_date));
  const completedSubmissions = submissions.filter((s) => s.status === 'approved' || s.status === 'reviewed');
  const changesRequested = submissions.filter((s) => s.status === 'changes_requested');
  const submissionsWithNewFeedback = submissions.filter((s) => s.consultant_feedback && (s.status === 'approved' || s.status === 'reviewed'));

  const statusBadge = (status: SubmissionStatus) => {
    switch (status) {
      case 'approved': return <span className="badge-green"><CheckCircle2 size={12} /> Approved</span>;
      case 'reviewed': return <span className="badge-brand"><CheckCircle2 size={12} /> Reviewed</span>;
      case 'changes_requested': return <span className="badge-red"><XCircle size={12} /> Changes requested</span>;
      default: return <span className="badge-amber"><Clock size={12} /> Submitted</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Due Tasks Alert */}
      {(overdueAssignments.length > 0 || pendingAssignments.length > 0 || changesRequested.length > 0 || submissionsWithNewFeedback.length > 0) && (
        <div className="rounded-xl border bg-gradient-to-r from-amber-50 to-transparent border-amber-200 p-4 animate-fade-in">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-amber-600" />
            <h3 className="font-display text-sm font-semibold text-amber-800">Due Tasks</h3>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {overdueAssignments.slice(0, 3).map((a) => (
              <button key={a.id} onClick={() => openSubmit(a)} className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-left hover:border-red-300 transition-colors">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 text-xs font-bold">!</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-red-900 truncate">{a.title}</div>
                  <div className="text-xs text-red-600">Overdue</div>
                </div>
              </button>
            ))}
            {changesRequested.slice(0, 3).map((s) => {
              const a = assignments.find((aa) => aa.id === s.assignment_id);
              return (
                <button key={s.id} onClick={() => a && openSubmit(a)} className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-left hover:border-orange-300 transition-colors">
                  <XCircle size={16} className="text-orange-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-orange-900 truncate">{a?.title}</div>
                    <div className="text-xs text-orange-600">Changes requested</div>
                  </div>
                </button>
              );
            })}
            {pendingAssignments.filter((a) => !overdueAssignments.includes(a)).slice(0, 3).map((a) => (
              <button key={a.id} onClick={() => openSubmit(a)} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left hover:border-amber-300 transition-colors">
                <FileText size={16} className="text-amber-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate">{a.title}</div>
                  <div className="text-xs text-ink-500">{a.due_date ? `Due ${formatRelative(a.due_date)}` : 'Pending'}</div>
                </div>
              </button>
            ))}
            {submissionsWithNewFeedback.slice(0, 2).map((s) => {
              const a = assignments.find((aa) => aa.id === s.assignment_id);
              return (
                <button key={s.id} onClick={() => a && openSubmit(a)} className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-left hover:border-brand-300 transition-colors">
                  <MessageSquare size={16} className="text-brand-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-900 truncate">{a?.title}</div>
                    <div className="text-xs text-brand-600">New feedback</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Company banner */}
      <div className="card overflow-hidden animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Building2 size={26} /></div>
            <div>
              <div className="text-xs text-ink-400 uppercase tracking-wide font-semibold">Your company</div>
              <h2 className="font-display text-xl font-bold text-ink-900">{company.name}</h2>
              {company.industry && <p className="text-sm text-ink-500">{company.industry}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-ink-400">You are</div>
              <div className="text-sm font-semibold text-ink-900">{participant.full_name}</div>
              <span className={roleBadgeClass(participant.role)}>{participant.role}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><FileText size={18} /></div>
            <div><div className="text-2xl font-display font-bold text-ink-900">{assignments.length}</div><div className="text-xs text-ink-500">Total assignments</div></div>
          </div>
        </div>
        <div className="card p-5 animate-fade-in" style={{ animationDelay: '50ms' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 size={18} /></div>
            <div><div className="text-2xl font-display font-bold text-ink-900">{completedSubmissions.length}</div><div className="text-xs text-ink-500">Complete</div></div>
          </div>
        </div>
        <div className="card p-5 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${changesRequested.length > 0 ? 'bg-orange-50 text-orange-600' : 'bg-ink-100 text-ink-400'}`}>
              <XCircle size={18} />
            </div>
            <div><div className="text-2xl font-display font-bold text-ink-900">{changesRequested.length}</div><div className="text-xs text-ink-500">Needs revision</div></div>
          </div>
        </div>
        <div className="card p-5 animate-fade-in" style={{ animationDelay: '150ms' }}>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${pendingAssignments.length > 0 ? 'bg-amber-50 text-amber-600' : 'bg-ink-100 text-ink-400'}`}>
              <Clock size={18} />
            </div>
            <div><div className="text-2xl font-display font-bold text-ink-900">{pendingAssignments.length}</div><div className="text-xs text-ink-500">Pending</div></div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto scrollbar-thin border-b border-ink-200">
        <button onClick={() => setTab('assignments')} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === 'assignments' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
          <FileText size={15} /> Assignments
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === 'assignments' ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500'}`}>{assignments.length}</span>
        </button>
        <button onClick={() => setTab('meetings')} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === 'meetings' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
          <Calendar size={15} /> Meetings
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tab === 'meetings' ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500'}`}>{meetings.length}</span>
        </button>
        <button onClick={() => setTab('media')} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === 'media' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
          <FolderOpen size={15} /> Media
        </button>
        <button onClick={() => setTab('forum')} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === 'forum' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
          <MessagesSquare size={15} /> Forum
        </button>
        <button onClick={() => setTab('notes')} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === 'notes' ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
          <NotebookPen size={15} /> Notes
        </button>
      </div>

      {/* ASSIGNMENTS */}
      {tab === 'assignments' && (
      <div className="animate-fade-in">
        {assignments.length === 0 ? (
          <EmptyState icon={<FileText size={24} />} title="No assignments" description="Your coach hasn't assigned you any tasks yet." />
        ) : (
          <div className="space-y-3">
            {assignments.map((a) => {
              const sub = submissions.find((s) => s.assignment_id === a.id);
              const overdue = isOverdue(a.due_date) && !sub;
              const hasQuestions = a.questions.length > 0;
              const hasCoachFeedback = sub?.consultant_feedback && sub.status !== 'submitted' && sub.status !== 'draft';
              return (
                <div key={a.id} className={`card-hover p-5 ${overdue ? 'border-red-200 bg-red-50/30' : ''}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-base font-semibold text-ink-900">{a.title}</h3>
                        {sub ? statusBadge(sub.status) : overdue ? <span className="badge-red">Overdue</span> : a.due_date ? <span className="badge-amber">Due {formatRelative(a.due_date)}</span> : <span className="badge-gray">No due date</span>}
                        {hasQuestions && <span className="badge-amber"><ListChecks size={10} /> {a.questions.length} questions</span>}
                      </div>
                      <p className="mt-1.5 text-sm text-ink-600">{a.description}</p>
                      {a.files.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-1.5 flex items-center gap-1"><Paperclip size={11} /> Files</p>
                          <FileUpload folder="assignment-attachments" refId={a.id} ownerId={user!.id} files={a.files} onUploaded={load} compact />
                        </div>
                      )}
                      {sub && (
                        <div className="mt-3 rounded-lg bg-ink-50/50 border border-ink-200 p-3">
                          <p className="text-xs font-semibold text-ink-600 uppercase mb-1">Your submission</p>
                          <p className="text-sm text-ink-700 whitespace-pre-wrap">{sub.content || 'No text response.'}</p>
                          <p className="text-xs text-ink-400 mt-1.5">Submitted {formatDate(sub.submitted_at)}</p>
                        </div>
                      )}
                      {/* Coach feedback section */}
                      {hasCoachFeedback && (
                        <div className="mt-2 rounded-lg bg-brand-50 border border-brand-200 p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageSquare size={14} className="text-brand-600" />
                            <p className="text-xs font-semibold text-brand-700 uppercase">Feedback from your coach</p>
                          </div>
                          <div className="mb-2">
                            {sub.status === 'approved' && <span className="text-sm font-semibold text-emerald-700"><CheckCircle2 size={14} className="inline mr-1" /> Approved</span>}
                            {sub.status === 'reviewed' && <span className="text-sm font-semibold text-brand-700"><CheckCircle2 size={14} className="inline mr-1" /> Reviewed</span>}
                            {sub.status === 'changes_requested' && <span className="text-sm font-semibold text-red-700"><XCircle size={14} className="inline mr-1" /> Changes requested</span>}
                          </div>
                          {sub.consultant_feedback && (
                            <p className="text-sm text-ink-700 whitespace-pre-wrap bg-white/50 rounded p-2">{sub.consultant_feedback}</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button onClick={() => openSubmit(a)} className="btn-primary whitespace-nowrap">{sub ? 'Edit' : 'Submit'}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      )}

      {/* MEETINGS */}
      {tab === 'meetings' && (
      <div className="animate-fade-in space-y-6 pt-4 border-t border-ink-200">
        <h3 className="font-display text-base font-semibold text-ink-900">Upcoming Meetings</h3>
        {upcomingMeetings.length === 0 ? (
          <p className="text-sm text-ink-400 py-4">No upcoming meetings.</p>
        ) : (
          <div className="space-y-3">
            {upcomingMeetings.map((m) => (
              <div key={m.id} className="card-hover p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <span className="text-[10px] uppercase font-semibold leading-none">{new Date(m.scheduled_at).toLocaleString(undefined, { month: 'short' })}</span>
                      <span className="text-lg font-bold leading-tight">{new Date(m.scheduled_at).getDate()}</span>
                    </div>
                    <div>
                      <h4 className="font-display text-base font-semibold text-ink-900">{m.title}</h4>
                      <p className="mt-0.5 text-sm text-ink-600">{formatDateTime(m.scheduled_at)} · {m.duration_minutes} min</p>
                      {m.location && !meetingUrl(m.location) && <p className="mt-1 text-xs text-ink-500 flex items-center gap-1"><MapPin size={12} /> {m.location}</p>}
                    </div>
                  </div>
                  {meetingUrl(m.location) && (
                    <a href={meetingUrl(m.location)!} target="_blank" rel="noopener noreferrer" className="btn-primary shrink-0 whitespace-nowrap inline-flex items-center gap-1.5">
                      <Video size={15} /> Join
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {pastMeetings.length > 0 && (
          <div>
            <h3 className="mb-3 font-display text-sm font-semibold text-ink-500 uppercase">Past</h3>
            <div className="space-y-3">
              {pastMeetings.map((m) => (
                <div key={m.id} className="card p-5 opacity-60">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                        <span className="text-[10px] uppercase font-semibold leading-none">{new Date(m.scheduled_at).toLocaleString(undefined, { month: 'short' })}</span>
                        <span className="text-lg font-bold leading-tight">{new Date(m.scheduled_at).getDate()}</span>
                      </div>
                      <div>
                        <h4 className="font-display text-base font-semibold text-ink-900">{m.title}</h4>
                        <p className="mt-0.5 text-sm text-ink-500">{formatDateTime(m.scheduled_at)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* MEDIA */}
      {tab === 'media' && company && participant && (
        <div className="animate-fade-in">
          <MediaLibrary
            companyId={company.id}
            participantId={participant.id}
            canChoosePrivate={false}
            emptyHint="Upload your own files here, or see what your coach has shared with you."
          />
        </div>
      )}

      {/* FORUM */}
      {tab === 'forum' && company && (
        <div className="animate-fade-in">
          <ForumView companyId={company.id} isCoach={false} />
        </div>
      )}

      {/* SESSION NOTES (shared only) */}
      {tab === 'notes' && company && participant && (
        <div className="animate-fade-in">
          <SessionNotes companyId={company.id} participantId={participant.id} canEdit={false} />
        </div>
      )}

      {/* Submit Modal with Form */}
      <Modal open={!!submitModal} onClose={() => setSubmitModal(null)} title={submitModal ? (existingSubmission ? 'Edit submission' : 'Complete assignment') : ''} description={submitModal?.title} size="xl">
        {submitModal && (
          <div className="space-y-5">
            {submitModal.description && <div className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600">{submitModal.description}</div>}
            {submitModal.files.length > 0 && (
              <div>
                <p className="label">Attachment files</p>
                <FileUpload folder="assignment-attachments" refId={submitModal.id} ownerId={user!.id} files={submitModal.files} onUploaded={load} compact />
              </div>
            )}

            {/* Form Questions */}
            {submitModal.questions.length > 0 && (
              <div>
                <p className="label">Questions</p>
                <div className="space-y-4">
                  {submitModal.questions.map((q) => {
                    const ans = formAnswers[q.id];
                    return (
                      <div key={q.id} className="rounded-lg border border-ink-200 bg-ink-50/50 p-4">
                        <div className="flex items-start gap-2 mb-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink-200 text-ink-600 text-[10px] font-bold">{q.order_index + 1}</span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-ink-900">{q.question_text}{q.required && <span className="text-red-500 ml-1">*</span>}</p>
                          </div>
                        </div>
                        {q.question_type === 'short_text' && (
                          <input className="input" placeholder="Your answer" value={ans?.text || ''} onChange={(e) => updateFormAnswer(q.id, 'text', e.target.value)} />
                        )}
                        {q.question_type === 'long_text' && (
                          <textarea className="input min-h-[80px] resize-y" placeholder="Your answer" value={ans?.text || ''} onChange={(e) => updateFormAnswer(q.id, 'text', e.target.value)} />
                        )}
                        {(q.question_type === 'multiple_choice' || q.question_type === 'checkboxes') && (
                          <div className="space-y-2">
                            {(q.options || []).map((opt, oi) => {
                              const selected = ans?.choices?.includes(opt);
                              return (
                                <label key={oi} className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type={q.question_type === 'multiple_choice' ? 'radio' : 'checkbox'}
                                    name={`q-${q.id}`}
                                    checked={selected}
                                    onChange={() => toggleChoice(q.id, opt, q.question_type === 'checkboxes')}
                                    className="rounded border-ink-300"
                                  />
                                  <span className="text-sm text-ink-700">{opt}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {q.question_type === 'file_upload' && (
                          <div>
                            {ans?.file ? (
                              <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 p-2">
                                <Paperclip size={14} className="text-brand-600" />
                                <span className="text-sm text-ink-700">{ans.file.name}</span>
                                <button type="button" onClick={() => updateFormAnswer(q.id, 'file', undefined as any)} className="ml-auto text-ink-400 hover:text-red-600"><XCircle size={14} /></button>
                              </div>
                            ) : (
                              <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-200 p-4 cursor-pointer hover:border-ink-300">
                                <Paperclip size={16} className="text-ink-400" />
                                <span className="text-sm text-ink-500">Upload file</span>
                                <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && updateFormAnswer(q.id, 'file', e.target.files[0])} />
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="label">Additional notes <span className="text-ink-400 font-normal">(optional)</span></label>
              <textarea className="input min-h-[80px] resize-y" value={submitText} onChange={(e) => setSubmitText(e.target.value)} placeholder="Any additional comments or context..." />
            </div>

            {existingSubmission && submitFiles.length > 0 && (
              <div>
                <label className="label">Your uploaded files</label>
                <FileUpload folder="submission-files" refId={existingSubmission.id} ownerId={user!.id} files={submitFiles} onUploaded={async () => { const files = await listFiles('submission-files', existingSubmission.id); setSubmitFiles(files); }} onDelete={handleFileDelete} canDelete />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSubmitModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={saveSubmission} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Submit'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
