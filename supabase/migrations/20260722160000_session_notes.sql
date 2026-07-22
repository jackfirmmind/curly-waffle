/*
# Phase 4 — Session Notes

The coach's running record per client: what was discussed, what was agreed,
what happens next. Replaces "notes saved in a folder on my PC" — the whole
history for a person sits in one place, newest first.

## Table: session_notes
- participant_id          : whose record this note belongs to
- session_date            : the date of the session (not the typing date)
- title                   : optional short label, e.g. "Session 4 — delegation"
- body                    : the note itself (paste an AI meeting summary
                            straight in, or type it)
- shared_with_participant : FALSE by default — notes are the coach's private
                            record. Flip to TRUE to let that person read it.

## Permissions
- Coach of the company: full control (create, edit, delete, share).
- Participant: can read a note ONLY if shared_with_participant is true.
  They can never write or edit.

Safe to re-run (idempotent).
*/

CREATE TABLE IF NOT EXISTS session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  title text,
  body text NOT NULL,
  shared_with_participant boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE session_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_session_notes_participant
  ON session_notes(participant_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_session_notes_company
  ON session_notes(company_id);

-- Coach sees all their own companies' notes; participant sees only shared ones.
DROP POLICY IF EXISTS "select_session_notes" ON session_notes;
CREATE POLICY "select_session_notes" ON session_notes FOR SELECT
  TO authenticated USING (
    is_company_coach(company_id)
    OR (participant_id = auth_participant_id() AND shared_with_participant = true)
  );

-- Only the coach writes.
DROP POLICY IF EXISTS "insert_session_notes" ON session_notes;
CREATE POLICY "insert_session_notes" ON session_notes FOR INSERT
  TO authenticated WITH CHECK (
    is_company_coach(company_id) AND author_id = auth.uid()
  );

DROP POLICY IF EXISTS "update_session_notes" ON session_notes;
CREATE POLICY "update_session_notes" ON session_notes FOR UPDATE
  TO authenticated USING (is_company_coach(company_id))
  WITH CHECK (is_company_coach(company_id));

DROP POLICY IF EXISTS "delete_session_notes" ON session_notes;
CREATE POLICY "delete_session_notes" ON session_notes FOR DELETE
  TO authenticated USING (is_company_coach(company_id));

-- Keep updated_at honest
CREATE OR REPLACE FUNCTION public.touch_session_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_session_note_update ON session_notes;
CREATE TRIGGER on_session_note_update
  BEFORE UPDATE ON session_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_session_note();
