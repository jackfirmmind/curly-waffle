import { useRef, useState } from 'react';
import Modal from './Modal';
import Avatar from './Avatar';
import { useAuth } from '../../lib/AuthContext';
import { useToast } from './Toast';
import { supabase } from '../../lib/supabase';
import { VIBE_EMOJIS } from '../../lib/types';
import { Upload, Loader2 } from 'lucide-react';

export interface ProfileData {
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  status?: string | null;
  vibeEmoji?: string | null;
  roleLabel?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 'self' lets the current user edit their own profile; 'view' is read-only. */
  mode: 'self' | 'view';
  /** Required for 'view' mode. */
  profile?: ProfileData;
}

export default function ProfileModal({ open, onClose, mode, profile }: Props) {
  const { user, refreshUser } = useAuth();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<string>(user?.status || '');
  const [emoji, setEmoji] = useState<string>(user?.vibeEmoji || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl || null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const table = user?.role === 'consultant' ? 'consultants' : 'participants';

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) { show('Please choose an image file.', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { show('Image must be under 5MB.', 'error'); return; }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) { show('Upload failed. Try again.', 'error'); return; }
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      setAvatarUrl(data.publicUrl);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const idCol = user.role === 'consultant' ? user.consultantId : user.participantId;
      if (!idCol) { show('Could not find your profile record.', 'error'); return; }
      const { error } = await supabase
        .from(table)
        .update({ status: status.trim() || null, vibe_emoji: emoji || null, avatar_url: avatarUrl })
        .eq('id', idCol);
      if (error) { show('Save failed. Try again.', 'error'); return; }
      await refreshUser();
      show('Profile updated.', 'success');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // ---- VIEW (read-only) ----
  if (mode === 'view' && profile) {
    return (
      <Modal open={open} onClose={onClose} title="Profile">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <Avatar name={profile.name} avatarUrl={profile.avatarUrl} emoji={profile.vibeEmoji} size="xl" />
          <div>
            <h3 className="font-display text-lg font-bold text-ink-900">{profile.name}</h3>
            {profile.roleLabel && <p className="text-xs uppercase tracking-wide text-ink-400 mt-0.5">{profile.roleLabel}</p>}
          </div>
          {profile.status && <p className="text-sm text-ink-600 max-w-sm">{profile.status}</p>}
          {profile.email && (
            <a href={`mailto:${profile.email}`} className="text-sm text-brand-600 hover:text-brand-700 underline underline-offset-2">
              {profile.email}
            </a>
          )}
        </div>
      </Modal>
    );
  }

  // ---- SELF (edit) ----
  return (
    <Modal open={open} onClose={onClose} title="Your profile" description="Customize how you appear to others.">
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={user?.fullName || user?.email || '?'} avatarUrl={avatarUrl} emoji={emoji} size="xl" />
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary inline-flex items-center gap-2">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
              {avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {avatarUrl && (
              <button onClick={() => setAvatarUrl(null)} className="block text-xs text-ink-400 hover:text-red-600">
                Remove photo (use initials)
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="label">Status</label>
          <input className="input" maxLength={120} value={status} onChange={(e) => setStatus(e.target.value)} placeholder="e.g. Focused on Q3 goals 🎯" />
        </div>

        <div>
          <label className="label">Your vibe</label>
          <div className="flex flex-wrap gap-2">
            {VIBE_EMOJIS.map((em) => (
              <button
                key={em}
                onClick={() => setEmoji(emoji === em ? '' : em)}
                className={`flex h-11 w-11 items-center justify-center rounded-lg border text-xl transition-all ${
                  emoji === em ? 'border-brand-500 bg-brand-50 scale-105' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'
                }`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-ink-100">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || uploading} className="btn-primary inline-flex items-center gap-2">
            {saving && <Loader2 size={15} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
}
