/*
# Gate Signup to Allowlisted Emails

## Goal
Stop open self-signup. From now on an auth account can ONLY be created if the
email is already authorized in the database:

- COACHES (role = 'consultant'): the email must exist in the new
  `coach_allowlist` table. You add a coach's email here (Supabase dashboard /
  service role) after they pay. Only then can they create their account.

- PARTICIPANTS (role = 'participant'): the email must already exist in the
  `participants` table with `user_id IS NULL`. Two ways a participant email
  gets there:
    1. A coach adds the participant inside the app (existing "Add participant"
       flow inserts into `participants` with a null user_id).
    2. You bulk-insert participant rows directly in Supabase (see note below).

Any signup attempt with an email that isn't authorized is rejected at the
database level — the auth.users row is rolled back, so NO account is created.

## How enforcement works (defense in depth)
1. DB trigger `handle_new_user()` (the hard gate): runs during the auth signup
   transaction. If the email isn't authorized for the requested role it
   RAISEs, which rolls back the whole transaction — the account never exists.
2. RPC `can_sign_up()` (UX layer): the frontend calls this BEFORE attempting
   signup so it can show a clear, friendly message instead of a generic DB
   error. This is convenience only; the trigger is the actual security barrier.

## IMPORTANT — bulk-uploading participants on the backend
`participants` requires a `company_id` (which company / coach they belong to),
a `full_name`, a `role` ('leadership' | 'management' | 'participant'), and a
unique `email`. Leave `user_id` NULL so the participant can claim the row on
signup. Example bulk insert (get the company_id from the `companies` table):

    INSERT INTO participants (company_id, full_name, email, role)
    VALUES
      ('<company-uuid>', 'Jane Doe',  'jane@example.com',  'participant'),
      ('<company-uuid>', 'John Roe',  'john@example.com',  'participant')
    ON CONFLICT (email) DO NOTHING;

## Existing accounts
This only affects NEW signups. Coaches/participants who already have accounts
(their rows already exist) are unaffected. If you want to test coach signup
yourself, add your email to `coach_allowlist` first.

## Security
- `coach_allowlist` has RLS enabled with NO anon/authenticated policies, so it
  is invisible to the app and only manageable via the service role (dashboard).
- All SECURITY DEFINER functions pin `search_path = public` (matches the rest
  of this project's functions).
*/

-- ============================================================
-- 1. Coach allowlist table
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE coach_allowlist ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated on purpose: the table is managed only
-- via the service role (Supabase dashboard / backend). RLS with no matching
-- policy = deny for normal app users.

CREATE INDEX IF NOT EXISTS idx_coach_allowlist_email ON coach_allowlist (lower(email));

-- ============================================================
-- 2. Gate the signup trigger
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  user_role text;
  user_name text;
BEGIN
  user_role := NEW.raw_user_meta_data->>'role';
  user_name := NEW.raw_user_meta_data->>'full_name';

  IF user_role = 'consultant' THEN
    -- Coach: email must be pre-authorized in coach_allowlist.
    IF NOT EXISTS (
      SELECT 1 FROM coach_allowlist
      WHERE lower(email) = lower(NEW.email)
    ) THEN
      RAISE EXCEPTION 'EMAIL_NOT_AUTHORIZED: coach email % is not on the allowlist', NEW.email
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO consultants (user_id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(user_name, split_part(NEW.email, '@', 1)))
    ON CONFLICT (user_id) DO NOTHING;

  ELSE
    -- Participant: email must already exist in participants, unclaimed.
    UPDATE participants
      SET user_id = NEW.id
      WHERE lower(email) = lower(NEW.email)
        AND user_id IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'EMAIL_NOT_AUTHORIZED: participant email % has not been added by a coach', NEW.email
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 3. Pre-signup eligibility check (for a clean frontend message)
-- ============================================================
-- Returns true only if the given email is allowed to create an account for the
-- given role. Safe to expose to anon: it returns a single boolean for an email
-- the caller already typed, and never reveals row contents.
CREATE OR REPLACE FUNCTION public.can_sign_up(p_email text, p_role text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RETURN false;
  END IF;

  IF p_role = 'consultant' THEN
    RETURN EXISTS (
      SELECT 1 FROM coach_allowlist
      WHERE lower(email) = lower(btrim(p_email))
    );
  ELSE
    RETURN EXISTS (
      SELECT 1 FROM participants
      WHERE lower(email) = lower(btrim(p_email))
        AND user_id IS NULL
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_sign_up(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.can_sign_up(text, text) TO anon, authenticated;
