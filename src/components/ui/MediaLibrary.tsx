import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { useToast } from './Toast';
import EmptyState from './EmptyState';
import {
  listMedia, uploadMedia, openMedia, deleteMedia, setVisibility,
  formatLabel, formatSize, VISIBILITY_LABEL, VISIBILITY_HINT,
} from '../../lib/media';
import type { MediaItem, MediaVisibility } from '../../lib/types';
import { Upload, ExternalLink, Trash2, Loader2, FolderOpen, Lock, Users } from 'lucide-react';

interface Props {
  companyId: string;
  /** Whose media this is. null = the coach's own files. */
  participantId: string | null;
  /** Only coaches may choose 'private'. */
  canChoosePrivate: boolean;
  title?: string;
  emptyHint?: string;
}

export default function MediaLibrary({ companyId, participantId, canChoosePrivate, title, emptyHint }: Props) {
  const { user } = useAuth();
  const { show } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<MediaVisibility>('private');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listMedia(companyId, participantId);
    setItems(data);
    setLoading(false);
  }, [companyId, participantId]);

  useEffect(() => { load(); }, [load]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !user) return;

    setUploading(true);
    let ok = 0;
    for (const file of files) {
      const { error } = await uploadMedia({
        file,
        companyId,
        participantId,
        uploadedBy: user.id,
        visibility: !canChoosePrivate && pendingVisibility === 'coach_only' ? 'private' : pendingVisibility,
      });
      if (error) show(error, 'error'); else ok++;
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (ok) {
      show(`${ok} file${ok > 1 ? 's' : ''} uploaded.`, 'success');
      load();
    }
  };

  const onOpen = async (item: MediaItem) => {
    setBusyId(item.id);
    const url = await openMedia(item.storage_path);
    setBusyId(null);
    if (!url) { show("Couldn't open that file.", 'error'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const onDelete = async (item: MediaItem) => {
    if (!confirm(`Delete "${item.file_name}"? This cannot be undone.`)) return;
    setBusyId(item.id);
    const ok = await deleteMedia(item);
    setBusyId(null);
    if (!ok) { show("Couldn't delete that file.", 'error'); return; }
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    show('File deleted.', 'success');
  };

  // Coaches can re-scope anything here; others only their own uploads.
  const canEditItem = (item: MediaItem) => canChoosePrivate || item.uploaded_by === user?.id;

  const onChangeVisibility = async (item: MediaItem, next: MediaVisibility) => {
    setBusyId(item.id);
    const ok = await setVisibility(item.id, next);
    setBusyId(null);
    if (!ok) { show("Couldn't update privacy.", 'error'); return; }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, visibility: next } : i)));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {title && <h3 className="font-display text-base font-semibold text-ink-900">{title}</h3>}
          <p className="text-sm text-ink-500">{items.length} file{items.length === 1 ? '' : 's'}</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="input py-2 text-sm w-auto"
            value={pendingVisibility}
            onChange={(e) => setPendingVisibility(e.target.value as MediaVisibility)}
            title="Who can see new uploads"
          >
            <option value="private">Private — this person + coach</option>
            <option value="public">Public — everyone in the company</option>
            {canChoosePrivate && <option value="coach_only">Coach only — hidden from them</option>}
          </select>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={onPick} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary inline-flex items-center gap-2">
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Upload
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-lg bg-ink-100 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={22} />}
          title="No media yet"
          description={emptyHint || 'Upload documents, images, or video to keep everything in one place.'}
        />
      ) : (
        <div className="divide-y divide-ink-100 rounded-xl border border-ink-200 bg-white overflow-hidden">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50/50">
              <span className="shrink-0 rounded-md bg-ink-100 px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-ink-600">
                {formatLabel(item.file_name)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink-900">{item.file_name}</div>
                <div className="flex items-center gap-2 text-xs text-ink-400">
                  <span>{formatSize(item.file_size)}</span>
                  <span>·</span>
                  <span
                    className={`inline-flex items-center gap-1 ${item.visibility === 'coach_only' ? 'text-amber-700' : 'text-ink-500'}`}
                    title={VISIBILITY_HINT[item.visibility]}
                  >
                    {item.visibility === 'public' ? <Users size={11} /> : <Lock size={11} />}
                    {VISIBILITY_LABEL[item.visibility]}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {canEditItem(item) && (
                  <select
                    value={item.visibility}
                    disabled={busyId === item.id}
                    onChange={(e) => onChangeVisibility(item, e.target.value as MediaVisibility)}
                    className="rounded-md border border-ink-200 bg-white px-1.5 py-1 text-xs text-ink-600 hover:border-ink-300"
                    title="Who can see this file"
                  >
                    <option value="private">Private</option>
                    <option value="public">Public</option>
                    {canChoosePrivate && <option value="coach_only">Coach only</option>}
                  </select>
                )}
                <button
                  onClick={() => onOpen(item)}
                  disabled={busyId === item.id}
                  className="rounded-md p-1.5 text-ink-400 hover:bg-brand-50 hover:text-brand-700"
                  title="Open"
                >
                  {busyId === item.id ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
                </button>
                <button
                  onClick={() => onDelete(item)}
                  disabled={busyId === item.id}
                  className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
