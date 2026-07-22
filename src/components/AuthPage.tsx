import { useState, FormEvent } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Briefcase, Users, ArrowRight, Mail, Lock, User, Sparkles } from 'lucide-react';
import SupportButton from './ui/SupportButton';
import type { UserRole } from '../lib/types';

type Mode = 'signin' | 'signup';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [role, setRole] = useState<UserRole>('consultant');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'signin') {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    } else {
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password, fullName, role);
      if (error) setError(error);
      else {
        setError(null);
        setMode('signin');
        setEmail('');
        setPassword('');
        setFullName('');
        setLoading(false);
        alert('Account created! You can now sign in.');
        return;
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col items-center justify-center px-6 py-10">
      <SupportButton />

      <div className="w-full max-w-md animate-fade-in">
        {/* Brand */}
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Sparkles size={22} />
          </div>
          <span className="font-display text-2xl font-bold tracking-tight text-ink-900">Portal</span>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-7 shadow-soft sm:p-8">
          <h2 className="font-display text-2xl font-bold text-ink-900">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {mode === 'signin'
              ? 'Sign in to access your dashboard.'
              : 'Join your workspace in minutes.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {mode === 'signup' && (
              <div>
                <label className="label">I am a...</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: 'consultant', label: 'Coach', icon: Briefcase },
                    { value: 'participant', label: 'Participant', icon: Users },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                        role === opt.value
                          ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20'
                          : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300'
                      }`}
                    >
                      <opt.icon size={16} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label className="label" htmlFor="fullName">Full name</label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                  <input
                    id="fullName"
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="input pl-9"
                    placeholder="Jane Smith"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label" htmlFor="email">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input pl-9"
                  placeholder="you@company.com"
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-9"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-500">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
              }}
              className="font-semibold text-brand-600 hover:text-brand-700"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>

          {mode === 'signup' && role === 'participant' && (
            <div className="mt-6 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-xs text-brand-800 leading-relaxed">
              <strong className="font-semibold">Note:</strong> Your coach must add your email to a company before you sign up. Use the same email your coach registered for you.
            </div>
          )}

          {mode === 'signup' && role === 'consultant' && (
            <div className="mt-6 rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 text-xs text-brand-800 leading-relaxed">
              <strong className="font-semibold">Note:</strong> Coach accounts are approved after payment. Sign up using the exact email you registered with — if it hasn't been approved yet, sign-up won't go through.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
