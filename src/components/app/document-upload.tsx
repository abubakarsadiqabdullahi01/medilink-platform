'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Paperclip, RotateCw, TriangleAlert, X } from 'lucide-react';
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
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Why a PUT to storage did not finish, in words a person can act on. */
class StorageFailure extends Error {}
class UploadCancelled extends Error {}

/**
 * Sends the bytes to storage and reports how far they have got.
 *
 * `fetch` cannot say how much of a request body has gone, and on a weak connection a ten
 * megabyte photograph is a minute of nothing happening — long enough that people press the
 * button again or give up. `XMLHttpRequest` can, so the control shows a real percentage. The
 * request is the same: one `PUT` of the file to the signed address, with its content type.
 */
function putToStorage(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new StorageFailure(`Storage refused the file (${request.status}).`));
    request.onerror = () =>
      reject(new StorageFailure('The connection dropped before the file finished uploading.'));
    request.ontimeout = request.onerror;
    request.onabort = () => reject(new UploadCancelled());
    if (signal.aborted) {
      reject(new UploadCancelled());
      return;
    }
    signal.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}

type Attempt =
  | { file: File; phase: 'uploading'; fraction: number }
  | { file: File; phase: 'failed'; message: string };

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
 *
 * While it uploads it says which file and how much has gone, and can be stopped. When it fails
 * it keeps the file the person chose — "Try again" does not make them find it in their phone's
 * gallery a second time — and says what went wrong in plain words.
 */
export function DocumentUpload({
  endpoint,
  onUploaded,
  value,
  label = 'Attach the document',
  hint,
  labelledBy,
  describedBy,
}: {
  /** Where to ask for the signed URL. Each module has its own. */
  endpoint: string;
  onUploaded: (document: UploadedDocument | null) => void;
  value: UploadedDocument | null;
  label?: string;
  hint?: string;
  /** The id of the visible label that names this control, when the page draws one. */
  labelledBy?: string;
  /** The id of text that explains it (why a photograph is wanted, what is accepted). */
  describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // A control that goes away mid-upload (the person moved on) stops the transfer.
  useEffect(() => () => controller.current?.abort(), []);

  async function upload(file: File) {
    setProblem(null);

    if (!ACCEPTED.includes(file.type)) {
      setAttempt(null);
      setProblem(`${file.name}: that file type is not accepted. Use a PDF or a photograph.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setAttempt(null);
      setProblem(`${file.name} is ${readableSize(file.size)}. The limit is 10 MB.`);
      return;
    }

    const own = new AbortController();
    controller.current = own;
    setAttempt({ file, phase: 'uploading', fraction: 0 });

    try {
      const signed = await api.post<UploadUrl>(endpoint, {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (own.signal.aborted) throw new UploadCancelled();

      // Straight to storage, not through this application.
      await putToStorage(
        signed.uploadUrl,
        file,
        (fraction) =>
          setAttempt((current) =>
            current && current.phase === 'uploading' && current.file === file
              ? { ...current, fraction }
              : current,
          ),
        own.signal,
      );

      setAttempt(null);
      onUploaded({ objectKey: signed.objectKey, filename: file.name });
    } catch (caught) {
      if (caught instanceof UploadCancelled) {
        setAttempt(null);
        return;
      }
      setAttempt({
        file,
        phase: 'failed',
        message:
          caught instanceof StorageFailure
            ? caught.message
            : caught instanceof Error && !('failure' in caught)
              ? caught.message
              : errorMessage(caught),
      });
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  if (value) {
    return (
      <div
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="flex items-center justify-between gap-3 rounded-md border border-success/40 bg-success/5 px-3 py-2"
      >
        <span role="status" className="flex min-w-0 items-center gap-2 text-base">
          <CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{value.filename}</span>
            <span className="block text-sm text-muted-foreground">Uploaded and ready to send</span>
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          aria-label={`Remove ${value.filename}`}
          onClick={() => {
            onUploaded(null);
            setProblem(null);
          }}
        >
          <X />
          Remove
        </Button>
      </div>
    );
  }

  const uploading = attempt?.phase === 'uploading' ? attempt : null;
  const failed = attempt?.phase === 'failed' ? attempt : null;

  if (uploading) {
    const percent = Math.round(uploading.fraction * 100);
    return (
      <div
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="space-y-2 rounded-md border px-3 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-medium">{uploading.file.name}</span>
            <span className="block text-sm text-muted-foreground">
              Uploading · {readableSize(uploading.file.size)}
            </span>
          </span>
          <Button
            type="button"
            variant="outline"
            aria-label={`Stop uploading ${uploading.file.name}`}
            onClick={() => controller.current?.abort()}
          >
            <X />
            Stop
          </Button>
        </div>
        <div
          role="progressbar"
          aria-label={`Uploading ${uploading.file.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="tabular text-sm text-muted-foreground">{percent}% sent</p>
        {/* Said once, not on every percent: the bar above carries the numbers. */}
        <p role="status" className="sr-only">
          Uploading {uploading.file.name}
        </p>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="space-y-2"
    >
      {failed ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription className="space-y-3">
            <p>
              <strong>{failed.file.name}</strong> was not uploaded. {failed.message}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void upload(failed.file)}>
                <RotateCw />
                Try again
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setAttempt(null);
                  input.current?.click();
                }}
              >
                Choose a different file
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
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
          className={cn(
            'flex min-h-11 w-full flex-col items-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors',
            dragging ? 'border-primary bg-accent' : 'hover:bg-muted/50',
          )}
        >
          <Paperclip className="size-5 text-muted-foreground" aria-hidden="true" />
          <span className="text-base font-medium">{label}</span>
          <span className="text-sm text-muted-foreground">
            {hint ?? 'A PDF or a clear photograph, up to 10 MB.'}
          </span>
        </button>
      )}

      <input
        ref={input}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        accept={ACCEPTED.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {problem ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-sm font-medium text-destructive-text"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {problem}
        </p>
      ) : null}
    </div>
  );
}
