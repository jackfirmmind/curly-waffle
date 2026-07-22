import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { AuthUser, UserRole } from './types';

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function resolveAuthUser(user: User): Promise<AuthUser> {
  const role = (user.user_metadata?.role as UserRole) || 'participant';
  const fullName = (user.user_metadata?.full_name as string) || '';

  let consultantId: string | undefined;
  let participantId: string | undefined;
  let avatarUrl: string | null = null;
  let status: string | null = null;
  let vibeEmoji: string | null = null;

  if (role === 'consultant') {
    const { data } = await supabase
      .from('consultants')
      .select('id, avatar_url, status, vibe_emoji')
      .eq('user_id', user.id)
      .maybeSingle();
    consultantId = data?.id;
    avatarUrl = data?.avatar_url ?? null;
    status = data?.status ?? null;
    vibeEmoji = data?.vibe_emoji ?? null;
  } else {
    const { data } = await supabase
      .from('participants')
      .select('id, avatar_url, status, vibe_emoji')
      .eq('user_id', user.id)
      .maybeSingle();
    participantId = data?.id;
    avatarUrl = data?.avatar_url ?? null;
    status = data?.status ?? null;
    vibeEmoji = data?.vibe_emoji ?? null;
  }

  return {
    id: user.id,
    email: user.email || '',
    role,
    fullName,
    consultantId,
    participantId,
    avatarUrl,
    status,
    vibeEmoji,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        resolveAuthUser(data.session.user).then((u) => {
          if (mounted) {
            setUser(u);
            setLoading(false);
          }
        });
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        resolveAuthUser(newSession.user).then((u) => {
          if (mounted) {
            setUser(u);
            setLoading(false);
          }
        });
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string, role: UserRole) => {
    const normalizedEmail = email.trim().toLowerCase();

    const notAuthorizedMessage =
      role === 'consultant'
        ? "This email isn't authorized to create a coach account yet. Make sure you've completed payment and are using the exact email you registered with."
        : "This email hasn't been added yet. Ask your coach to add you to their workspace, then sign up using that same email.";

    // Pre-check eligibility so we can show a clear message. The database trigger
    // is the real gate — this is just for a friendly UX.
    const { data: allowed, error: checkError } = await supabase.rpc('can_sign_up', {
      p_email: normalizedEmail,
      p_role: role,
    });

    if (!checkError && allowed === false) {
      return { error: notAuthorizedMessage };
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: { data: { full_name: fullName, role } },
    });

    if (error) {
      // The signup trigger rejects unauthorized emails by raising, which
      // Supabase surfaces as a generic "Database error saving new user".
      if (/database error saving new user/i.test(error.message)) {
        return { error: notAuthorizedMessage };
      }
      return { error: error.message };
    }
    if (!data.user) return { error: 'Sign-up failed. Please try again.' };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const u = await resolveAuthUser(data.user);
      setUser(u);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
