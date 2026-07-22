import { supabase } from './supabase';

const BUCKET = 'portal-files';

export interface StoredFile {
  id?: string;
  name: string;
  path: string;
  size: number;
  type: string;
}

function fileExtension(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

export function isAllowedFile(name: string): boolean {
  const ext = fileExtension(name);
  const allowed = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'csv', 'md'];
  return allowed.includes(ext);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(name: string): string {
  const ext = fileExtension(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx'].includes(ext)) return 'slides';
  return 'file';
}

export async function uploadFile(
  folder: string,
  ownerId: string,
  file: File,
  refId?: string
): Promise<StoredFile | null> {
  const ext = fileExtension(file.name);
  const fileName = `${ownerId.slice(0, 8)}-${Date.now()}.${ext}`;
  const filePath = `${folder}/${fileName}`;

  const { error } = await supabase.storage.from(BUCKET).upload(filePath, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) return null;

  if (refId) {
    await supabase.from('file_attachments').insert({
      folder,
      ref_id: refId,
      file_name: file.name,
      storage_path: filePath,
      file_size: file.size,
      mime_type: file.type,
      owner_id: ownerId,
    });
  }

  return { name: file.name, path: filePath, size: file.size, type: file.type };
}

export async function uploadFiles(
  folder: string,
  ownerId: string,
  files: File[],
  refId?: string
): Promise<StoredFile[]> {
  const results: StoredFile[] = [];
  for (const file of files) {
    const result = await uploadFile(folder, ownerId, file, refId);
    if (result) {
      results.push(result);
    }
  }
  return results;
}

export async function getFileUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return;
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function deleteFile(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

export async function listFiles(folder: string, refId: string): Promise<StoredFile[]> {
  const { data, error } = await supabase
    .from('file_attachments')
    .select('id, file_name, storage_path, file_size, mime_type')
    .eq('folder', folder)
    .eq('ref_id', refId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    name: row.file_name,
    path: row.storage_path,
    size: row.file_size,
    type: row.mime_type || '',
  }));
}

export async function deleteFileMetadata(fileId: string, storagePath: string): Promise<boolean> {
  await supabase.storage.from(BUCKET).remove([storagePath]);
  const { error } = await supabase.from('file_attachments').delete().eq('id', fileId);
  return !error;
}
