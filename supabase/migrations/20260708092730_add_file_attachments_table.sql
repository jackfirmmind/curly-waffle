/*
# File metadata table

Tracks uploaded files so the UI can list and download them per assignment/submission.
Storage objects live in the `portal-files` bucket; this table stores the metadata
(name, storage path, size, owner) and a `folder` key (assignment-attachments or
submission-files) plus a `ref_id` pointing to the assignment or submission.

## New Table
- `file_attachments`
  - `id` (uuid PK)
  - `folder` text: 'assignment-attachments' | 'submission-files'
  - `ref_id` (uuid) — assignment_id or submission_id
  - `file_name` text — original file name
  - `storage_path` text — path in the bucket
  - `file_size` bigint
  - `mime_type` text
  - `owner_id` (uuid FK to auth.users, CASCADE)
  - `created_at` (timestamptz)

## Security
- RLS enabled. Owners can CRUD their own files. Consultants can read files
  in their companies' assignments/submissions. Participants can read files
  in their own submissions and their company's assignments.
*/

CREATE TABLE IF NOT EXISTS file_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder text NOT NULL CHECK (folder IN ('assignment-attachments', 'submission-files')),
  ref_id uuid NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime_type text,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE file_attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fa_folder_ref ON file_attachments(folder, ref_id);
CREATE INDEX IF NOT EXISTS idx_fa_owner ON file_attachments(owner_id);

DROP POLICY IF EXISTS "select_fa" ON file_attachments;
CREATE POLICY "select_fa" ON file_attachments FOR SELECT
  TO authenticated USING (
    owner_id = auth.uid()
    OR (
      folder = 'assignment-attachments'
      AND ref_id IN (
        SELECT a.id FROM assignments a
        WHERE a.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
        OR a.company_id = auth_participant_company_id()
      )
    )
    OR (
      folder = 'submission-files'
      AND (
        ref_id IN (
          SELECT s.id FROM assignment_submissions s
          WHERE s.participant_id = auth_participant_id()
        )
        OR ref_id IN (
          SELECT s.id FROM assignment_submissions s
          JOIN assignments a ON a.id = s.assignment_id
          JOIN companies c ON c.id = a.company_id
          WHERE c.consultant_id = auth_consultant_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS "insert_fa" ON file_attachments;
CREATE POLICY "insert_fa" ON file_attachments FOR INSERT
  TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "delete_fa" ON file_attachments;
CREATE POLICY "delete_fa" ON file_attachments FOR DELETE
  TO authenticated USING (owner_id = auth.uid());
