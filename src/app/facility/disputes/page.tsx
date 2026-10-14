'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileUp, Gavel, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatWhen } from '@/components/app/format';

interface Case {
  id: string;
  category: string;
  reason: string;
  status: string;
  outcome: string | null;
  resolutionNotes: string | null;
  raisedParty: string;
  createdAt: string;
  practitionerName: string;
  shiftStartsAt: string;
  raisedByFacility: boolean;
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

/**
 * Disputes over this facility's shifts.
 *
 * A case is an argument between the facility and a practitioner about a shift,
 * decided by somebody at Medilink. The facility was one of its two sides in the
 * rules and in nothing else: no screen, and every route a party needs asked for
 * the practitioner's own standing. Here the facility reads the case, sees what the
 * practitioner attached, adds its own and, if it raised the case, takes it back.
 * What it cannot do is edit or remove evidence, or decide anything.
 */
export default function FacilityDisputesPage() {
  const facilityId = useFacilityId();
  const [open, setOpen] = useState<Case | null>(null);

  const cases = useQuery({
    queryKey: ['facility-disputes', facilityId],
    queryFn: () => api.get<{ disputes: Case[] }>(`/api/v1/disputes?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });
  const rows = cases.data?.disputes ?? [];
  const live = rows.filter((row) => LIVE.includes(row.status));

  return (
    <>
      <PageHeader
        title="Disputes"
        description="Cases over your shifts, from either side. A person at Medilink decides each one; until then you can read it, add what you have, and take back one you raised."
      />

      {!facilityId || cases.isPending ? (
        <QueueSkeleton rows={2} />
      ) : cases.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>The disputes could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Gavel />}
          title="No disputes"
          description="A case appears here when you or a practitioner raise one over a shift."
        />
      ) : (
        <>
          {live.length > 0 ? (
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                {live.length} {live.length === 1 ? 'case is' : 'cases are'} still open. The money
                for a shift in dispute is held back from the practitioner until it is decided.
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-3">
            {rows.map((row) => (
              <Card key={row.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {humanise(row.category)} · {row.practitionerName}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Shift {formatWhen(row.shiftStartsAt)} · raised {formatAgo(row.createdAt)} by{' '}
                      {row.raisedByFacility ? 'you' : 'the practitioner'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={row.status} />
                    <Button variant="outline" size="sm" onClick={() => setOpen(row)}>
                      Open
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {open && facilityId ? (
        <CaseDialog facilityId={facilityId} row={open} onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function CaseDialog({
  facilityId,
  row,
  onClose,
}: {
  facilityId: string;
  row: Case;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['facility-dispute', row.id],
    queryFn: () =>
      api.get<{ dispute: Case; side: string; evidence: Evidence[] }>(
        `/api/v1/disputes/${row.id}?facilityId=${facilityId}`,
      ),
  });
  const evidence = detail.data?.evidence ?? [];
  const live = LIVE.includes(row.status);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['facility-dispute', row.id] });
    void queryClient.invalidateQueries({ queryKey: ['facility-disputes'] });
  }

  const attach = useMutation({
    mutationFn: async (file: File) => {
      const ticket = await api.post<{ objectKey: string; uploadUrl: string }>(
        `/api/v1/disputes/${row.id}/evidence/upload-url`,
        { facilityId, filename: file.name, contentType: file.type, sizeBytes: file.size },
      );
      const response = await fetch(ticket.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!response.ok) throw new Error(`Storage refused the upload (${response.status}).`);
      await api.post(`/api/v1/disputes/${row.id}/evidence`, {
        facilityId,
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

  const withdraw = useMutation({
    mutationFn: () => api.post(`/api/v1/disputes/${row.id}/withdraw`, { facilityId }),
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
        { facilityId },
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
          <DialogTitle>
            {humanise(row.category)} · {row.practitionerName}
          </DialogTitle>
          <DialogDescription>
            Shift {formatWhen(row.shiftStartsAt)} · raised by{' '}
            {row.raisedByFacility ? 'you' : 'the practitioner'} · <StatusBadge status={row.status} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              What was raised
            </p>
            <p className="mt-1 whitespace-pre-wrap">{row.reason}</p>
          </div>

          {row.status === 'RESOLVED' ? (
            <Alert variant={row.outcome === 'UPHELD' ? 'warning' : 'info'}>
              <AlertDescription>
                <strong>Decided: {row.outcome === 'UPHELD' ? 'upheld' : 'dismissed'}.</strong>{' '}
                {row.resolutionNotes}
              </AlertDescription>
            </Alert>
          ) : null}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Evidence
            </p>
            {detail.isPending ? (
              <p className="mt-1 text-muted-foreground">Loading…</p>
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
                          : item.attachedBySide === 'PRACTITIONER'
                            ? 'The practitioner'
                            : 'Your colleague'}
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
                {row.raisedByFacility ? (
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
