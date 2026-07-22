import { supabase } from './supabase';
import type { MediaItem, MediaVisibility } from './types';

const MEDIA_BUCKET = 'media';

/** Uppercase format label shown next to each item, e.g. PNG / PDF / MP4. */
export function formatLabel(fileName: string): string {
  const parts = fileName.split('.');
  if (parts.length < 2) return 'FILE';
  return parts.pop()!.toUpperCase().slice(0, 5);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB

export async function listMedia(companyId: string, participantId?: string | null): Promise<MediaItem[]> {
  let q = supabase.from('media_items').select('*').eq('company_id', companyId);
  if (participantId === null) q = q.is('participant_id', null);
  else if (participantId) q = q.eq('participant_id', participantId);

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as MediaItem[];
}

export async function uploadMedia(params: {
  file: File;
  companyId: string;
  participantId: string | null;
  uploadedBy: string;
  visibility: MediaVisibility;
}): Promise<{ item: MediaItem | null; error: string | null }> {
  const { file, companyId, participantId, uploadedBy, visibility } = params;

  if (file.size > MAX_MEDIA_BYTES) {
    return { item: null, error: 'File is larger than 50MB.' };
  }

  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin';
  const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${companyId}/${participantId || 'coach'}/${safe}`;

  const { error: upErr } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (upErr) return { item: null, error: 'Upload failed. Please try again.' };

  const { data, error } = await supabase
    .from('media_items')
    .insert({
      company_id: companyId,
      participant_id: participantId,
      uploaded_by: uploadedBy,
      file_name: file.name,
      storage_path: path,
      file_size: file.size,
      mime_type: file.type || null,
      visibility,
    })
    .select()
    .maybeSingle();

  if (error || !data) {
    // Roll back the orphaned object so storage doesn't drift from the table.
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    return { item: null, error: "Saved the file but couldn't record it. Please try again." };
  }

  return { item: data as MediaItem, error: null };
}

/** Signed URL for viewing — storage RLS still applies. */
export async function openMedia(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export async function deleteMedia(item: MediaItem): Promise<boolean> {
  const { error } = await supabase.from('media_items').delete().eq('id', item.id);
  if (error) return false;
  await supabase.storage.from(MEDIA_BUCKET).remove([item.storage_path]);
  return true;
}

export async function setVisibility(id: string, visibility: MediaVisibility): Promise<boolean> {
  const { error } = await supabase.from('media_items').update({ visibility }).eq('id', id);
  return !error;
}

export const VISIBILITY_LABEL: Record<MediaVisibility, string> = {
  one_on_one: '1-on-1',
  private: 'Private',
};

export const VISIBILITY_HINT: Record<MediaVisibility, string> = {
  one_on_one: 'Visible to this person and their coach',
  private: 'Visible to coaches only',
};
