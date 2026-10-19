'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileUp, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import {
  DECISION_REASON_WORDS,
  DISPUTE_REASON_MIN_LENGTH,
  type DecisionReasonValue,
} from '@/modules/disputes/domain/dispute';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { formatAgo, formatWhen } from '@/components/app/format';

/**
 * One case, read by one of its two sides.
 *
 * The facility and the practitioner see the same thing and can do the same things, so this is
 * one screen with two ways in: a facility member names the facility they act for, a practitioner
 * acts as themselves. What each is shown is the server's to say — the case without who raised,
 * replied to or decided it as people, and the evidence by side — and this only draws it.
 *
 * It does four things for a party: reads the case and what has been attached, adds evidence,
 * writes the one reply the other side is asked for, and takes back a case their own side raised.
 */

export type CaseViewer = { side: 'FACILITY'; facilityId: string } | { side: 'PRACTITIONER' };

/** What a list row and the case itself both carry. */
export interface PartyCase {
  id: string;
  category: string;
  reason: string;
  status: string;
  outcome: string | null;
  decisionReason: DecisionReasonValue | null;
  resolutionNotes: string | null;
  raisedParty: 'PRACTITIONER' | 'FACILITY';
  createdAt: string;
  respondBy: string;
  responseNote: string | null;
  respondedAt: string | null;
  responseOverdue: boolean;
}

interface Evidence {
  id: string;
  note: string | null;
  createdAt: string;
  attachedBySide: 'PRACTITIONER' | 'FACILITY';
  bySide: boolean;
}

const LIVE = ['OPEN', 'UNDER_REVIEW'];
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_BYTES = 10 * 1024 * 1024;

/** How this viewer says who is who. */
function wording(viewer: CaseViewer) {
  return viewer.side === 'FACILITY'
    ? { other: 'the practitioner', otherCap: 'The practitioner', colleague: 'Your colleague' }
    : { other: 'the facility', otherCap: 'The facility', colleague: 'Someone at your side' };
}

/** The party's own scope on a read, and on a write. */
function readScope(viewer: CaseViewer): string {
  return viewer.side === 'FACILITY' ? `facilityId=${viewer.facilityId}` : 'as=self';
}
function writeScope(viewer: CaseViewer): { facilityId?: string } {
  return viewer.side === 'FACILITY' ? { facilityId: viewer.facilityId } : {};
}

export function PartyCaseDialog({
  viewer,
  row,
  title,
  description,
  listKey,
  onClose,
}: {
  viewer: CaseViewer;
  row: PartyCase;
  /** The heading and the line under it: what the case is over, which differs by side. */
  title: string;
  description: React.ReactNode;
  /** The list this case sits in, refreshed when anything about it changes. */
  listKey: readonly unknown[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const words = wording(viewer);

  const detail = useQuery({
    queryKey: ['party-dispute', row.id],
    queryFn: () =>
      api.get<{ dispute: PartyCase; side: string; evidence: Evidence[] }>(
        `/api/v1/disputes/${row.id}?${readScope(viewer)}`,
      ),
  });

  // The case as it is now, not as the list had it: a reply written a moment ago has to show.
  const current = detail.data?.dispute ?? row;
  const evidence = detail.data?.evidence ?? [];
  const live = LIVE.includes(current.status);
  const raisedByYou = current.raisedParty === viewer.side;
  const mustReply = live && !raisedByYou && current.respondedAt === null;
  const replyLength = reply.trim().length;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['party-dispute', row.id] });
    void queryClient.invalidateQueries({ queryKey: [...listKey] });
  }

  const attach = useMutation({
    mutationFn: async (file: File) => {
      const ticket = await api.post<{ objectKey: string; uploadUrl: string }>(
        `/api/v1/disputes/${row.id}/evidence/upload-url`,
        { ...writeScope(viewer), filename: file.name, contentType: file.type, sizeBytes: file.size },
      );
      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!response.ok) throw new Error(`Storage refused the upload (${response.status}).`);
      await api.post(`/api/v1/disputes/${row.id}/evidence`, {
        ...writeScope(viewer),
        objectKey: ticket.objectKey,
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Added to the case', { description: 'It cannot be removed, by either side.' });
      setNote('');
      refresh();
    },
    onError: (error) => toast.error('Could not add it', { description: errorMessage(error) }),
  });

  const respond = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/disputes/${row.id}/respond`, { ...writeScope(viewer), response: reply.trim() }),
    onSuccess: () => {
      toast.success('Reply sent', { description: 'It is written once and cannot be changed.' });
      setReply('');
      refresh();
    },
    onError: (error) => toast.error('Could not send it', { description: errorMessage(error) }),
  });

  const withdraw = useMutation({
    mutationFn: () => api.post(`/api/v1/disputes/${row.id}/withdraw`, writeScope(viewer)),
    onSuccess: () => {
      toast.success('Withdrawn', { description: 'The case stays on record, marked withdrawn.' });
      refresh();
      onClose();
    },
    onError: (error) => toast.error('Could not withdraw it', { description: errorMessage(error) }),
  });

  async function open(item: Evidence) {
    try {
      const { url } = await api.post<{ url: string }>(
        `/api/v1/disputes/${row.id}/evidence/${item.id}/url`,
        writeScope(viewer),
      );
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      toast.error('Could not open it', { description: errorMessage(error) });
    }
  }

  function choose(file: File | undefined) {
    setProblem(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setProblem('Use a PDF, or a JPEG, PNG, WebP or HEIC image.');
    if (file.size > MAX_BYTES) return setProblem('That file is larger than 10 MB.');
    attach.mutate(file);
    if (fileInput.current) fileInput.current.value = '';
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {/* Beside the description, not inside it: a badge is a block, a description a paragraph. */}
          <div>
            <StatusBadge status={current.status} />
          </div>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What was raised
            </p>
            <p className="mt-1 whitespace-pre-wrap">{current.reason}</p>
          </div>

          {current.status === 'RESOLVED' ? (
            <Alert variant={current.outcome === 'UPHELD' ? 'warning' : 'info'}>
              <AlertDescription className="space-y-1">
                <p>
                  <strong>Decided: {current.outcome === 'UPHELD' ? 'upheld' : 'dismissed'}.</strong>
                  {current.decisionReason ? ` ${DECISION_REASON_WORDS[current.decisionReason]}` : ''}
                </p>
                {current.resolutionNotes ? <p>{current.resolutionNotes}</p> : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {/* The other side's one reply, or the lack of it. A reply-by date is a marker: nothing
              locks when it passes, and the text says so rather than implying it does. */}
          <div data-testid="dispute-reply">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {raisedByYou ? `${words.otherCap}’s reply` : 'Your reply'}
            </p>
            {current.respondedAt && current.responseNote ? (
              <>
                <p className="mt-1 whitespace-pre-wrap">{current.responseNote}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Written {formatWhen(current.respondedAt)}
                  {new Date(current.respondedAt) > new Date(current.respondBy)
                    ? ', after the reply-by date'
                    : ''}
                  .
                </p>
              </>
            ) : live ? (
              <>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">
                    {raisedByYou ? `${words.otherCap} is asked to reply by` : 'You are asked to reply by'}{' '}
                    {formatWhen(current.respondBy)}.
                  </span>
                  {current.responseOverdue ? <Badge variant="warning">Past the date</Badge> : null}
                </div>
                {current.responseOverdue ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {raisedByYou
                      ? 'The officer can decide without it.'
                      : 'You can still reply while the case is open, but the officer can decide without it.'}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-muted-foreground">
                {raisedByYou ? `${words.otherCap} did not reply.` : 'You did not reply.'}
              </p>
            )}

            {mustReply ? (
              <div className="mt-3 space-y-2">
                <Label htmlFor="dispute-reply">Your side of it</Label>
                <Textarea
                  id="dispute-reply"
                  rows={4}
                  maxLength={2000}
                  placeholder={`What happened, from your side. ${words.otherCap} and the officer both read it.`}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                {replyLength > 0 && replyLength < DISPUTE_REASON_MIN_LENGTH ? (
                  <p className="text-xs text-muted-foreground">
                    A little more — {DISPUTE_REASON_MIN_LENGTH - replyLength} characters to go.
                  </p>
                ) : null}
                <Button
                  disabled={replyLength < DISPUTE_REASON_MIN_LENGTH}
                  loading={respond.isPending}
                  onClick={() => respond.mutate()}
                >
                  Send reply
                </Button>
                <p className="text-xs text-muted-foreground">
                  A reply is written once and cannot be changed, like evidence.
                </p>
              </div>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Evidence
            </p>
            {detail.isPending ? (
              <p className="mt-1 text-muted-foreground">Loading…</p>
            ) : detail.isError ? (
              <Alert variant="destructive" className="mt-2">
                <TriangleAlert />
                <AlertDescription>The case could not be loaded.</AlertDescription>
              </Alert>
            ) : evidence.length === 0 ? (
              <p className="mt-1 text-muted-foreground">Nothing has been attached yet.</p>
            ) : (
              <ul className="mt-2 divide-y rounded-md border">
                {evidence.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p>
                        {item.bySide
                          ? 'You'
                          : item.attachedBySide === viewer.side
                            ? words.colleague
                            : words.otherCap}
                        <span className="text-muted-foreground"> · {formatAgo(item.createdAt)}</span>
                      </p>
                      {item.note ? <p className="text-muted-foreground">{item.note}</p> : null}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void open(item)}>
                      Open
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {live ? (
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="evidence-note">Add evidence</Label>
              <Input
                id="evidence-note"
                placeholder="What it shows (optional)"
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED.join(',')}
                className="hidden"
                onChange={(event) => choose(event.target.files?.[0])}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  loading={attach.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  <FileUp />
                  Choose a file
                </Button>
                {raisedByYou ? (
                  <Button
                    variant="outline"
                    loading={withdraw.isPending}
                    onClick={() => withdraw.mutate()}
                  >
                    Withdraw this case
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                PDF or image, up to 10 MB. Once added it stays: neither side can remove evidence.
              </p>
              {problem ? <p className="text-xs text-destructive-text">{problem}</p> : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
