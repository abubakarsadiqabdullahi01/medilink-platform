'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCw, Trash2, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { usePhoto } from '@/lib/ui/practitioner';
import { useSession } from '@/lib/ui/session';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/app/avatar';

/**
 * The profile photograph.
 *
 * The API has had `photo-upload-url` since 5.1 and nothing ever called it, so
 * the field existed in the database and could not be filled. Three steps, the
 * middle one not through our own API at all:
 *
 *   1. ask for a signed PUT URL
 *   2. send the bytes **straight to storage** — they never pass through the app
 *   3. name the object on the profile, which is what makes it real
 *
 * Step 3 is separate on purpose: an upload that lands but is never referenced
 * is an orphan the sweep can collect, whereas a profile pointing at bytes that
 * never arrived would be a broken face on a ward list.
 */

/** Kept in step with ALLOWED_CONTENT_TYPES; PDFs are allowed there but not a face. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_BYTES = 10 * 1024 * 1024;

interface UploadTicket {
  objectKey: string;
  uploadUrl: string;
}

export function PhotoField({
  hasPhoto,
  profileExists,
}: {
  hasPhoto: boolean;
  profileExists: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The file that did not save, kept so "Try again" does not mean finding it in the gallery again.
  const [failed, setFailed] = useState<{ file: File; message: string } | null>(null);

  // The same photograph the top bar and the profile header show, from one
  // query, so a change here changes all three.
  const photo = usePhoto();
  const session = useSession();

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const ticket = await api.post<UploadTicket>('/api/v1/practitioners/me/photo-upload-url', {
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!response.ok) {
        throw new Error(`Storage refused the upload (${response.status}).`);
      }

      await api.patch('/api/v1/practitioners/me', { photoObjectKey: ticket.objectKey });
    },
    onSuccess: () => {
      setFailed(null);
      toast.success('Photograph saved');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['photo-url'] });
    },
    onError: (error, file) => setFailed({ file, message: errorMessage(error) }),
  });

  const remove = useMutation({
    mutationFn: () => api.patch('/api/v1/practitioners/me', { photoObjectKey: null }),
    onSuccess: () => {
      toast.success('Photograph removed');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['photo-url'] });
    },
    onError: (error) => toast.error('Could not remove it', { description: errorMessage(error) }),
  });

  function choose(file: File | undefined) {
    setProblem(null);
    setFailed(null);
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      setProblem(`${file.name}: use a JPEG, PNG, WebP or HEIC image.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setProblem(
        `${file.name} is over 10 MB. A photo from a phone camera is usually well under it.`,
      );
      return;
    }
    upload.mutate(file);
  }

  const busy = upload.isPending || remove.isPending;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
      <Avatar name={session.user.fullName} src={photo.url} size="xl" />

      <div className="min-w-0 flex-1">
        <p id="photo-field-label" className="text-base font-medium leading-snug">
          Photograph <span className="font-normal text-muted-foreground">(optional)</span>
        </p>
        <p
          id="photo-field-help"
          className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground"
        >
          {profileExists
            ? 'So the ward knows who arrived. A clear head-and-shoulders picture, the way it would appear on an ID badge.'
            : 'Save your details first — a photograph attaches to a profile, and you do not have one yet.'}
        </p>

        {problem ? (
          <p
            role="alert"
            className="mt-2 flex items-start gap-1.5 text-sm font-medium text-destructive-text"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {problem}
          </p>
        ) : null}

        {failed ? (
          <div role="alert" className="mt-2 space-y-2 text-sm">
            <p className="flex items-start gap-1.5 font-medium text-destructive-text">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {failed.file.name} was not saved. {failed.message}
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              loading={upload.isPending}
              onClick={() => upload.mutate(failed.file)}
            >
              <RotateCw />
              Try again
            </Button>
          </div>
        ) : null}

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED.join(',')}
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            // Cleared so picking the same file twice still fires a change.
            event.target.value = '';
          }}
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!profileExists || busy}
            loading={upload.isPending}
            aria-describedby="photo-field-help"
            onClick={() => fileInput.current?.click()}
          >
            {hasPhoto ? 'Replace photograph' : 'Add a photograph'}
          </Button>

          {hasPhoto ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 />
              Remove photograph
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
