'use client';

import { useRef, useState } from 'react';
import { CircleCheck, Paperclip, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** What the storage layer accepts. Kept in step with ALLOWED_CONTENT_TYPES. */
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_BYTES = 10 * 1024 * 1024;

export interface UploadedDocument {
  objectKey: string;
  filename: string;
}

interface UploadUrl {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

function readableSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Picking a file and putting it where the API expects to find it.
 *
 * Three steps behind one control: ask for a signed URL, send the bytes
 * straight to storage, hand the key back to the caller. **The file never
 * passes through this application**, which is the point of the signed-URL
 * flow — a credential scan is somebody's medical evidence and there is no
 * reason for it to touch a request log on the way past.
 *
 * The type and size are checked here *and* server-side. The duplication is
 * deliberate: the server check is the one that matters, and the client one
 * means somebody does not wait for a 10MB upload to be told it was too big.
 */
export function DocumentUpload({
  endpoint,
  onUploaded,
  value,
  label = 'Attach the document',
  hint,
}: {
  /** Where to ask for the signed URL. Each module has its own. */
  endpoint: string;
  onUploaded: (document: UploadedDocument | null) => void;
  value: UploadedDocument | null;
  label?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError('That file type is not accepted. Use a PDF or a photograph.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${readableSize(file.size)}. The limit is 10 MB.`);
      return;
    }

    setBusy(true);
    try {
      const signed = await api.post<UploadUrl>(endpoint, {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      // Straight to storage, not through this application.
      const response = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Storage refused the file (${response.status}).`);
      }

      onUploaded({ objectKey: signed.objectKey, filename: file.name });
    } catch (caught) {
      setError(
        caught instanceof Error && !('failure' in caught)
          ? caught.message
          : errorMessage(caught),
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-success/40 bg-success/5 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <CircleCheck className="size-4 shrink-0 text-success" />
          <span className="truncate">{value.filename}</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onUploaded(null);
            setError(null);
          }}
        >
          <X />
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
        disabled={busy}
        className={cn(
          'flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-primary bg-accent' : 'hover:bg-muted/50',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <Paperclip className="size-5 text-muted-foreground" />
        <span className="text-sm font-medium">{busy ? 'Uploading…' : label}</span>
        <span className="text-xs text-muted-foreground">
          {hint ?? 'A PDF or a clear photograph, up to 10 MB.'}
        </span>
      </button>

      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={ACCEPTED.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
