/*
# Phase 3 — Company Forum

A company-wide discussion space: the coach creates topics, everyone in the
company posts and comments, and posts can be reacted to with the same 7 vibe
emojis used on profiles.

## Tables
- forum_topics   : discussion threads. Created by the coach.
                   `is_locked` = only the coach may post in it (participants
                   can still read and react).
- forum_posts    : messages inside a topic.
- forum_comments : replies to a post.
- forum_reactions: one emoji per user per post (clicking the same emoji again
                   removes it — enforced by the unique constraint).

## Permissions
- Topics : coach creates / renames / locks / deletes. Everyone in the company reads.
- Posts  : anyone in the company posts, unless the topic is locked (coach only).
           Authors delete their own; the coach can delete any.
- Comments: same rules as posts.
- Reactions: anyone in the company reacts; you only ever add/remove your own.

Safe to re-run (idempotent).
*/

-- ============================================================
-- Helper: is the current user part of this company (either role)?
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM companies WHERE id = p_company_id AND consultant_id = auth_consultant_id()
  ) OR p_company_id = auth_participant_company_id();
$$;

CREATE OR REPLACE FUNCTION public.is_company_coach(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM companies WHERE id = p_company_id AND consultant_id = auth_consultant_id()
  );
$$;

REVOKE ALL ON FUNCTION public.is_company_member(uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_company_coach(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_coach(uuid) TO anon, authenticated;

-- ============================================================
-- 1. Topics
-- ============================================================
CREATE TABLE IF NOT EXISTS forum_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE forum_topics ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_forum_topics_company ON forum_topics(company_id, created_at DESC);

DROP POLICY IF EXISTS "select_forum_topics" ON forum_topics;
CREATE POLICY "select_forum_topics" ON forum_topics FOR SELECT
  TO authenticated USING (is_company_member(company_id));

DROP POLICY IF EXISTS "insert_forum_topics" ON forum_topics;
CREATE POLICY "insert_forum_topics" ON forum_topics FOR INSERT
  TO authenticated WITH CHECK (is_company_coach(company_id));

DROP POLICY IF EXISTS "update_forum_topics" ON forum_topics;
CREATE POLICY "update_forum_topics" ON forum_topics FOR UPDATE
  TO authenticated USING (is_company_coach(company_id))
  WITH CHECK (is_company_coach(company_id));

DROP POLICY IF EXISTS "delete_forum_topics" ON forum_topics;
CREATE POLICY "delete_forum_topics" ON forum_topics FOR DELETE
  TO authenticated USING (is_company_coach(company_id));

-- ============================================================
-- 2. Posts
-- ============================================================
CREATE TABLE IF NOT EXISTS forum_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON forum_posts(topic_id, created_at);

DROP POLICY IF EXISTS "select_forum_posts" ON forum_posts;
CREATE POLICY "select_forum_posts" ON forum_posts FOR SELECT
  TO authenticated USING (is_company_member(company_id));

-- Anyone in the company may post, unless the topic is locked (coach only).
DROP POLICY IF EXISTS "insert_forum_posts" ON forum_posts;
CREATE POLICY "insert_forum_posts" ON forum_posts FOR INSERT
  TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND is_company_member(company_id)
    AND (
      is_company_coach(company_id)
      OR NOT EXISTS (SELECT 1 FROM forum_topics t WHERE t.id = topic_id AND t.is_locked)
    )
  );

DROP POLICY IF EXISTS "delete_forum_posts" ON forum_posts;
CREATE POLICY "delete_forum_posts" ON forum_posts FOR DELETE
  TO authenticated USING (author_id = auth.uid() OR is_company_coach(company_id));

-- ============================================================
-- 3. Comments
-- ============================================================
CREATE TABLE IF NOT EXISTS forum_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE forum_comments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_forum_comments_post ON forum_comments(post_id, created_at);

DROP POLICY IF EXISTS "select_forum_comments" ON forum_comments;
CREATE POLICY "select_forum_comments" ON forum_comments FOR SELECT
  TO authenticated USING (is_company_member(company_id));

DROP POLICY IF EXISTS "insert_forum_comments" ON forum_comments;
CREATE POLICY "insert_forum_comments" ON forum_comments FOR INSERT
  TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND is_company_member(company_id)
    AND (
      is_company_coach(company_id)
      OR NOT EXISTS (
        SELECT 1 FROM forum_posts p
        JOIN forum_topics t ON t.id = p.topic_id
        WHERE p.id = post_id AND t.is_locked
      )
    )
  );

DROP POLICY IF EXISTS "delete_forum_comments" ON forum_comments;
CREATE POLICY "delete_forum_comments" ON forum_comments FOR DELETE
  TO authenticated USING (author_id = auth.uid() OR is_company_coach(company_id));

-- ============================================================
-- 4. Reactions (one row per user per emoji per post)
-- ============================================================
CREATE TABLE IF NOT EXISTS forum_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (post_id, user_id, emoji)
);
ALTER TABLE forum_reactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_forum_reactions_post ON forum_reactions(post_id);

DROP POLICY IF EXISTS "select_forum_reactions" ON forum_reactions;
CREATE POLICY "select_forum_reactions" ON forum_reactions FOR SELECT
  TO authenticated USING (is_company_member(company_id));

DROP POLICY IF EXISTS "insert_forum_reactions" ON forum_reactions;
CREATE POLICY "insert_forum_reactions" ON forum_reactions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid() AND is_company_member(company_id));

DROP POLICY IF EXISTS "delete_forum_reactions" ON forum_reactions;
CREATE POLICY "delete_forum_reactions" ON forum_reactions FOR DELETE
  TO authenticated USING (user_id = auth.uid());
