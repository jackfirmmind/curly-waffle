/*
# Form-Based Assignments

## Overview
Adds structured question/answer support to assignments so consultants can build
forms with multiple question types (short text, long text, multiple choice,
checkboxes, file upload). Participants fill out the form as part of their
submission.

## New Tables

1. `assignment_questions`
   - `id` (uuid PK)
   - `assignment_id` (uuid FK to assignments, CASCADE)
   - `order_index` (int) — position in form (0-based)
   - `question_type` (text): 'short_text' | 'long_text' | 'multiple_choice' | 'checkboxes' | 'file_upload'
   - `question_text` (text) — the prompt/question
   - `options` (jsonb) — array of strings for multiple_choice/checkboxes options
   - `required` (boolean) default true
   - `created_at` (timestamptz)

2. `assignment_answers`
   - `id` (uuid PK)
   - `submission_id` (uuid FK to assignment_submissions, CASCADE)
   - `question_id` (uuid FK to assignment_questions, CASCADE)
   - `answer_text` (text) — for short_text/long_text
   - `answer_choices` (jsonb) — array of strings for multiple_choice/checkboxes
   - `file_path` (text) — storage path for file_upload
   - `file_name` (text) — original filename
   - `created_at` (timestamptz)

## Security
- RLS enabled on both tables.
- Consultant manages questions for their companies' assignments.
- Participant reads questions and writes answers for their submissions.
*/

-- ============================================================
-- assignment_questions
-- ============================================================
CREATE TABLE IF NOT EXISTS assignment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  question_type text NOT NULL CHECK (question_type IN ('short_text', 'long_text', 'multiple_choice', 'checkboxes', 'file_upload')),
  question_text text NOT NULL,
  options jsonb,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE assignment_questions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_aq_assignment ON assignment_questions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_aq_order ON assignment_questions(assignment_id, order_index);

DROP POLICY IF EXISTS "select_aq" ON assignment_questions;
CREATE POLICY "select_aq" ON assignment_questions FOR SELECT
  TO authenticated USING (
    assignment_id IN (
      SELECT a.id FROM assignments a
      WHERE a.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
      OR a.company_id = auth_participant_company_id()
    )
  );

DROP POLICY IF EXISTS "insert_aq" ON assignment_questions;
CREATE POLICY "insert_aq" ON assignment_questions FOR INSERT
  TO authenticated WITH CHECK (
    assignment_id IN (
      SELECT a.id FROM assignments a
      WHERE a.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    )
  );

DROP POLICY IF EXISTS "update_aq" ON assignment_questions;
CREATE POLICY "update_aq" ON assignment_questions FOR UPDATE
  TO authenticated USING (
    assignment_id IN (
      SELECT a.id FROM assignments a
      WHERE a.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    )
  );

DROP POLICY IF EXISTS "delete_aq" ON assignment_questions;
CREATE POLICY "delete_aq" ON assignment_questions FOR DELETE
  TO authenticated USING (
    assignment_id IN (
      SELECT a.id FROM assignments a
      WHERE a.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    )
  );

-- ============================================================
-- assignment_answers
-- ============================================================
CREATE TABLE IF NOT EXISTS assignment_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES assignment_submissions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
  answer_text text,
  answer_choices jsonb,
  file_path text,
  file_name text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (submission_id, question_id)
);
ALTER TABLE assignment_answers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_aa_submission ON assignment_answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_aa_question ON assignment_answers(question_id);

DROP POLICY IF EXISTS "select_aa" ON assignment_answers;
CREATE POLICY "select_aa" ON assignment_answers FOR SELECT
  TO authenticated USING (
    submission_id IN (
      SELECT s.id FROM assignment_submissions s
      WHERE s.participant_id = auth_participant_id()
      OR s.assignment_id IN (
        SELECT a.id FROM assignments a
        WHERE a.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
      )
    )
  );

DROP POLICY IF EXISTS "insert_aa" ON assignment_answers;
CREATE POLICY "insert_aa" ON assignment_answers FOR INSERT
  TO authenticated WITH CHECK (
    submission_id IN (
      SELECT s.id FROM assignment_submissions s
      WHERE s.participant_id = auth_participant_id()
    )
  );

DROP POLICY IF EXISTS "update_aa" ON assignment_answers;
CREATE POLICY "update_aa" ON assignment_answers FOR UPDATE
  TO authenticated USING (
    submission_id IN (
      SELECT s.id FROM assignment_submissions s
      WHERE s.participant_id = auth_participant_id()
    )
  );

DROP POLICY IF EXISTS "delete_aa" ON assignment_answers;
CREATE POLICY "delete_aa" ON assignment_answers FOR DELETE
  TO authenticated USING (
    submission_id IN (
      SELECT s.id FROM assignment_submissions s
      WHERE s.participant_id = auth_participant_id()
    )
  );
