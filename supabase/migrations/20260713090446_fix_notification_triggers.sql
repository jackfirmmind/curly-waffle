/*
# Fix Notification Triggers for Assignment-Sent and Submission-Received

## Problem
The `notifyConsultant` and `notifyParticipants` helper functions in the frontend
perform client-side SELECTs on RLS-protected tables (`consultants` and `participants`)
to resolve user IDs before calling the `notify_users` RPC.

- When a coach sends a new assignment, `notifyParticipants` does a SELECT on the
  `participants` table. The coach's RLS policy allows reading participants in their
  own companies, so this CAN work — but only if the participants belong to the
  coach's companies. However, the lookup also filters on `user_id IS NOT NULL`,
  and if any participant row is inaccessible due to RLS edge cases, the lookup
  returns empty and the notification silently never fires.

- When a participant submits an assignment, `notifyConsultant` does a SELECT on the
  `consultants` table to find the coach's `user_id`. But RLS on `consultants` only
  allows `auth.uid() = user_id` — a participant CANNOT read any consultant row.
  The SELECT returns null, `notifyConsultant` returns early, and the coach never
  gets notified. This is the root cause of the submission-received notification bug.

## Fix
Replace the two-step client pattern (SELECT user_id, then RPC notify_users) with
two new SECURITY DEFINER RPC functions that do everything server-side:

1. `notify_participants_by_id(p_participant_ids uuid[], p_type text, p_title text, p_body text, p_link text)`
   - Looks up `user_id` for each participant ID directly in the `participants` table
     (bypassing RLS because SECURITY DEFINER).
   - Inserts notifications for all non-null user_ids.
   - Called by the coach's frontend when sending a new assignment.

2. `notify_consultant_by_company(p_company_id uuid, p_type text, p_title text, p_body text, p_link text)`
   - Looks up the `consultant_id` from the `companies` table, then the `user_id`
     from the `consultants` table (all bypassing RLS).
   - Inserts a notification for the coach.
   - Called by the participant's frontend when submitting an assignment.
   - This avoids the participant needing to know or look up the consultant_id —
     they just pass their company_id, which they already have.

Both functions are SECURITY DEFINER with `SET search_path = public` so they bypass
RLS and can resolve user IDs across tables without exposing data to the client.

The existing `notify_users` RPC is kept for backward compatibility (feedback
notifications still use it successfully from the coach side).

## Security
- No table or column changes.
- No existing data affected.
- The new functions only INSERT into the notifications table (which is already
  allowed via the SECURITY DEFINER pattern used by notify_users).
- Functions do not expose any user data to the caller — they only insert
  notification rows.
*/

-- ============================================================
-- notify_participants_by_id: Resolve participant user_ids and notify them
-- SECURITY DEFINER so the calling coach doesn't need SELECT access to participants
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_participants_by_id(
  p_participant_ids uuid[],
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_link text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO notifications (user_id, type, title, body, link)
  SELECT p.user_id, p_type, p_title, p_body, p_link
  FROM unnest(p_participant_ids) AS pid
  JOIN participants p ON p.id = pid
  WHERE p.user_id IS NOT NULL;
$$;

-- ============================================================
-- notify_consultant_by_company: Resolve coach user_id from company and notify
-- SECURITY DEFINER so the calling participant doesn't need SELECT access to consultants
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_consultant_by_company(
  p_company_id uuid,
  p_type text,
  p_title text,
  p_body text DEFAULT NULL,
  p_link text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO notifications (user_id, type, title, body, link)
  SELECT c.user_id, p_type, p_title, p_body, p_link
  FROM companies comp
  JOIN consultants c ON c.id = comp.consultant_id
  WHERE comp.id = p_company_id AND c.user_id IS NOT NULL;
$$;