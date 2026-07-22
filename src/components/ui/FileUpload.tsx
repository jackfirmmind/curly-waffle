import { useRef, useState } from 'react';
import { Upload, FileText, Image, File, Download, Trash2 } from 'lucide-react';
import { uploadFiles, isAllowedFile, formatFileSize, fileIcon, downloadFile, type StoredFile } from '../../lib/storage';
import { useToast } from './Toast';

interface Props {
  folder: string;
  refId: string;
  ownerId: string;
  files: StoredFile[];
  onUploaded: () => void;
  onDelete?: (fileId: string, path: string) => void;
  canDelete?: boolean;
  compact?: boolean;
}

export default function FileUpload({ folder, refId, ownerId, files, onUploaded, onDelete, canDelete, compact }: Props) {
  const { show } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const valid = Array.from(fileList).filter((f) => {
      if (!isAllowedFile(f.name)) {
        show(`${f.name}: file type not allowed.`, 'error');
        return false;
      }
      if (f.size > 25 * 1024 * 1024) {
        show(`${f.name}: max 25MB.`, 'error');
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;
    setUploading(true);
    const result = await uploadFiles(folder, ownerId, valid, refId);
    setUploading(false);
    if (result.length > 0) {
      show(`${result.length} file${result.length > 1 ? 's' : ''} uploaded.`);
      onUploaded();
    } else {
      show('Upload failed.', 'error');
    }
  };

  const iconFor = (name: string) => {
    const t = fileIcon(name);
    if (t === 'image') return <Image size={16} />;
    if (t === 'pdf') return <FileText size={16} />;
    return <File size={16} />;
  };

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed cursor-pointer transition-colors ${dragOver ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50/50'} ${compact ? 'py-4' : 'py-6'}`}
      >
        <Upload size={20} className="text-ink-400" />
        <p className="mt-1.5 text-sm text-ink-600 font-medium">
          {uploading ? 'Uploading...' : 'Click or drag files'}
        </p>
        {!compact && <p className="text-xs text-ink-400 mt-0.5">PDF, DOCX, images · max 25MB</p>}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map((f) => (
            <div key={f.id || f.path} className="flex items-center gap-2.5 rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-ink-500">
                {iconFor(f.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{f.name}</p>
                <p className="text-xs text-ink-400">{formatFileSize(f.size)}</p>
              </div>
              <button
                onClick={() => downloadFile(f.path, f.name)}
                className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                aria-label="Download"
              >
                <Download size={14} />
              </button>
              {canDelete && onDelete && f.id && (
                <button
                  onClick={() => f.id && onDelete(f.id, f.path)}
                  className="rounded-md p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
