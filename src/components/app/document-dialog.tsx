'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/ui/api';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Opening a piece of evidence, in one click, without leaving the queue.
 *
 * This was a two-step button — fetch, then a second click to open a new tab —
 * because a popup opened after an `await` is what browsers block. It was also
 * indistinguishable from a broken button: the first click changed a label and
 * nothing else, so a reviewer pressed it, saw no document, and reasonably
 * concluded it did not work.
 *
 * Showing it in place fixes both, and is the better shape for the job anyway:
 * the decision buttons are still on screen beside the evidence, so an officer
 * is not reading a certificate in one tab and approving it in another.
 *
 * Fetched on click rather than with the list, because reading a document
 * writes a `credential.document_accessed` security event and the trail should
 * record who actually looked, not who scrolled past.
 */
export function DocumentDialog({
  title,
  description,
  fetchUrl,
}: {
  title: string;
  description?: string;
  /** Returns a short-lived signed URL. Called once per open. */
  fetchUrl: () => Promise<{ url: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: fetchUrl,
    onSuccess: (result) => {
      setUrl(result.url);
      setOpen(true);
    },
    onError: (error) =>
      toast.error('Could not open the document', { description: errorMessage(error) }),
  });

  // The key is opaque and the URL is signed, so neither tells us the type.
  // The extension is the only hint available, and a wrong guess costs nothing:
  // a PDF in an <img> falls back to the "open in a new tab" link underneath.
  const isPdf = url ? new URL(url).pathname.toLowerCase().endsWith('.pdf') : false;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={load.isPending}
        onClick={() => (url ? setOpen(true) : load.mutate())}
      >
        <FileText />
        View document
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          {url ? (
            <>
              <div className="max-h-[70vh] overflow-auto rounded-md border bg-muted">
                {isPdf ? (
                  <iframe src={url} title={title} className="h-[70vh] w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={title} className="mx-auto max-w-full" />
                )}
              </div>

              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-fit')}
              >
                <ExternalLink />
                Open full size in a new tab
              </a>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
