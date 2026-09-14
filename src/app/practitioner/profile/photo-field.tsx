'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2, UserRound } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';

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

  const photo = useQuery({
    queryKey: ['photo-url'],
    queryFn: () => api.post<{ url: string }>('/api/v1/practitioners/me/photo-url'),
    enabled: hasPhoto,
    retry: false,
    // The URL is signed and short-lived; refetching on focus keeps a face
    // that has been on screen a while from quietly turning into a broken image.
    staleTime: 60_000,
  });

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
      toast.success('Photograph saved');
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['photo-url'] });
    },
    onError: (error) =>
      toast.error('Could not save the photograph', { description: errorMessage(error) }),
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
    if (!file) return;

    if (!ACCEPTED.includes(file.type)) {
      setProblem('Use a JPEG, PNG, WebP or HEIC image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setProblem('That image is over 10MB. A photo from a phone camera is usually well under it.');
      return;
    }
    upload.mutate(file);
  }

  const busy = upload.isPending || remove.isPending;

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
        {hasPhoto && photo.data ? (
          // A short-lived signed storage URL, not an asset next/image can
          // optimise without a loader. The disable has to be the line
          // immediately before the element, so the reason sits above it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.data.url}
            alt="Your profile photograph"
            className="size-full object-cover"
          />
        ) : (
          <UserRound className="size-9 text-muted-foreground" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Photograph</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          {profileExists
            ? 'So the ward knows who arrived. A clear head-and-shoulders picture, the way it would appear on an ID badge.'
            : 'Save your details first — a photograph attaches to a profile, and you do not have one yet.'}
        </p>

        {problem ? <p className="mt-2 text-xs text-destructive">{problem}</p> : null}

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED.join(',')}
          className="hidden"
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
            size="sm"
            disabled={!profileExists || busy}
            loading={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {hasPhoto ? 'Replace photograph' : 'Add a photograph'}
          </Button>

          {hasPhoto ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              loading={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
