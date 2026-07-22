/*
# Phase 2 — Media Library

Per-person media storage with privacy control.

## Table: media_items
Each row is one uploaded file attached to a person's profile.

- company_id     : the company this media belongs to
- participant_id : whose profile the file sits on. NULL = the coach's own files.
- uploaded_by    : auth.users id of whoever uploaded it
- visibility     : 'one_on_one' | 'private'

## Visibility rules
- 'one_on_one' (default): the participant it belongs to + the coach who owns
  the company. Nobody else — not other participants, not other coaches.
- 'private': the owning coach ONLY. The participant cannot see it.
  Only coaches may set this; participants are restricted to 'one_on_one'
  both in the UI and by the insert policy below.

## Who can upload
- Participants: only to their own profile, and only 'one_on_one'.
- Coaches: to any participant in their own companies (either visibility),
  or to themselves (participant_id NULL).

## Storage
Private bucket `media`. Object access is gated by can_access_media_path(),
a SECURITY DEFINER helper that applies the exact same rules as the table —
so a signed URL can't leak a file the user isn't allowed to see.

Safe to re-run (idempotent).
*/

-- ============================================================
-- 1. Table
-- ============================================================
CREATE TABLE IF NOT EXISTS media_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text,
  visibility text NOT NULL DEFAULT 'one_on_one'
    CHECK (visibility IN ('one_on_one', 'private')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_media_company ON media_items(company_id);
CREATE INDEX IF NOT EXISTS idx_media_participant ON media_items(participant_id);
CREATE INDEX IF NOT EXISTS idx_media_uploader ON media_items(uploaded_by);

-- ============================================================
-- 2. RLS policies
-- ============================================================

-- SELECT: participant sees own one_on_one files; coach sees everything in
-- companies they own (including private).
DROP POLICY IF EXISTS "select_media" ON media_items;
CREATE POLICY "select_media" ON media_items FOR SELECT
  TO authenticated USING (
    (participant_id = auth_participant_id() AND visibility = 'one_on_one')
    OR company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  );

-- INSERT: coach into own company (any visibility); participant only onto
-- their own profile and only as one_on_one.
DROP POLICY IF EXISTS "insert_media" ON media_items;
CREATE POLICY "insert_media" ON media_items FOR INSERT
  TO authenticated WITH CHECK (
    (
      company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    )
    OR (
      participant_id = auth_participant_id()
      AND company_id = auth_participant_company_id()
      AND visibility = 'one_on_one'
    )
  );

-- UPDATE (e.g. changing visibility): coach on own company only.
DROP POLICY IF EXISTS "update_media" ON media_items;
CREATE POLICY "update_media" ON media_items FOR UPDATE
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  ) WITH CHECK (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

-- DELETE: coach on own company, or the uploader removing their own file.
DROP POLICY IF EXISTS "delete_media" ON media_items;
CREATE POLICY "delete_media" ON media_items FOR DELETE
  TO authenticated USING (
    uploaded_by = auth.uid()
    OR company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  );

-- ============================================================
-- 3. Storage bucket + access helper
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', false)
ON CONFLICT (id) DO NOTHING;

-- Mirrors the SELECT policy above, for storage objects.
CREATE OR REPLACE FUNCTION public.can_access_media_path(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM media_items m
    WHERE m.storage_path = p_path
      AND (
        (m.participant_id = auth_participant_id() AND m.visibility = 'one_on_one')
        OR m.company_id IN (
          SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_media_path(text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_access_media_path(text) TO anon, authenticated;

DROP POLICY IF EXISTS "media_select" ON storage.objects;
CREATE POLICY "media_select" ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'media' AND can_access_media_path(name));

-- Any authenticated user may upload into the bucket; the media_items INSERT
-- policy is what actually constrains where a file can be attached.
DROP POLICY IF EXISTS "media_insert" ON storage.objects;
CREATE POLICY "media_insert" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'media');

DROP POLICY IF EXISTS "media_delete" ON storage.objects;
CREATE POLICY "media_delete" ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'media' AND (owner = auth.uid() OR can_access_media_path(name)));
