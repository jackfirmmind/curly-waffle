/*
# Portal Schema - Tables Only (Step 1)

Creates all tables for the multi-tenant client management portal.
Policies and triggers will be added in a follow-up migration.

## Tables
1. consultants - top-level users managing companies
2. companies - companies managed by a consultant
3. participants - people belonging to a company
4. assignments - tasks created by consultant per company
5. assignment_submissions - participant submissions
6. meetings - scheduled meetings per company
7. feedback - participant feedback on assignments or meetings
*/

CREATE TABLE IF NOT EXISTS consultants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE consultants ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_consultants_user_id ON consultants(user_id);

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES consultants(id) ON DELETE CASCADE,
  name text NOT NULL,
  industry text,
  description text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_companies_consultant_id ON companies(consultant_id);

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('leadership', 'management', 'participant')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_company_id ON participants(company_id);
CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email);

CREATE TABLE IF NOT EXISTS assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  due_date date,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_assignments_company_id ON assignments(company_id);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  content text NOT NULL,
  submitted_at timestamptz DEFAULT now(),
  UNIQUE (assignment_id, participant_id)
);
ALTER TABLE assignment_submissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_participant_id ON assignment_submissions(participant_id);

CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  scheduled_at timestamptz NOT NULL,
  duration_minutes int DEFAULT 60,
  location text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_meetings_company_id ON meetings(company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_at ON meetings(scheduled_at);

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES assignments(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz DEFAULT now(),
  CHECK (assignment_id IS NOT NULL OR meeting_id IS NOT NULL)
);
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_feedback_participant_id ON feedback(participant_id);
CREATE INDEX IF NOT EXISTS idx_feedback_assignment_id ON feedback(assignment_id);
CREATE INDEX IF NOT EXISTS idx_feedback_meeting_id ON feedback(meeting_id);
