import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Building2, Users, FileText, Calendar, ArrowRight, Clock, CheckCircle2, AlertCircle, MessageSquare, ChevronRight } from 'lucide-react';
import { formatDate, formatDateTime, initials } from '../../lib/format';
import type { Assignment, Meeting, Participant, AssignmentSubmission } from '../../lib/types';

interface Props {
  onNavigate: (view: string) => void;
}

interface SubmissionToReview extends AssignmentSubmission {
  assignment?: Assignment;
  participant?: Participant;
}

interface Stats {
  companies: number;
  participants: number;
  assignments: number;
  meetings: number;
  pendingSubmissions: number;
  needsReview: number;
  complete: number;
  upcomingMeetings: Meeting[];
  recentSubmissions: (AssignmentSubmission & { assignment: Assignment; participant: Participant })[];
  submissionsToReview: SubmissionToReview[];
}

export default function OverviewView({ onNavigate }: Props) {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!user?.consultantId) return;
      const { data: companies } = await supabase.from('companies').select('*').eq('consultant_id', user.consultantId);
      const companyIds = (companies || []).map((c) => c.id);
      if (!companyIds.length) {
        setStats({ companies: 0, participants: 0, assignments: 0, meetings: 0, pendingSubmissions: 0, needsReview: 0, complete: 0, upcomingMeetings: [], recentSubmissions: [], submissionsToReview: [] });
        setLoading(false);
        return;
      }
      const [p, a, m] = await Promise.all([
        supabase.from('participants').select('id', { count: 'exact', head: true }).in('company_id', companyIds),
        supabase.from('assignments').select('*').in('company_id', companyIds).order('created_at', { ascending: false }),
        supabase.from('meetings').select('*').in('company_id', companyIds).order('scheduled_at', { ascending: true }),
      ]);
      const assignmentIds = (a.data || []).map((x) => x.id);
      let subs: AssignmentSubmission[] = [];
      if (assignmentIds.length) {
        const { data } = await supabase.from('assignment_submissions').select('*').in('assignment_id', assignmentIds).order('submitted_at', { ascending: false });
        subs = data || [];
      }
      const { data: participants } = await supabase.from('participants').select('*').in('company_id', companyIds);

      const now = Date.now();
      const upcoming = (m.data || []).filter((mt) => new Date(mt.scheduled_at).getTime() > now).slice(0, 5);
      const recentSubs = subs.slice(0, 5).map((s) => ({
        ...s,
        assignment: (a.data || []).find((x) => x.id === s.assignment_id)!,
        participant: (participants || []).find((x) => x.id === s.participant_id)!,
      })).filter((s) => s.assignment && s.participant);

      // Calculate stats
      const needsReview = subs.filter((s) => s.status === 'submitted').length;
      const complete = subs.filter((s) => s.status === 'approved' || s.status === 'reviewed').length;
      const pending = (a.data || []).reduce((acc, assignment) => {
        const submitted = subs.filter((s) => s.assignment_id === assignment.id).length;
        return acc + ((participants || []).length - submitted);
      }, 0);

      // Get submissions needing review with details
      const needsReviewSubs = subs.filter((s) => s.status === 'submitted');
      const submissionsToReview: SubmissionToReview[] = needsReviewSubs.slice(0, 10).map((s) => ({
        ...s,
        assignment: (a.data || []).find((x) => x.id === s.assignment_id),
        participant: (participants || []).find((x) => x.id === s.participant_id),
      }));

      setStats({
        companies: companies?.length || 0,
        participants: p.count || 0,
        assignments: a.data?.length || 0,
        meetings: m.data?.length || 0,
        pendingSubmissions: pending,
        needsReview,
        complete,
        upcomingMeetings: upcoming,
        recentSubmissions: recentSubs,
        submissionsToReview,
      });
      setLoading(false);
    })();
  }, [user?.consultantId]);

  if (loading || !stats) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="card h-28 animate-pulse bg-ink-100/50" />)}</div>;
  }

  const cards = [
    { label: 'Companies', value: stats.companies, complete: stats.companies, incomplete: 0, icon: Building2, color: 'bg-brand-50 text-brand-600', view: 'companies' },
    { label: 'Participants', value: stats.participants, complete: stats.participants, incomplete: 0, icon: Users, color: 'bg-emerald-50 text-emerald-600', view: 'companies' },
    { label: 'Assignments', value: stats.assignments, complete: stats.complete, incomplete: stats.needsReview + stats.pendingSubmissions, icon: FileText, color: 'bg-amber-50 text-amber-600', view: 'companies' },
    { label: 'Upcoming meetings', value: stats.upcomingMeetings.length, complete: stats.upcomingMeetings.length, incomplete: 0, icon: Calendar, color: 'bg-violet-50 text-violet-600', view: 'companies' },
  ];

  return (
    <div className="space-y-6">
      {/* To Review - prominent at top */}
      {stats.needsReview > 0 && (
        <div className="rounded-xl bg-gradient-to-r from-amber-50 via-amber-50/50 to-transparent border border-amber-200 p-5 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <AlertCircle size={18} />
              </div>
              <div>
                <h3 className="font-display text-base font-semibold text-amber-900">To Review</h3>
                <p className="text-xs text-amber-700">{stats.needsReview} submission{stats.needsReview !== 1 ? 's' : ''} awaiting your feedback</p>
              </div>
            </div>
            <button onClick={() => onNavigate('companies')} className="text-xs font-medium text-amber-700 hover:text-amber-800 flex items-center gap-1">
              View all <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.submissionsToReview.slice(0, 6).map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  if (s.assignment) {
                    const assignment = s.assignment as any;
                    const companyId = assignment.company_id;
                    onNavigate(`company:${companyId}:assignments`);
                  }
                }}
                className="flex items-center gap-3 rounded-lg bg-white border border-amber-200 p-3 text-left hover:border-amber-300 hover:bg-amber-50/50 transition-colors"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                  {initials(s.participant?.full_name || '?')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate">{s.participant?.full_name || 'Unknown'}</div>
                  <div className="text-xs text-ink-500 truncate">{s.assignment?.title || 'Assignment'}</div>
                </div>
                <MessageSquare size={14} className="text-amber-500 shrink-0" />
              </button>
            ))}
          </div>
          {stats.needsReview > 6 && (
            <p className="text-xs text-ink-400 mt-2">+{stats.needsReview - 6} more</p>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <button
            key={c.label}
            onClick={() => onNavigate(c.view)}
            className="card-hover p-5 text-left animate-fade-in"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-center justify-between">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.color}`}>
                <c.icon size={18} />
              </div>
              <ArrowRight size={16} className="text-ink-300" />
            </div>
            <div className="mt-3 text-3xl font-display font-bold text-ink-900">{c.value}</div>
            <div className="text-sm text-ink-500">{c.label}</div>
            {(c.incomplete !== undefined && c.incomplete > 0) && (
              <div className="mt-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-xs text-ink-400">{c.incomplete} incomplete</span>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Upcoming meetings and recent submissions */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5 animate-fade-in">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-ink-900 flex items-center gap-2">
              <Clock size={16} className="text-brand-500" /> Upcoming meetings
            </h3>
          </div>
          {stats.upcomingMeetings.length === 0 ? (
            <p className="text-sm text-ink-400 py-6 text-center">No upcoming meetings.</p>
          ) : (
            <div className="space-y-3">
              {stats.upcomingMeetings.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border border-ink-100 p-3 hover:bg-ink-50/50 transition-colors">
                  <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <span className="text-[9px] uppercase font-semibold leading-none">{new Date(m.scheduled_at).toLocaleString(undefined, { month: 'short' })}</span>
                    <span className="text-sm font-bold leading-tight">{new Date(m.scheduled_at).getDate()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-900 truncate">{m.title}</div>
                    <div className="text-xs text-ink-500">{formatDateTime(m.scheduled_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5 animate-fade-in">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-ink-900 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-500" /> Recent submissions
            </h3>
          </div>
          {stats.recentSubmissions.length === 0 ? (
            <p className="text-sm text-ink-400 py-6 text-center">No submissions yet.</p>
          ) : (
            <div className="space-y-3">
              {stats.recentSubmissions.map((s) => (
                <div key={s.id} className="flex items-start gap-3 rounded-lg border border-ink-100 p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <CheckCircle2 size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-900 truncate">{s.participant.full_name}</div>
                    <div className="text-xs text-ink-500 truncate">{s.assignment.title}</div>
                    <div className="text-[11px] text-ink-400 mt-0.5">{formatDate(s.submitted_at)}</div>
                  </div>
                  {s.status === 'submitted' && (
                    <span className="badge-amber"><Clock size={10} /> Needs review</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Outstanding Banner */}
      {stats.pendingSubmissions > 0 && stats.needsReview === 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle size={18} className="text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{stats.pendingSubmissions}</span> assignment{stats.pendingSubmissions === 1 ? '' : 's'} awaiting submission.
          </p>
        </div>
      )}
    </div>
  );
}
