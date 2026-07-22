/*
# Portal Schema - RLS Policies and Triggers (Step 2)

Adds row-level security policies to all portal tables and a trigger that
auto-creates/links consultant and participant records on signup.

## Security Model
- Consultants can CRUD their own companies and the participants/assignments/meetings within them.
- Consultants can read submissions and feedback for their companies.
- Participants can read their own company's assignments and meetings.
- Participants can CRUD their own submissions and feedback.
- Participants can read their own profile and company info.

## Triggers
- on_auth_user_created: After a new auth user is created:
  - If signup metadata role = 'consultant', inserts a consultants row.
  - Otherwise, links the auth user to an existing participants row by email.
*/

-- ============================================================
-- CONSULTANTS POLICIES
-- ============================================================
DROP POLICY IF EXISTS "select_own_consultant" ON consultants;
CREATE POLICY "select_own_consultant" ON consultants FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_consultant" ON consultants;
CREATE POLICY "insert_own_consultant" ON consultants FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_consultant" ON consultants;
CREATE POLICY "update_own_consultant" ON consultants FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_consultant" ON consultants;
CREATE POLICY "delete_own_consultant" ON consultants FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- COMPANIES POLICIES
-- ============================================================
DROP POLICY IF EXISTS "select_companies" ON companies;
CREATE POLICY "select_companies" ON companies FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c WHERE c.id = companies.consultant_id AND c.user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM participants p WHERE p.company_id = companies.id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_companies" ON companies;
CREATE POLICY "insert_companies" ON companies FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_companies" ON companies;
CREATE POLICY "update_companies" ON companies FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c WHERE c.id = companies.consultant_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM consultants c WHERE c.id = companies.consultant_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_companies" ON companies;
CREATE POLICY "delete_companies" ON companies FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c WHERE c.id = companies.consultant_id AND c.user_id = auth.uid())
  );

-- ============================================================
-- PARTICIPANTS POLICIES
-- ============================================================
DROP POLICY IF EXISTS "select_participants" ON participants;
CREATE POLICY "select_participants" ON participants FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = participants.company_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_participants" ON participants;
CREATE POLICY "insert_participants" ON participants FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = company_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_participants" ON participants;
CREATE POLICY "update_participants" ON participants FOR UPDATE
  TO authenticated USING (
    auth.uid() = user_id
    OR
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = participants.company_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    auth.uid() = user_id
    OR
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = participants.company_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_participants" ON participants;
CREATE POLICY "delete_participants" ON participants FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = participants.company_id AND c.user_id = auth.uid())
  );

-- ============================================================
-- ASSIGNMENTS POLICIES
-- ============================================================
DROP POLICY IF EXISTS "select_assignments" ON assignments;
CREATE POLICY "select_assignments" ON assignments FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = assignments.company_id AND c.user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM participants p WHERE p.company_id = assignments.company_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_assignments" ON assignments;
CREATE POLICY "insert_assignments" ON assignments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = company_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_assignments" ON assignments;
CREATE POLICY "update_assignments" ON assignments FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = assignments.company_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = assignments.company_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_assignments" ON assignments;
CREATE POLICY "delete_assignments" ON assignments FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = assignments.company_id AND c.user_id = auth.uid())
  );

-- ============================================================
-- ASSIGNMENT SUBMISSIONS POLICIES
-- ============================================================
DROP POLICY IF EXISTS "select_submissions" ON assignment_submissions;
CREATE POLICY "select_submissions" ON assignment_submissions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = assignment_submissions.participant_id AND p.user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM consultants c, companies comp, assignments a
            WHERE c.id = comp.consultant_id AND comp.id = a.company_id AND a.id = assignment_submissions.assignment_id
            AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_submissions" ON assignment_submissions;
CREATE POLICY "insert_submissions" ON assignment_submissions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = participant_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_submissions" ON assignment_submissions;
CREATE POLICY "update_submissions" ON assignment_submissions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = assignment_submissions.participant_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = assignment_submissions.participant_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_submissions" ON assignment_submissions;
CREATE POLICY "delete_submissions" ON assignment_submissions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = assignment_submissions.participant_id AND p.user_id = auth.uid())
  );

-- ============================================================
-- MEETINGS POLICIES
-- ============================================================
DROP POLICY IF EXISTS "select_meetings" ON meetings;
CREATE POLICY "select_meetings" ON meetings FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = meetings.company_id AND c.user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM participants p WHERE p.company_id = meetings.company_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_meetings" ON meetings;
CREATE POLICY "insert_meetings" ON meetings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = company_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_meetings" ON meetings;
CREATE POLICY "update_meetings" ON meetings FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = meetings.company_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = meetings.company_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_meetings" ON meetings;
CREATE POLICY "delete_meetings" ON meetings FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = meetings.company_id AND c.user_id = auth.uid())
  );

-- ============================================================
-- FEEDBACK POLICIES
-- ============================================================
DROP POLICY IF EXISTS "select_feedback" ON feedback;
CREATE POLICY "select_feedback" ON feedback FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = feedback.participant_id AND p.user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = (
              SELECT a.company_id FROM assignments a WHERE a.id = feedback.assignment_id
            ) AND c.user_id = auth.uid())
    OR
    EXISTS (SELECT 1 FROM consultants c, companies comp
            WHERE c.id = comp.consultant_id AND comp.id = (
              SELECT m.company_id FROM meetings m WHERE m.id = feedback.meeting_id
            ) AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_feedback" ON feedback;
CREATE POLICY "insert_feedback" ON feedback FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = participant_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_feedback" ON feedback;
CREATE POLICY "update_feedback" ON feedback FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = feedback.participant_id AND p.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = feedback.participant_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_feedback" ON feedback;
CREATE POLICY "delete_feedback" ON feedback FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM participants p WHERE p.id = feedback.participant_id AND p.user_id = auth.uid())
  );

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION auth_consultant_id()
RETURNS uuid AS $$
  SELECT id FROM consultants WHERE user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION auth_participant_id()
RETURNS uuid AS $$
  SELECT id FROM participants WHERE user_id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ============================================================
-- TRIGGER: Handle new user signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
DECLARE
  user_role text;
  user_name text;
BEGIN
  user_role := NEW.raw_user_meta_data->>'role';
  user_name := NEW.raw_user_meta_data->>'full_name';

  IF user_role = 'consultant' THEN
    INSERT INTO consultants (user_id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(user_name, split_part(NEW.email, '@', 1)))
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    UPDATE participants SET user_id = NEW.id
    WHERE email = NEW.email AND user_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
