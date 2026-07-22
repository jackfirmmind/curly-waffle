import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { useToast } from './Toast';
import Modal from './Modal';
import EmptyState from './EmptyState';
import Avatar from './Avatar';
import { formatRelative } from '../../lib/format';
import { VIBE_EMOJIS } from '../../lib/types';
import type { ForumTopic, ForumPost, ForumComment, ForumReaction, ForumPerson } from '../../lib/types';
import {
  MessagesSquare, Plus, Lock, Unlock, Trash2, Send, ChevronLeft,
  MessageSquare, SmilePlus, Loader2,
} from 'lucide-react';

interface Props {
  companyId: string;
  isCoach: boolean;
}

export default function ForumView({ companyId, isCoach }: Props) {
  const { user } = useAuth();
  const { show } = useToast();

  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [postCounts, setPostCounts] = useState<Record<string, number>>({});
  const [people, setPeople] = useState<Record<string, ForumPerson>>({});
  const [loading, setLoading] = useState(true);

  const [openTopic, setOpenTopic] = useState<ForumTopic | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [comments, setComments] = useState<Record<string, ForumComment[]>>({});
  const [reactions, setReactions] = useState<Record<string, ForumReaction[]>>({});
  const [threadLoading, setThreadLoading] = useState(false);

  const [tModal, setTModal] = useState(false);
  const [tForm, setTForm] = useState({ title: '', description: '' });
  const [saving, setSaving] = useState(false);

  const [draft, setDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [showComments, setShowComments] = useState<Record<string, boolean>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // ---- people directory (for names + avatars on posts) ----
  const loadPeople = useCallback(async () => {
    const map: Record<string, ForumPerson> = {};

    const { data: parts } = await supabase
      .from('participants')
      .select('user_id, full_name, avatar_url, vibe_emoji')
      .eq('company_id', companyId);

    (parts || []).forEach((p) => {
      if (p.user_id) {
        map[p.user_id] = {
          userId: p.user_id, name: p.full_name,
          avatarUrl: p.avatar_url, vibeEmoji: p.vibe_emoji, isCoach: false,
        };
      }
    });

    const { data: company } = await supabase
      .from('companies').select('consultant_id').eq('id', companyId).maybeSingle();

    if (company?.consultant_id) {
      const { data: coach } = await supabase
        .from('consultants')
        .select('user_id, full_name, avatar_url, vibe_emoji')
        .eq('id', company.consultant_id)
        .maybeSingle();
      if (coach?.user_id) {
        map[coach.user_id] = {
          userId: coach.user_id, name: coach.full_name,
          avatarUrl: coach.avatar_url, vibeEmoji: coach.vibe_emoji, isCoach: true,
        };
      }
    }

    setPeople(map);
  }, [companyId]);

  const loadTopics = useCallback(async () => {
    setLoading(true);
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from('forum_topics').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('forum_posts').select('topic_id').eq('company_id', companyId),
    ]);
    setTopics((t || []) as ForumTopic[]);
    const counts: Record<string, number> = {};
    (p || []).forEach((row: { topic_id: string }) => {
      counts[row.topic_id] = (counts[row.topic_id] || 0) + 1;
    });
    setPostCounts(counts);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { loadPeople(); loadTopics(); }, [loadPeople, loadTopics]);

  // ---- thread ----
  const loadThread = useCallback(async (topic: ForumTopic) => {
    setThreadLoading(true);
    const { data: postRows } = await supabase
      .from('forum_posts').select('*').eq('topic_id', topic.id).order('created_at', { ascending: true });

    const list = (postRows || []) as ForumPost[];
    setPosts(list);

    const ids = list.map((p) => p.id);
    if (ids.length) {
      const [{ data: c }, { data: r }] = await Promise.all([
        supabase.from('forum_comments').select('*').in('post_id', ids).order('created_at', { ascending: true }),
        supabase.from('forum_reactions').select('*').in('post_id', ids),
      ]);
      const cMap: Record<string, ForumComment[]> = {};
      (c || []).forEach((row) => {
        const cc = row as ForumComment;
        (cMap[cc.post_id] ||= []).push(cc);
      });
      const rMap: Record<string, ForumReaction[]> = {};
      (r || []).forEach((row) => {
        const rr = row as ForumReaction;
        (rMap[rr.post_id] ||= []).push(rr);
      });
      setComments(cMap);
      setReactions(rMap);
    } else {
      setComments({});
      setReactions({});
    }
    setThreadLoading(false);
  }, []);

  const open = (topic: ForumTopic) => { setOpenTopic(topic); setDraft(''); loadThread(topic); };

  // ---- topic actions (coach) ----
  const createTopic = async () => {
    if (!tForm.title.trim() || !user) return;
    setSaving(true);
    const { error } = await supabase.from('forum_topics').insert({
      company_id: companyId,
      created_by: user.id,
      title: tForm.title.trim(),
      description: tForm.description.trim() || null,
    });
    setSaving(false);
    if (error) { show("Couldn't create the topic.", 'error'); return; }
    setTModal(false);
    setTForm({ title: '', description: '' });
    show('Topic created.', 'success');
    loadTopics();
  };

  const toggleLock = async (topic: ForumTopic) => {
    const next = !topic.is_locked;
    const { error } = await supabase.from('forum_topics').update({ is_locked: next }).eq('id', topic.id);
    if (error) { show("Couldn't update the topic.", 'error'); return; }
    setTopics((prev) => prev.map((t) => (t.id === topic.id ? { ...t, is_locked: next } : t)));
    if (openTopic?.id === topic.id) setOpenTopic({ ...topic, is_locked: next });
  };

  const deleteTopic = async (topic: ForumTopic) => {
    if (!confirm(`Delete "${topic.title}" and all its posts?`)) return;
    const { error } = await supabase.from('forum_topics').delete().eq('id', topic.id);
    if (error) { show("Couldn't delete the topic.", 'error'); return; }
    setTopics((prev) => prev.filter((t) => t.id !== topic.id));
    if (openTopic?.id === topic.id) setOpenTopic(null);
    show('Topic deleted.', 'success');
  };

  // ---- posting ----
  const canPost = useMemo(
    () => !!openTopic && (isCoach || !openTopic.is_locked),
    [openTopic, isCoach]
  );

  const submitPost = async () => {
    if (!draft.trim() || !openTopic || !user) return;
    const body = draft.trim();
    setDraft('');
    const { data, error } = await supabase.from('forum_posts').insert({
      topic_id: openTopic.id, company_id: companyId, author_id: user.id, body,
    }).select().maybeSingle();
    if (error || !data) { show("Couldn't post that.", 'error'); setDraft(body); return; }
    setPosts((prev) => [...prev, data as ForumPost]);
    setPostCounts((prev) => ({ ...prev, [openTopic.id]: (prev[openTopic.id] || 0) + 1 }));
  };

  const deletePost = async (post: ForumPost) => {
    if (!confirm('Delete this post?')) return;
    const { error } = await supabase.from('forum_posts').delete().eq('id', post.id);
    if (error) { show("Couldn't delete that post.", 'error'); return; }
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
  };

  const submitComment = async (postId: string) => {
    const text = (commentDraft[postId] || '').trim();
    if (!text || !user) return;
    setCommentDraft((prev) => ({ ...prev, [postId]: '' }));
    const { data, error } = await supabase.from('forum_comments').insert({
      post_id: postId, company_id: companyId, author_id: user.id, body: text,
    }).select().maybeSingle();
    if (error || !data) { show("Couldn't add that comment.", 'error'); return; }
    setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), data as ForumComment] }));
  };

  const deleteComment = async (c: ForumComment) => {
    const { error } = await supabase.from('forum_comments').delete().eq('id', c.id);
    if (error) { show("Couldn't delete that comment.", 'error'); return; }
    setComments((prev) => ({ ...prev, [c.post_id]: (prev[c.post_id] || []).filter((x) => x.id !== c.id) }));
  };

  // ---- reactions ----
  const toggleReaction = async (postId: string, emoji: string) => {
    if (!user) return;
    setPickerFor(null);
    const mine = (reactions[postId] || []).find((r) => r.user_id === user.id && r.emoji === emoji);

    if (mine) {
      setReactions((prev) => ({ ...prev, [postId]: (prev[postId] || []).filter((r) => r.id !== mine.id) }));
      await supabase.from('forum_reactions').delete().eq('id', mine.id);
    } else {
      const { data, error } = await supabase.from('forum_reactions').insert({
        post_id: postId, company_id: companyId, user_id: user.id, emoji,
      }).select().maybeSingle();
      if (error || !data) return;
      setReactions((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), data as ForumReaction] }));
    }
  };

  const personFor = (userId: string): ForumPerson =>
    people[userId] || { userId, name: 'Someone', avatarUrl: null, vibeEmoji: null, isCoach: false };

  // =========================================================
  // TOPIC LIST
  // =========================================================
  if (!openTopic) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-ink-500">{topics.length} topic{topics.length === 1 ? '' : 's'}</p>
          {isCoach && (
            <button onClick={() => setTModal(true)} className="btn-primary inline-flex items-center gap-2">
              <Plus size={16} /> New topic
            </button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-ink-100 animate-pulse" />)}</div>
        ) : topics.length === 0 ? (
          <EmptyState
            icon={<MessagesSquare size={22} />}
            title="No topics yet"
            description={isCoach ? 'Create a topic to start the conversation with your company.' : 'Your coach hasn\'t started any discussions yet.'}
          />
        ) : (
          <div className="space-y-2">
            {topics.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-4 hover:border-ink-300 transition-colors">
                <button onClick={() => open(t)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-ink-900 truncate">{t.title}</h3>
                    {t.is_locked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        <Lock size={10} /> Coach only
                      </span>
                    )}
                  </div>
                  {t.description && <p className="mt-0.5 truncate text-sm text-ink-500">{t.description}</p>}
                  <p className="mt-1 text-xs text-ink-400">
                    {postCounts[t.id] || 0} post{(postCounts[t.id] || 0) === 1 ? '' : 's'} · {formatRelative(t.created_at)}
                  </p>
                </button>

                {isCoach && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => toggleLock(t)} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      title={t.is_locked ? 'Unlock — let everyone post' : 'Lock — only you can post'}>
                      {t.is_locked ? <Lock size={15} /> : <Unlock size={15} />}
                    </button>
                    <button onClick={() => deleteTopic(t)} className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600" title="Delete topic">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Modal open={tModal} onClose={() => setTModal(false)} title="New topic" description="Start a discussion for this company.">
          <div className="space-y-4">
            <div>
              <label className="label">Title</label>
              <input className="input" value={tForm.title} onChange={(e) => setTForm({ ...tForm, title: e.target.value })} placeholder="e.g. Week 3 reflections" />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <textarea className="input min-h-[80px]" value={tForm.description} onChange={(e) => setTForm({ ...tForm, description: e.target.value })} placeholder="What is this topic for?" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setTModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={createTopic} disabled={saving || !tForm.title.trim()} className="btn-primary">
                {saving ? 'Creating...' : 'Create topic'}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // =========================================================
  // THREAD
  // =========================================================
  return (
    <div>
      <button onClick={() => setOpenTopic(null)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800">
        <ChevronLeft size={16} /> All topics
      </button>

      <div className="mb-5">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold text-ink-900">{openTopic.title}</h2>
          {openTopic.is_locked && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <Lock size={10} /> Coach only
            </span>
          )}
        </div>
        {openTopic.description && <p className="mt-1 text-sm text-ink-500">{openTopic.description}</p>}
      </div>

      {threadLoading ? (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 rounded-xl bg-ink-100 animate-pulse" />)}</div>
      ) : (
        <div className="space-y-3">
          {posts.length === 0 && (
            <EmptyState icon={<MessageSquare size={22} />} title="No posts yet"
              description={canPost ? 'Be the first to say something.' : 'Only the coach can post in this topic.'} />
          )}

          {posts.map((post) => {
            const author = personFor(post.author_id);
            const postReactions = reactions[post.id] || [];
            const grouped = postReactions.reduce<Record<string, number>>((acc, r) => {
              acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc;
            }, {});
            const myEmojis = new Set(postReactions.filter((r) => r.user_id === user?.id).map((r) => r.emoji));
            const postComments = comments[post.id] || [];
            const canDelete = post.author_id === user?.id || isCoach;

            return (
              <div key={post.id} className="rounded-xl border border-ink-200 bg-white p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={author.name} avatarUrl={author.avatarUrl} emoji={author.vibeEmoji} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink-900">{author.name}</span>
                      {author.isCoach && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">COACH</span>}
                      <span className="text-xs text-ink-400">{formatRelative(post.created_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{post.body}</p>

                    {/* reactions */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {Object.entries(grouped).map(([emoji, count]) => (
                        <button key={emoji} onClick={() => toggleReaction(post.id, emoji)}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                            myEmojis.has(emoji) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
                          }`}>
                          <span>{emoji}</span> {count}
                        </button>
                      ))}

                      <div className="relative">
                        <button onClick={() => setPickerFor(pickerFor === post.id ? null : post.id)}
                          className="rounded-full border border-ink-200 bg-white p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-600" title="Add reaction">
                          <SmilePlus size={14} />
                        </button>
                        {pickerFor === post.id && (
                          <div className="absolute z-20 mt-1 flex gap-1 rounded-xl border border-ink-200 bg-white p-1.5 shadow-lift">
                            {VIBE_EMOJIS.map((em) => (
                              <button key={em} onClick={() => toggleReaction(post.id, em)}
                                className="rounded-lg px-1.5 py-1 text-lg hover:bg-ink-100">{em}</button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button onClick={() => setShowComments((p) => ({ ...p, [post.id]: !p[post.id] }))}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-ink-500 hover:bg-ink-50">
                        <MessageSquare size={13} /> {postComments.length || ''} {postComments.length === 1 ? 'comment' : 'comments'}
                      </button>
                    </div>

                    {/* comments */}
                    {showComments[post.id] && (
                      <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
                        {postComments.map((c) => {
                          const ca = personFor(c.author_id);
                          const canDelC = c.author_id === user?.id || isCoach;
                          return (
                            <div key={c.id} className="flex items-start gap-2">
                              <Avatar name={ca.name} avatarUrl={ca.avatarUrl} emoji={ca.vibeEmoji} size="xs" />
                              <div className="min-w-0 flex-1 rounded-lg bg-ink-50 px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-ink-800">{ca.name}</span>
                                  <span className="text-[11px] text-ink-400">{formatRelative(c.created_at)}</span>
                                  {canDelC && (
                                    <button onClick={() => deleteComment(c)} className="ml-auto text-ink-300 hover:text-red-600" title="Delete">
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-700">{c.body}</p>
                              </div>
                            </div>
                          );
                        })}

                        {canPost && (
                          <div className="flex items-center gap-2 pt-1">
                            <input
                              className="input py-2 text-sm"
                              placeholder="Write a comment..."
                              value={commentDraft[post.id] || ''}
                              onChange={(e) => setCommentDraft((p) => ({ ...p, [post.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(post.id); } }}
                            />
                            <button onClick={() => submitComment(post.id)} disabled={!(commentDraft[post.id] || '').trim()}
                              className="btn-secondary shrink-0 px-3 py-2"><Send size={14} /></button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {canDelete && (
                    <button onClick={() => deletePost(post)} className="shrink-0 rounded-md p-1.5 text-ink-300 hover:bg-red-50 hover:text-red-600" title="Delete post">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* composer */}
      {canPost ? (
        <div className="mt-4 rounded-xl border border-ink-200 bg-white p-3">
          <textarea
            className="input min-h-[70px]"
            placeholder="Share something with the company..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <button onClick={submitPost} disabled={!draft.trim()} className="btn-primary inline-flex items-center gap-2">
              {threadLoading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Post
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3 text-center text-sm text-ink-500">
          <Lock size={13} className="inline mr-1.5 -mt-0.5" />
          This topic is locked — only the coach can post here.
        </div>
      )}
    </div>
  );
}
