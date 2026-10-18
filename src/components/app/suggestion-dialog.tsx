'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { useFacilityId } from '@/lib/ui/facility';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { MySuggestionsList, SUGGESTION_AREAS, type MySuggestion } from '@/components/app/my-suggestions';
import { ErrorState } from '@/components/app/states';


const MIN_BODY = 10;

/**
 * Telling Medilink what to improve, from any screen.
 *
 * The suggestion log had two sources and only one of them was reachable: the
 * reason a practitioner gives when declining an offer. Everybody holding
 * `suggestion.submit` — practitioners, hospital staff, the platform's own —
 * had nowhere to write one, so the queue only ever heard about matching.
 */
export function SuggestionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useSession();
  const facilityId = useFacilityId();
  const [area, setArea] = useState('OTHER');
  const [body, setBody] = useState('');
  const [tab, setTab] = useState<'send' | 'yours'>('send');
  const queryClient = useQueryClient();

  // Only fetched when somebody looks: most people open this to send one.
  const mine = useQuery({
    queryKey: ['my-suggestions'],
    queryFn: () => api.get<{ suggestions: MySuggestion[] }>('/api/v1/me/suggestions'),
    enabled: open && tab === 'yours',
    retry: false,
  });

  // Hospital staff hold the permission at their facility rather than at
  // SELF, so they send it with that facility's id for the scope check.
  const personal = session.grants.some(
    (grant) =>
      grant.permission === 'suggestion.submit' &&
      (grant.scopeType === 'SELF' || grant.scopeType === 'PLATFORM'),
  );

  const send = useMutation({
    mutationFn: () =>
      api.post('/api/v1/suggestions', {
        area,
        body: body.trim(),
        facilityId: personal ? undefined : (facilityId ?? undefined),
      }),
    onSuccess: () => {
      toast.success('Thank you', { description: 'The Medilink team reads every suggestion and replies to it.' });
      setBody('');
      setArea('OTHER');
      void queryClient.invalidateQueries({ queryKey: ['my-suggestions'] });
      onOpenChange(false);
    },
    onError: (error) => toast.error('Could not send it', { description: errorMessage(error) }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tab === 'send' ? 'Send a suggestion' : 'Your suggestions'}</DialogTitle>
          <DialogDescription>
            {tab === 'send'
              ? 'Something slow, confusing or missing? Tell the Medilink team. Complaints are welcome too.'
              : 'What you have sent, where each one stands, and the reply.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as 'send' | 'yours')}>
          <TabsList>
            <TabsTrigger value="send">Send one</TabsTrigger>
            <TabsTrigger value="yours">Yours</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'send' ? (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="suggestion-area">What it is about</Label>
                <Select value={area} onValueChange={setArea}>
                  <SelectTrigger id="suggestion-area">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUGGESTION_AREAS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="suggestion-body">Your suggestion</Label>
                <Textarea
                  id="suggestion-body"
                  rows={4}
                  placeholder="What happened, and what would have been better."
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={body.trim().length < MIN_BODY} loading={send.isPending} onClick={() => send.mutate()}>
                Send
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="max-h-[50vh] overflow-y-auto pr-1">
              {mine.isPending ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : mine.isError ? (
                <ErrorState
                  error={mine.error}
                  onRetry={() => void mine.refetch()}
                  retrying={mine.isFetching}
                  compact
                />
              ) : (
                <MySuggestionsList suggestions={mine.data.suggestions} />
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
