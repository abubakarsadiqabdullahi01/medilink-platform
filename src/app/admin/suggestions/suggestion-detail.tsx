'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, History, MessageSquareText, TriangleAlert, UserRound } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, PageHeader } from '@/components/app/page-shell';
import { actionLabel, formatAgo, formatWhen } from '@/components/app/format';

/**
 * One suggestion, answered.
 *
 * The log is the one screen on this console where the *list* is the point —
 * "where the complaints are" is read by comparing areas, not by opening rows
 * — so the bar chart and the filters stay there and only the answering moved
 * here. A page of twenty simultaneously-open textareas was the thing worth
 * losing.
 *
 * What a detail view adds that the cards could not: the whole of a long
 * suggestion rather than a paragraph in a card, who wrote it where anybody
 * did, and the history. A pilot log's value is in what was *done* about each
 * entry, and until now the console could show the answer but never when it
 * was given or by whom.
 */

export interface Suggestion {
  id: string;
  source: string;
  raisedBy: string | null;
  raisedByName: string | null;
  area: string;
  body: string;
  sourceRef: string | null;
  status: string;
  response: string | null;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
}

const MIN_RESPONSE = 10;

/** What each status means for somebody deciding which to apply. */
const STEPS = [
  { value: 'TRIAGED', label: 'Triaged', meaning: 'Read and understood. Not yet a commitment.' },
  { value: 'PLANNED', label: 'Planned', meaning: 'Accepted and queued for work.' },
] as const;

const CLOSERS = [
  {
    value: 'DONE' as const,
    label: 'Done',
    variant: 'success' as const,
    meaning: 'Changed. The answer says what changed.',
  },
  {
    value: 'DECLINED' as const,
    label: 'Decline',
    variant: 'destructive' as const,
    meaning: 'Not going to happen. The answer says why, and that is the part they read.',
  },
];

export function SuggestionDetail({
  suggestion,
  onBack,
}: {
  suggestion: Suggestion;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [response, setResponse] = useState('');

  const closed = suggestion.status === 'DONE' || suggestion.status === 'DECLINED';
  const fromDecline = suggestion.source === 'DECLINE_REASON';

  const history = useQuery({
    queryKey: ['suggestion-history', suggestion.id],
    queryFn: async () => {
      const body = await api.get<{ entries?: AuditEntry[] }>(
        `/api/v1/audit?scopeType=PLATFORM&entityId=${suggestion.id}&limit=25`,
      );
      return body.entries ?? [];
    },
    retry: false,
  });

  const triage = useMutation({
    mutationFn: (status: string) =>
      api.post(`/api/v1/suggestions/${suggestion.id}/triage`, {
        status,
        response: response.trim() || undefined,
      }),
    onSuccess: (_result, status) => {
      toast.success(`Marked ${status.toLowerCase()}`);
      void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      void queryClient.invalidateQueries({ queryKey: ['suggestions-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['suggestion-history', suggestion.id] });
      onBack();
    },
    onError: (error) => toast.error('Could not record that', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title={humanise(suggestion.area)}
        description={`Raised ${formatAgo(suggestion.createdAt)}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            All suggestions
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{humanise(suggestion.area)}</Badge>
              {fromDecline ? (
                <Badge variant="warning">From a declined invitation</Badge>
              ) : null}
            </div>
            <StatusBadge status={suggestion.status} />
          </CardContent>
        </Card>

        <Tabs defaultValue="suggestion">
          <TabsList>
            <TabsTrigger value="suggestion">The suggestion</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="suggestion" className="space-y-6 pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What they said</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <p className="leading-relaxed">{suggestion.body}</p>
                </div>

                <DetailGrid>
                  <Detail label="Area">{humanise(suggestion.area)}</Detail>
                  <Detail label="Raised">{formatWhen(suggestion.createdAt)}</Detail>
                  <Detail label="Who">
                    {suggestion.raisedByName ?? (fromDecline ? 'Nobody — see below' : 'Not recorded')}
                  </Detail>
                  <Detail label="Source">
                    {fromDecline ? 'A declined invitation' : 'Submitted directly'}
                  </Detail>
                </DetailGrid>

                {fromDecline ? (
                  /* The absence of a name here is a decision, not missing
                     data, and somebody reading the log will wonder. */
                  <Alert variant="info">
                    <UserRound />
                    <AlertDescription>
                      This arrived as the reason somebody gave for declining a shift, and it carries
                      no name — they were answering an invitation rather than filing a complaint.
                      The decline itself is in the audit trail under its own actor.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

            {suggestion.response ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">How it was answered</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {humanise(suggestion.status)}
                    </p>
                    <p className="mt-1 leading-relaxed">{suggestion.response}</p>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {closed ? null : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">What happens to it</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {STEPS.filter((step) => step.value !== suggestion.status).map((step) => (
                      <Button
                        key={step.value}
                        variant="outline"
                        size="sm"
                        title={step.meaning}
                        disabled={triage.isPending}
                        loading={triage.isPending && triage.variables === step.value}
                        onClick={() => triage.mutate(step.value)}
                      >
                        {step.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Triaged and planned move it along without closing it, and neither needs an
                    answer. Closing does.
                  </p>

                  <div className="space-y-1.5">
                    <Label htmlFor="suggestion-response">
                      Answer{' '}
                      <span className="font-normal text-muted-foreground">
                        — required to mark it done or declined
                      </span>
                    </Label>
                    <Textarea
                      id="suggestion-response"
                      rows={3}
                      placeholder="What was done, or why it will not be."
                      value={response}
                      onChange={(event) => setResponse(event.target.value)}
                    />
                    {response.trim().length > 0 && response.trim().length < MIN_RESPONSE ? (
                      <p className="text-xs text-muted-foreground">
                        A little more — {MIN_RESPONSE - response.trim().length} characters to go.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    {CLOSERS.map((option) => (
                      <div
                        key={option.value}
                        className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                      >
                        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                          {option.meaning}
                        </span>
                        <Button
                          variant={option.variant}
                          size="sm"
                          disabled={response.trim().length < MIN_RESPONSE || triage.isPending}
                          loading={triage.isPending && triage.variables === option.value}
                          onClick={() => triage.mutate(option.value)}
                        >
                          {option.label}
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this suggestion
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.isPending ? (
                  <Skeleton className="h-32 w-full" />
                ) : history.isError ? (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertDescription>The history could not be loaded.</AlertDescription>
                  </Alert>
                ) : history.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {history.data.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-border pl-4">
                        <p className="text-sm font-medium">
                          {actionLabel(entry.action)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatWhen(entry.createdAt)} · {formatAgo(entry.createdAt)}
                        </p>
                        {entry.reason ? <p className="mt-1 text-sm">{entry.reason}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}

                {fromDecline ? (
                  <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                    <MessageSquareText className="mr-1 inline size-3" aria-hidden="true" />
                    The entry that created this carries no actor: nobody filed it, so naming
                    somebody would say they did something they did not.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
