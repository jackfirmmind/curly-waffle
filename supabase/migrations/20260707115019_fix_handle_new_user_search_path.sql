/*
# Fix: handle_new_user function missing SET search_path

## Problem
The `handle_new_user()` SECURITY DEFINER trigger function was created without
an explicit `SET search_path`. Supabase's auth service requires SECURITY DEFINER
functions triggered on `auth.users` to have a pinned `search_path` for security
reasons (prevents search_path hijacking). Without it, the function fails during
the auth signup flow, producing the generic "Database error saving new user".

## Fix
Recreate `handle_new_user()` with `SET search_path = public` and reattach the
trigger. The function body is unchanged — only the search_path configuration
is added.

## Security
- No new tables or columns.
- No policy changes.
- The function remains SECURITY DEFINER (required so it can insert into
  `consultants` / update `participants` during the auth flow before the user
  has a session). The pinned search_path closes the security gap.
*/

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
    INSERT INTO consultants (user_id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(user_name, split_part(NEW.email, '@', 1)))
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    UPDATE participants SET user_id = NEW.id
    WHERE email = NEW.email AND user_id IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
