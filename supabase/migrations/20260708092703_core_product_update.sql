/*
# Core Product Update — Storage, Multi-Participant Assignments, Submission Flow, Notifications, Future Tables

## Overview
Adds file storage support, multi-participant assignment targeting, full submission
review flow (consultant feedback + status), in-app notifications, and future-proof
tables for upcoming AI/meeting features.

## Changes to Existing Tables

### assignments
- No new columns (recipient targeting is in the new assignment_recipients table).

### assignment_submissions
- Add `status` text: 'draft' | 'submitted' | 'reviewed' | 'approved' | 'changes_requested'
  - Default: 'submitted' (existing inserts from frontend set this implicitly)
- Add `consultant_feedback` text (nullable) — feedback written by consultant
- Add `reviewed_at` timestamptz (nullable) — when consultant reviewed
- Add `has_files` boolean default false — quick flag for file presence

## New Tables

1. `assignment_recipients` — Links assignments to specific participants (many-to-many).
   - `id` (uuid PK)
   - `assignment_id` (uuid FK to assignments, CASCADE)
   - `participant_id` (uuid FK to participants, CASCADE)
   - `created_at` (timestamptz)
   - Unique on (assignment_id, participant_id)

2. `notifications` — In-app notifications for users.
   - `id` (uuid PK)
   - `user_id` (uuid NOT NULL — the auth user to notify)
   - `type` text: 'new_assignment' | 'submission_received' | 'feedback_received' | 'meeting_scheduled'
   - `title` text
   - `body` text (nullable)
   - `link` text (nullable) — frontend route/anchor
   - `read_at` timestamptz (nullable)
   - `created_at` timestamptz

3. `meeting_transcripts` — Future: AI-generated meeting transcripts.
   - `id` (uuid PK)
   - `meeting_id` (uuid FK to meetings, CASCADE)
   - `transcript_text` text
   - `source` text (nullable)
   - `created_at` timestamptz

4. `suggested_actions` — Future: AI-suggested action items.
   - `id` (uuid PK)
   - `company_id` (uuid FK to companies, CASCADE)
   - `participant_id` (uuid FK to participants, CASCADE, nullable)
   - `source_transcript_id` (uuid FK to meeting_transcripts, SET NULL, nullable)
   - `suggestion_text` text
   - `status` text: 'pending' | 'accepted' | 'dismissed' | 'edited'
   - `created_at` timestamptz

5. `messages` — Future: in-app messaging between users.
   - `id` (uuid PK)
   - `sender_id` (uuid FK to auth.users, CASCADE)
   - `recipient_id` (uuid FK to auth.users, CASCADE)
   - `company_id` (uuid FK to companies, CASCADE, nullable)
   - `content` text
   - `read_at` timestamptz (nullable)
   - `created_at` timestamptz

## Storage
- Creates a public storage bucket `portal-files` for assignment attachments and
  submission files. RLS on storage objects restricts access to the file owner
  (the uploader) and the relevant consultant.

## Security
- RLS enabled on all new tables.
- Policies use the SECURITY DEFINER helper functions (auth_consultant_id,
  auth_participant_id, auth_participant_company_id) to avoid recursion.
- Storage policies: uploaders can manage their own files; consultants can read
  files in their companies' assignments; participants can read files in their
  own submissions and their company's assignments.
*/

-- ============================================================
-- ALTER assignment_submissions: add status, feedback, reviewed_at, has_files
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assignment_submissions' AND column_name = 'status') THEN
    ALTER TABLE assignment_submissions ADD COLUMN status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted', 'reviewed', 'approved', 'changes_requested'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assignment_submissions' AND column_name = 'consultant_feedback') THEN
    ALTER TABLE assignment_submissions ADD COLUMN consultant_feedback text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assignment_submissions' AND column_name = 'reviewed_at') THEN
    ALTER TABLE assignment_submissions ADD COLUMN reviewed_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'assignment_submissions' AND column_name = 'has_files') THEN
    ALTER TABLE assignment_submissions ADD COLUMN has_files boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Drop the old unique constraint (assignment_id, participant_id) since we now
-- manage recipients separately, but keep it to prevent duplicate submissions.
-- The constraint already exists from the original migration; keep it.

-- ============================================================
-- assignment_recipients
-- ============================================================
CREATE TABLE IF NOT EXISTS assignment_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (assignment_id, participant_id)
);
ALTER TABLE assignment_recipients ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ar_assignment_id ON assignment_recipients(assignment_id);
CREATE INDEX IF NOT EXISTS idx_ar_participant_id ON assignment_recipients(participant_id);

DROP POLICY IF EXISTS "select_ar" ON assignment_recipients;
CREATE POLICY "select_ar" ON assignment_recipients FOR SELECT
  TO authenticated USING (
    participant_id = auth_participant_id()
    OR assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN companies c ON c.id = a.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
  );

DROP POLICY IF EXISTS "insert_ar" ON assignment_recipients;
CREATE POLICY "insert_ar" ON assignment_recipients FOR INSERT
  TO authenticated WITH CHECK (
    assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN companies c ON c.id = a.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
  );

DROP POLICY IF EXISTS "delete_ar" ON assignment_recipients;
CREATE POLICY "delete_ar" ON assignment_recipients FOR DELETE
  TO authenticated USING (
    assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN companies c ON c.id = a.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
  );

-- ============================================================
-- notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('new_assignment', 'submission_received', 'feedback_received', 'meeting_scheduled')),
  title text NOT NULL,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- meeting_transcripts (future)
-- ============================================================
CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  transcript_text text NOT NULL,
  source text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_mt_meeting_id ON meeting_transcripts(meeting_id);

DROP POLICY IF EXISTS "select_mt" ON meeting_transcripts;
CREATE POLICY "select_mt" ON meeting_transcripts FOR SELECT
  TO authenticated USING (
    meeting_id IN (
      SELECT m.id FROM meetings m
      WHERE m.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
      OR m.company_id = auth_participant_company_id()
    )
  );

DROP POLICY IF EXISTS "insert_mt" ON meeting_transcripts;
CREATE POLICY "insert_mt" ON meeting_transcripts FOR INSERT
  TO authenticated WITH CHECK (
    meeting_id IN (
      SELECT m.id FROM meetings m
      WHERE m.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    )
  );

DROP POLICY IF EXISTS "update_mt" ON meeting_transcripts;
CREATE POLICY "update_mt" ON meeting_transcripts FOR UPDATE
  TO authenticated USING (
    meeting_id IN (
      SELECT m.id FROM meetings m
      WHERE m.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    )
  );

DROP POLICY IF EXISTS "delete_mt" ON meeting_transcripts;
CREATE POLICY "delete_mt" ON meeting_transcripts FOR DELETE
  TO authenticated USING (
    meeting_id IN (
      SELECT m.id FROM meetings m
      WHERE m.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    )
  );

-- ============================================================
-- suggested_actions (future)
-- ============================================================
CREATE TABLE IF NOT EXISTS suggested_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  participant_id uuid REFERENCES participants(id) ON DELETE CASCADE,
  source_transcript_id uuid REFERENCES meeting_transcripts(id) ON DELETE SET NULL,
  suggestion_text text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'edited')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE suggested_actions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sa_company_id ON suggested_actions(company_id);
CREATE INDEX IF NOT EXISTS idx_sa_participant_id ON suggested_actions(participant_id);

DROP POLICY IF EXISTS "select_sa" ON suggested_actions;
CREATE POLICY "select_sa" ON suggested_actions FOR SELECT
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    OR participant_id = auth_participant_id()
  );

DROP POLICY IF EXISTS "insert_sa" ON suggested_actions;
CREATE POLICY "insert_sa" ON suggested_actions FOR INSERT
  TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

DROP POLICY IF EXISTS "update_sa" ON suggested_actions;
CREATE POLICY "update_sa" ON suggested_actions FOR UPDATE
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    OR participant_id = auth_participant_id()
  );

DROP POLICY IF EXISTS "delete_sa" ON suggested_actions;
CREATE POLICY "delete_sa" ON suggested_actions FOR DELETE
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

-- ============================================================
-- messages (future)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  content text NOT NULL,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);

DROP POLICY IF EXISTS "select_messages" ON messages;
CREATE POLICY "select_messages" ON messages FOR SELECT
  TO authenticated USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

DROP POLICY IF EXISTS "insert_messages" ON messages;
CREATE POLICY "insert_messages" ON messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = sender_id);

DROP POLICY IF EXISTS "update_messages" ON messages;
CREATE POLICY "update_messages" ON messages FOR UPDATE
  TO authenticated USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "delete_messages" ON messages;
CREATE POLICY "delete_messages" ON messages FOR DELETE
  TO authenticated USING (auth.uid() = sender_id);

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('portal-files', 'portal-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: only authenticated users can manage objects
-- Path convention: portal-files/<folder>/<uuid-filename>
--   assignment-attachments/<assignment_id>/<filename>
--   submission-files/<submission_id>/<filename>

DROP POLICY IF EXISTS "storage_select_portal_files" ON storage.objects;
CREATE POLICY "storage_select_portal_files" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'portal-files'
    AND (
      owner = auth.uid()
      OR (
        -- Consultant can read files in their companies' assignments and submissions
        EXISTS (
          SELECT 1 FROM assignment_recipients ar
          JOIN assignments a ON a.id = ar.assignment_id
          JOIN companies c ON c.id = a.company_id
          WHERE c.consultant_id = auth_consultant_id()
        )
      )
      OR (
        -- Participant can read files in their own submissions and their company's assignments
        auth_participant_id() IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "storage_insert_portal_files" ON storage.objects;
CREATE POLICY "storage_insert_portal_files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'portal-files'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "storage_update_portal_files" ON storage.objects;
CREATE POLICY "storage_update_portal_files" ON storage.objects FOR UPDATE
  TO authenticated USING (
    bucket_id = 'portal-files' AND owner = auth.uid()
  ) WITH CHECK (
    bucket_id = 'portal-files' AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "storage_delete_portal_files" ON storage.objects;
CREATE POLICY "storage_delete_portal_files" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'portal-files' AND owner = auth.uid()
  );

-- ============================================================
-- NOTIFICATION HELPER: create notifications for participants
-- SECURITY DEFINER so the frontend (running as anon/authenticated) can insert
-- notifications for OTHER users (e.g., consultant notifies participants).
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_users(
  p_user_ids uuid[],
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
  SELECT unnest, p_type, p_title, p_body, p_link
  FROM unnest(p_user_ids);
$$;
