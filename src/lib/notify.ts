import { supabase } from './supabase';

export async function notifyParticipants(
  participantIds: string[],
  type: 'new_assignment' | 'feedback_received' | 'meeting_scheduled',
  title: string,
  body?: string,
  link?: string
) {
  if (participantIds.length === 0) return;

  await supabase.rpc('notify_participants_by_id', {
    p_participant_ids: participantIds,
    p_type: type,
    p_title: title,
    p_body: body || null,
    p_link: link || null,
  });
}

export async function notifyCoach(
  companyId: string,
  type: 'submission_received',
  title: string,
  body?: string,
  link?: string
) {
  await supabase.rpc('notify_consultant_by_company', {
    p_company_id: companyId,
    p_type: type,
    p_title: title,
    p_body: body || null,
    p_link: link || null,
  });
}
