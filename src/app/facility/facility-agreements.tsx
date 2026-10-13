'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSignature } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate } from '@/components/app/format';

interface Agreement {
  id: string;
  kind: string;
  identifier: string;
  title: string;
  body: string;
  effectiveFrom: string;
  acceptedAt: string | null;
}

/**
 * The terms this person has not yet accepted, while acting for this facility.
 *
 * Shown only when something is outstanding: an accepted agreement needs no
 * room on the dashboard, and a card that is always there stops being read.
 * The full text is one click away and has to be opened before "I agree" —
 * accepting what you have not been shown is not agreement.
 */
export function FacilityAgreements({ facilityId }: { facilityId: string }) {
  const queryClient = useQueryClient();
  const [reading, setReading] = useState<Agreement | null>(null);

  const agreements = useQuery({
    queryKey: ['facility-agreements', facilityId],
    queryFn: async () =>
      (await api.get<{ agreements: Agreement[] }>(`/api/v1/agreements/facility?facilityId=${facilityId}`))
        .agreements,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: (versionId: string) =>
      api.post('/api/v1/agreements/facility', { facilityId, versionId }),
    onSuccess: () => {
      toast.success('Accepted', { description: 'Recorded with your name and the time.' });
      setReading(null);
      void queryClient.invalidateQueries({ queryKey: ['facility-agreements', facilityId] });
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
  });

  const outstanding = (agreements.data ?? []).filter((row) => !row.acceptedAt);
  if (outstanding.length === 0) return null;

  return (
    <>
      <Card className="mb-6 border-primary/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileSignature className="size-4 text-primary" aria-hidden="true" />
            {outstanding.length === 1 ? 'A document to accept' : `${outstanding.length} documents to accept`}
          </CardTitle>
          <CardDescription className="text-xs">
            Medilink has published terms that apply to you while you act for this facility.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {outstanding.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.title}</p>
                <p className="text-xs text-muted-foreground">In force from {formatDate(row.effectiveFrom)}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setReading(row)}>
                Read and accept
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(reading)} onOpenChange={(next) => !next && setReading(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{reading?.title}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{reading?.identifier}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm leading-relaxed">
            {reading?.body}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReading(null)}>
              Not now
            </Button>
            <Button
              loading={accept.isPending}
              onClick={() => {
                if (reading) accept.mutate(reading.id);
              }}
            >
              I agree
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
