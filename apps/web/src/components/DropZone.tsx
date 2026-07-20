'use client';

/**
 * Reusable drag-and-drop upload component (CR-001 Sprint OCR-02
 * Extension — "Implement a reusable drag-and-drop upload component
 * inside the existing Milaserv360 design system"). Domain-agnostic: the
 * caller supplies the upload URL, headers, and extra form fields, so
 * this isn't tied to prescriptions — any future upload feature reuses it
 * as-is.
 *
 * Owns the actual upload (XMLHttpRequest, not fetch) so it can report
 * real progress and support cancel — a caller-supplied async function
 * couldn't do either.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

export type DropZoneFileStatus =
  'queued' | 'uploading' | 'success' | 'error' | 'duplicate' | 'canceled';

export interface DropZoneFile {
  id: string;
  file: File;
  status: DropZoneFileStatus;
  progress: number;
  error?: string;
  previewUrl?: string;
  responseJson?: unknown;
  duplicateOfLabel?: string;
}

export interface DropZoneProps {
  /** MIME types accepted, e.g. ['image/jpeg','image/png','image/webp','application/pdf'].
   *  Also drives the native file input's `accept` attribute. Configurable per design doc. */
  accept: string[];
  maxSizeMb: number;
  multiple?: boolean;
  maxFiles?: number;
  uploadUrl: string;
  headers?: () => Record<string, string>;
  /** Extra multipart fields per file — e.g. `{ clipboardPasted: 'true' }`. */
  buildExtraFields?: (
    file: File,
    source: 'drop' | 'browse' | 'paste' | 'camera',
  ) => Record<string, string>;
  /** Called once per file after its upload settles (success or error). */
  onFileSettled?: (file: DropZoneFile) => void;
  /** Reads a caller-defined "duplicate of" hint out of the parsed JSON response. */
  extractDuplicateLabel?: (responseJson: unknown) => string | undefined;
  label?: string;
  hint?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isDuplicateInList(list: DropZoneFile[], file: File): boolean {
  return list.some(
    (f) =>
      f.file.name === file.name &&
      f.file.size === file.size &&
      f.file.lastModified === file.lastModified,
  );
}

export function DropZone({
  accept,
  maxSizeMb,
  multiple = true,
  maxFiles,
  uploadUrl,
  headers,
  buildExtraFields,
  onFileSettled,
  extractDuplicateLabel,
  label,
  hint,
}: DropZoneProps) {
  const t = useTranslations();
  const inputId = useId();
  const cameraInputId = useId();
  const [files, setFiles] = useState<DropZoneFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const xhrs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const dropRef = useRef<HTMLDivElement>(null);

  // Runs once on unmount, cleaning up whatever files are still held via
  // the ref (avoids needing `files` in the dependency array).
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    };
  }, []);

  const validate = useCallback(
    (file: File): string | null => {
      if (accept.length > 0 && !accept.includes(file.type)) {
        return t('dropzone.errorType', { types: accept.join(', ') });
      }
      if (file.size > maxSizeMb * 1024 * 1024) {
        return t('dropzone.errorSize', { maxSizeMb });
      }
      return null;
    },
    [accept, maxSizeMb, t],
  );

  const uploadFile = useCallback(
    (entry: DropZoneFile, source: 'drop' | 'browse' | 'paste' | 'camera') => {
      const xhr = new XMLHttpRequest();
      xhrs.current.set(entry.id, xhr);
      const form = new FormData();
      form.append('file', entry.file);
      const extra = buildExtraFields?.(entry.file, source) ?? {};
      for (const [key, value] of Object.entries(extra)) form.append(key, value);

      xhr.open('POST', uploadUrl);
      const hdrs = headers?.() ?? {};
      for (const [key, value] of Object.entries(hdrs)) xhr.setRequestHeader(key, value);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const progress = Math.round((e.loaded / e.total) * 100);
        setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, progress } : f)));
      };

      xhr.onload = () => {
        xhrs.current.delete(entry.id);
        let json: unknown = null;
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          // non-JSON error body — fall through to status handling below
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          const duplicateOfLabel = extractDuplicateLabel?.(json);
          const settled: DropZoneFile = {
            ...entry,
            status: duplicateOfLabel ? 'duplicate' : 'success',
            progress: 100,
            responseJson: json,
            duplicateOfLabel,
          };
          setFiles((prev) => prev.map((f) => (f.id === entry.id ? settled : f)));
          onFileSettled?.(settled);
        } else {
          const message =
            (json as { message?: string } | null)?.message ??
            t('dropzone.errorUpload', { status: xhr.status });
          const settled: DropZoneFile = { ...entry, status: 'error', error: message };
          setFiles((prev) => prev.map((f) => (f.id === entry.id ? settled : f)));
          onFileSettled?.(settled);
        }
      };
      xhr.onerror = () => {
        xhrs.current.delete(entry.id);
        const settled: DropZoneFile = {
          ...entry,
          status: 'error',
          error: t('dropzone.errorNetwork'),
        };
        setFiles((prev) => prev.map((f) => (f.id === entry.id ? settled : f)));
        onFileSettled?.(settled);
      };
      xhr.onabort = () => {
        xhrs.current.delete(entry.id);
        setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, status: 'canceled' } : f)));
      };

      setFiles((prev) =>
        prev.map((f) => (f.id === entry.id ? { ...f, status: 'uploading', progress: 0 } : f)),
      );
      xhr.send(form);
    },
    [uploadUrl, headers, buildExtraFields, extractDuplicateLabel, onFileSettled, t],
  );

  const addFiles = useCallback(
    (incoming: FileList | File[], source: 'drop' | 'browse' | 'paste' | 'camera') => {
      const list = Array.from(incoming);
      setFiles((prev) => {
        const room = maxFiles ? Math.max(0, maxFiles - prev.length) : list.length;
        const toAdd = (multiple ? list : list.slice(0, 1)).slice(0, room);
        const entries: DropZoneFile[] = toAdd.map((file) => {
          const validationError = validate(file);
          const duplicate = isDuplicateInList(prev, file);
          const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
          return {
            id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
            file,
            status: validationError ? 'error' : duplicate ? 'duplicate' : 'queued',
            progress: 0,
            error: validationError ?? (duplicate ? t('dropzone.duplicateInBatch') : undefined),
            previewUrl,
            duplicateOfLabel: duplicate ? t('dropzone.duplicateInBatch') : undefined,
          };
        });
        const next = [...prev, ...entries];
        // Kick off uploads for everything that passed validation and
        // isn't a same-batch duplicate.
        entries.filter((e) => e.status === 'queued').forEach((e) => uploadFile(e, source));
        return next;
      });
    },
    [multiple, maxFiles, validate, uploadFile, t],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files, 'drop');
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length) addFiles(imageFiles, 'paste');
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const removeFile = (id: string) => {
    xhrs.current.get(id)?.abort();
    xhrs.current.delete(id);
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const cancelUpload = (id: string) => {
    xhrs.current.get(id)?.abort();
  };

  const retryUpload = (id: string) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.id === id);
      if (entry) uploadFile({ ...entry, error: undefined }, 'browse');
      return prev;
    });
  };

  const moveFile = (id: string, direction: -1 | 1) => {
    setFiles((prev) => {
      const index = prev.findIndex((f) => f.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const moved = next.splice(index, 1)[0]!;
      next.splice(target, 0, moved);
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      document.getElementById(inputId)?.click();
    }
  };

  const statusLabel = (status: DropZoneFileStatus) => t(`dropzone.status.${status}`);

  return (
    <div>
      {/* Keyboard-accessible: role="button" + tabIndex + onKeyDown (Enter/Space) below. */}
      <div
        ref={dropRef}
        role="button"
        tabIndex={0}
        aria-label={label ?? t('dropzone.label')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => document.getElementById(inputId)?.click()}
        onKeyDown={onKeyDown}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-[#0b2545]/40 ${
          dragActive
            ? 'border-[#0b2545] bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <span className="text-3xl">📎</span>
        <p className="mt-2 text-sm font-medium text-gray-700">{label ?? t('dropzone.label')}</p>
        <p className="mt-1 text-xs text-gray-400">{hint ?? t('dropzone.hint')}</p>
        <div className="mt-3 flex gap-2">
          <span className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700">
            {t('dropzone.browseBtn')}
          </span>
          <label
            htmlFor={cameraInputId}
            onClick={(e) => e.stopPropagation()}
            className="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('dropzone.cameraBtn')}
          </label>
        </div>
      </div>

      <input
        id={inputId}
        type="file"
        multiple={multiple}
        accept={accept.join(',')}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files, 'browse');
          e.target.value = '';
        }}
      />
      <input
        id={cameraInputId}
        type="file"
        accept={accept.filter((a) => a.startsWith('image/')).join(',') || 'image/*'}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files, 'camera');
          e.target.value = '';
        }}
      />

      {files.length > 0 && (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {files.map((f, index) => (
            <li
              key={f.id}
              className="flex items-center gap-3 rounded-md border border-gray-200 bg-white p-2"
            >
              {f.previewUrl ? (
                // A local object URL — never a remote/signed URL, so a plain <img> is correct here.
                <img src={f.previewUrl} alt="" className="h-12 w-12 rounded object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded bg-gray-100 text-lg">
                  📄
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-gray-800">{f.file.name}</span>
                  <span className="shrink-0 text-xs text-gray-400" dir="ltr">
                    {formatBytes(f.file.size)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-xs">
                  <StatusBadge status={f.status} label={statusLabel(f.status)} />
                  {f.status === 'uploading' && (
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full bg-[#0b2545] transition-all"
                        style={{ width: `${f.progress}%` }}
                      />
                    </div>
                  )}
                  {f.error && <span className="text-red-600">{f.error}</span>}
                  {f.duplicateOfLabel && f.status !== 'error' && (
                    <span className="text-amber-700">{f.duplicateOfLabel}</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {index > 0 && (
                  <button
                    type="button"
                    aria-label={t('dropzone.moveUp')}
                    onClick={() => moveFile(f.id, -1)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    ↑
                  </button>
                )}
                {index < files.length - 1 && (
                  <button
                    type="button"
                    aria-label={t('dropzone.moveDown')}
                    onClick={() => moveFile(f.id, 1)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    ↓
                  </button>
                )}
                {f.status === 'uploading' && (
                  <button
                    type="button"
                    onClick={() => cancelUpload(f.id)}
                    className="rounded p-1 text-xs text-gray-500 hover:bg-gray-100"
                  >
                    {t('dropzone.cancelBtn')}
                  </button>
                )}
                {f.status === 'error' && (
                  <button
                    type="button"
                    onClick={() => retryUpload(f.id)}
                    className="rounded p-1 text-xs text-blue-600 hover:bg-blue-50"
                  >
                    {t('dropzone.retryBtn')}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t('dropzone.removeBtn')}
                  onClick={() => removeFile(f.id)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status, label }: { status: DropZoneFileStatus; label: string }) {
  const tones: Record<DropZoneFileStatus, string> = {
    queued: 'bg-gray-100 text-gray-600',
    uploading: 'bg-blue-100 text-blue-700',
    success: 'bg-green-100 text-green-700',
    duplicate: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
    canceled: 'bg-gray-100 text-gray-500',
  };
  return <span className={`rounded-full px-2 py-0.5 font-medium ${tones[status]}`}>{label}</span>;
}
