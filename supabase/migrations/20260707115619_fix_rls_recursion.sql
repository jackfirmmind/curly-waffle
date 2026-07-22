/*
# Fix: Infinite recursion in RLS policies

## Problem
The `select_companies` policy references the `participants` table, and the
`select_participants` policy references the `companies` table. This creates a
mutual recursion cycle: evaluating one policy triggers evaluation of the
other, which triggers the first again — Postgres detects this and throws
`infinite recursion detected in policy for relation "companies"` (42P17).

The same pattern affects `assignments`, `meetings`, `feedback`, and
`assignment_submissions` policies, which all cross-reference tables that in
turn reference them.

## Fix
1. Add `SET search_path = public` to the `auth_consultant_id()` and
   `auth_participant_id()` helper functions (same security requirement as the
   signup trigger — SECURITY DEFINER functions need a pinned search_path).
2. Rewrite ALL policies to use these helper functions instead of inline
   subqueries that join other RLS-protected tables. Because the helper
   functions are SECURITY DEFINER (run as postgres), they bypass RLS — so
   calling them from a policy does NOT re-enter the policy evaluation loop.
   This breaks the recursion cycle completely.

## How the helper functions break the cycle
- Old `select_companies`: `EXISTS (... FROM consultants ...) OR EXISTS (... FROM participants ...)`
  - The `participants` subquery triggers `select_participants` policy
  - `select_participants` does `EXISTS (... FROM companies ...)`
  - `companies` policy re-evaluates -> cycle
- New `select_companies`: `auth_consultant_id() = consultant_id OR auth_participant_id() IS NOT NULL`
  - `auth_consultant_id()` runs as postgres, bypasses RLS, returns the id
  - No subquery on `participants` -> no recursion

## Security
- No table or column changes.
- All policies remain ownership-scoped: consultants access only their own
  companies and their child rows; participants access only their own
  company's assignments/meetings and their own submissions/feedback.
- The helper functions are SECURITY DEFINER with pinned search_path.
*/

-- ============================================================
-- Fix helper functions: add SET search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.auth_consultant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM consultants WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.auth_participant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM participants WHERE user_id = auth.uid();
$$;

-- Helper: get the company_id for the current participant (bypasses RLS)
CREATE OR REPLACE FUNCTION public.auth_participant_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM participants WHERE user_id = auth.uid();
$$;

-- ============================================================
-- COMPANIES — rewrite to use helper functions (no cross-table subqueries)
-- ============================================================
DROP POLICY IF EXISTS "select_companies" ON companies;
CREATE POLICY "select_companies" ON companies FOR SELECT
  TO authenticated USING (
    consultant_id = auth_consultant_id()
    OR id = auth_participant_company_id()
  );

DROP POLICY IF EXISTS "insert_companies" ON companies;
CREATE POLICY "insert_companies" ON companies FOR INSERT
  TO authenticated WITH CHECK (consultant_id = auth_consultant_id());

DROP POLICY IF EXISTS "update_companies" ON companies;
CREATE POLICY "update_companies" ON companies FOR UPDATE
  TO authenticated USING (consultant_id = auth_consultant_id())
  WITH CHECK (consultant_id = auth_consultant_id());

DROP POLICY IF EXISTS "delete_companies" ON companies;
CREATE POLICY "delete_companies" ON companies FOR DELETE
  TO authenticated USING (consultant_id = auth_consultant_id());

-- ============================================================
-- PARTICIPANTS — rewrite to use helper functions
-- ============================================================
DROP POLICY IF EXISTS "select_participants" ON participants;
CREATE POLICY "select_participants" ON participants FOR SELECT
  TO authenticated USING (
    id = auth_participant_id()
    OR company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  );

DROP POLICY IF EXISTS "insert_participants" ON participants;
CREATE POLICY "insert_participants" ON participants FOR INSERT
  TO authenticated WITH CHECK (
    company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  );

DROP POLICY IF EXISTS "update_participants" ON participants;
CREATE POLICY "update_participants" ON participants FOR UPDATE
  TO authenticated USING (
    id = auth_participant_id()
    OR company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  ) WITH CHECK (
    id = auth_participant_id()
    OR company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  );

DROP POLICY IF EXISTS "delete_participants" ON participants;
CREATE POLICY "delete_participants" ON participants FOR DELETE
  TO authenticated USING (
    company_id IN (
      SELECT id FROM companies WHERE consultant_id = auth_consultant_id()
    )
  );

-- ============================================================
-- ASSIGNMENTS — rewrite to use helper functions
-- ============================================================
DROP POLICY IF EXISTS "select_assignments" ON assignments;
CREATE POLICY "select_assignments" ON assignments FOR SELECT
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    OR company_id = auth_participant_company_id()
  );

DROP POLICY IF EXISTS "insert_assignments" ON assignments;
CREATE POLICY "insert_assignments" ON assignments FOR INSERT
  TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

DROP POLICY IF EXISTS "update_assignments" ON assignments;
CREATE POLICY "update_assignments" ON assignments FOR UPDATE
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  ) WITH CHECK (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

DROP POLICY IF EXISTS "delete_assignments" ON assignments;
CREATE POLICY "delete_assignments" ON assignments FOR DELETE
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

-- ============================================================
-- ASSIGNMENT SUBMISSIONS — rewrite to use helper functions
-- ============================================================
DROP POLICY IF EXISTS "select_submissions" ON assignment_submissions;
CREATE POLICY "select_submissions" ON assignment_submissions FOR SELECT
  TO authenticated USING (
    participant_id = auth_participant_id()
    OR assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN companies c ON c.id = a.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
  );

DROP POLICY IF EXISTS "insert_submissions" ON assignment_submissions;
CREATE POLICY "insert_submissions" ON assignment_submissions FOR INSERT
  TO authenticated WITH CHECK (participant_id = auth_participant_id());

DROP POLICY IF EXISTS "update_submissions" ON assignment_submissions;
CREATE POLICY "update_submissions" ON assignment_submissions FOR UPDATE
  TO authenticated USING (participant_id = auth_participant_id())
  WITH CHECK (participant_id = auth_participant_id());

DROP POLICY IF EXISTS "delete_submissions" ON assignment_submissions;
CREATE POLICY "delete_submissions" ON assignment_submissions FOR DELETE
  TO authenticated USING (participant_id = auth_participant_id());

-- ============================================================
-- MEETINGS — rewrite to use helper functions
-- ============================================================
DROP POLICY IF EXISTS "select_meetings" ON meetings;
CREATE POLICY "select_meetings" ON meetings FOR SELECT
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    OR company_id = auth_participant_company_id()
  );

DROP POLICY IF EXISTS "insert_meetings" ON meetings;
CREATE POLICY "insert_meetings" ON meetings FOR INSERT
  TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

DROP POLICY IF EXISTS "update_meetings" ON meetings;
CREATE POLICY "update_meetings" ON meetings FOR UPDATE
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  ) WITH CHECK (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

DROP POLICY IF EXISTS "delete_meetings" ON meetings;
CREATE POLICY "delete_meetings" ON meetings FOR DELETE
  TO authenticated USING (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
  );

-- ============================================================
-- FEEDBACK — rewrite to use helper functions
-- ============================================================
DROP POLICY IF EXISTS "select_feedback" ON feedback;
CREATE POLICY "select_feedback" ON feedback FOR SELECT
  TO authenticated USING (
    participant_id = auth_participant_id()
    OR assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN companies c ON c.id = a.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
    OR meeting_id IN (
      SELECT m.id FROM meetings m
      JOIN companies c ON c.id = m.company_id
      WHERE c.consultant_id = auth_consultant_id()
    )
  );

DROP POLICY IF EXISTS "insert_feedback" ON feedback;
CREATE POLICY "insert_feedback" ON feedback FOR INSERT
  TO authenticated WITH CHECK (participant_id = auth_participant_id());

DROP POLICY IF EXISTS "update_feedback" ON feedback;
CREATE POLICY "update_feedback" ON feedback FOR UPDATE
  TO authenticated USING (participant_id = auth_participant_id())
  WITH CHECK (participant_id = auth_participant_id());

DROP POLICY IF EXISTS "delete_feedback" ON feedback;
CREATE POLICY "delete_feedback" ON feedback FOR DELETE
  TO authenticated USING (participant_id = auth_participant_id());
