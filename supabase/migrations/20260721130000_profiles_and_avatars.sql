/*
# Phase 1 — Profiles + Avatars

Adds profile fields to coaches (consultants) and participants, an `avatars`
storage bucket, and the RLS reads needed so people can view each other's
profile within a company (coach <-> participant, and participant <-> co-member).

## Profile fields (both consultants and participants)
- avatar_url : public URL of uploaded profile pic (null = show initials)
- status     : short free-text status line
- vibe_emoji : one chosen "coaching vibe" emoji

## Cross-profile visibility (so clickable avatars work)
- Participants can already read their own row + coaches read their company's
  participants. We ADD: participants can read OTHER participants in the same
  company (co-members) and can read the coach who owns their company.
- All additions use SECURITY DEFINER helpers to avoid the RLS recursion issues
  fixed earlier.

## Avatars bucket
Public-read bucket so avatars render anywhere. Users can only write/replace/
delete files inside their own `{user_id}/...` folder.

Safe to re-run (idempotent).
*/

-- ============================================================
-- 1. Profile columns
-- ============================================================
ALTER TABLE consultants ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE consultants ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE consultants ADD COLUMN IF NOT EXISTS vibe_emoji text;

ALTER TABLE participants ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS vibe_emoji text;

-- ============================================================
-- 2. Helper: the coach (consultant id) that owns the current participant's company
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_participant_coach_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT co.consultant_id
  FROM companies co
  JOIN participants p ON p.company_id = co.id
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;

-- ============================================================
-- 3. Extend participant read: co-members in the same company
-- ============================================================
DROP POLICY IF EXISTS "select_participants" ON participants;
CREATE POLICY "select_participants" ON participants FOR SELECT
  TO authenticated USING (
    id = auth_participant_id()
    OR company_id = auth_participant_company_id()
    OR company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  );

-- ============================================================
-- 4. Let a participant read their coach's profile row
--    (keeps the existing select_own_consultant policy alongside this)
-- ============================================================
DROP POLICY IF EXISTS "select_consultant_for_participant" ON consultants;
CREATE POLICY "select_consultant_for_participant" ON consultants FOR SELECT
  TO authenticated USING (
    id = auth_participant_coach_id()
  );

-- ============================================================
-- 5. Avatars storage bucket (public read)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Public read of avatars
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Users manage only their own folder: avatars/{auth.uid()}/...
DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
