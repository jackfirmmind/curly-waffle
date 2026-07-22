/*
# Phase 2.1 — Visibility rename + upload notifications

## 1. Visibility model (replaces "1-on-1")
"1-on-1" was confusing once a coach has many participants in a company.
New model, three clear levels:

  - 'public'     : everyone in the company (the coach + all participants)
  - 'private'    : only the person whose profile it is, plus their coach  [DEFAULT]
  - 'coach_only' : only the coach — the participant cannot see it
                   (selectable by coaches only)

Existing 'one_on_one' rows migrate to 'private' (same meaning, better name).

## 2. Upload notifications (with 10-minute batching)
When media is uploaded, everyone who can see it (except the uploader) gets a
bell notification. To avoid 100 separate pings for a bulk upload, notifications
are grouped: if an unread media notification from the same uploader about the
same profile already exists within the last 10 minutes, it is UPDATED and its
counter incremented, e.g.

    "John Doe uploaded a file to your profile"
    "John Doe uploaded 100 files to your profile"

Adds `group_key` and `event_count` to notifications to support this.

Safe to re-run (idempotent).
*/

-- ============================================================
-- 1. Visibility: migrate values, then swap the constraint
-- ============================================================
ALTER TABLE media_items DROP CONSTRAINT IF EXISTS media_items_visibility_check;

UPDATE media_items SET visibility = 'private' WHERE visibility = 'one_on_one';

ALTER TABLE media_items ALTER COLUMN visibility SET DEFAULT 'private';

ALTER TABLE media_items ADD CONSTRAINT media_items_visibility_check
  CHECK (visibility IN ('public', 'private', 'coach_only'));

-- ============================================================
-- 2. RLS — SELECT reflects the three levels
-- ============================================================
DROP POLICY IF EXISTS "select_media" ON media_items;
CREATE POLICY "select_media" ON media_items FOR SELECT
  TO authenticated USING (
    -- coach who owns the company sees everything
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    -- public: any participant in that company
    OR (visibility = 'public' AND company_id = auth_participant_company_id())
    -- private: the profile owner only
    OR (visibility = 'private' AND participant_id = auth_participant_id())
  );

-- INSERT: coach anywhere in own company; participant only onto their own
-- profile, and never 'coach_only'.
DROP POLICY IF EXISTS "insert_media" ON media_items;
CREATE POLICY "insert_media" ON media_items FOR INSERT
  TO authenticated WITH CHECK (
    company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
    OR (
      participant_id = auth_participant_id()
      AND company_id = auth_participant_company_id()
      AND visibility IN ('public', 'private')
    )
  );

-- Keep storage access in lockstep with the table rules.
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
        m.company_id IN (SELECT id FROM companies WHERE consultant_id = auth_consultant_id())
        OR (m.visibility = 'public' AND m.company_id = auth_participant_company_id())
        OR (m.visibility = 'private' AND m.participant_id = auth_participant_id())
      )
  );
$$;

-- ============================================================
-- 3. Notifications: allow the new type + grouping columns
-- ============================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_key text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_count integer NOT NULL DEFAULT 1;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('new_assignment', 'submission_received', 'feedback_received',
                  'meeting_scheduled', 'media_uploaded'));

CREATE INDEX IF NOT EXISTS idx_notifications_group
  ON notifications(user_id, group_key, created_at DESC);

-- ============================================================
-- 4. Trigger: notify viewers on upload, batching within 10 minutes
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_media_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  uploader_name text;
  owner_name    text;
  owner_user    uuid;
  coach_user    uuid;
  target_user   uuid;
  g_key         text;
  existing_id   uuid;
  new_count     integer;
  where_txt     text;
  new_title     text;
BEGIN
  -- Who uploaded (look in both tables; the uploader is one or the other)
  SELECT full_name INTO uploader_name FROM consultants WHERE user_id = NEW.uploaded_by;
  IF uploader_name IS NULL THEN
    SELECT full_name INTO uploader_name FROM participants WHERE user_id = NEW.uploaded_by;
  END IF;
  uploader_name := COALESCE(uploader_name, 'Someone');

  -- The coach who owns this company
  SELECT c.user_id INTO coach_user
  FROM companies co JOIN consultants c ON c.id = co.consultant_id
  WHERE co.id = NEW.company_id;

  -- The participant whose profile this is (if any)
  IF NEW.participant_id IS NOT NULL THEN
    SELECT user_id, full_name INTO owner_user, owner_name
    FROM participants WHERE id = NEW.participant_id;
  END IF;

  g_key := 'media:' || NEW.company_id::text || ':' || COALESCE(NEW.participant_id::text, 'coach')
           || ':' || NEW.uploaded_by::text;

  -- Build the recipient list per visibility, excluding the uploader.
  FOR target_user IN
    SELECT DISTINCT u FROM (
      -- the coach always sees uploads in their company
      SELECT coach_user AS u
      UNION
      -- the profile owner, unless the file is coach-only
      SELECT owner_user WHERE NEW.visibility <> 'coach_only'
      UNION
      -- public files: everyone else in the company
      SELECT p.user_id FROM participants p
      WHERE NEW.visibility = 'public'
        AND p.company_id = NEW.company_id
        AND p.user_id IS NOT NULL
    ) t
    WHERE u IS NOT NULL AND u <> NEW.uploaded_by
  LOOP
    -- Wording depends on whose profile it is, from the recipient's view.
    IF NEW.participant_id IS NULL THEN
      where_txt := 'to their own files';
    ELSIF target_user = owner_user THEN
      where_txt := 'to your profile';
    ELSE
      where_txt := 'to ' || COALESCE(owner_name, 'a profile') || '''s profile';
    END IF;

    -- Reuse an unread notification from the last 10 minutes if there is one.
    SELECT id, event_count INTO existing_id, new_count
    FROM notifications
    WHERE user_id = target_user
      AND group_key = g_key
      AND read_at IS NULL
      AND created_at > now() - interval '10 minutes'
    ORDER BY created_at DESC
    LIMIT 1;

    IF existing_id IS NOT NULL THEN
      new_count := new_count + 1;
      new_title := uploader_name || ' uploaded ' || new_count || ' files ' || where_txt;
      UPDATE notifications
        SET event_count = new_count,
            title = new_title,
            body = NULL,
            created_at = now()
        WHERE id = existing_id;
    ELSE
      new_title := uploader_name || ' uploaded a file ' || where_txt;
      INSERT INTO notifications (user_id, type, title, body, link, group_key, event_count)
      VALUES (target_user, 'media_uploaded', new_title, NEW.file_name, 'media', g_key, 1);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_media_uploaded ON media_items;
CREATE TRIGGER on_media_uploaded
  AFTER INSERT ON media_items
  FOR EACH ROW EXECUTE FUNCTION public.notify_media_uploaded();
