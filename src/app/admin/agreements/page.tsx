'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader, QueueSkeleton, ErrorState } from '@/components/app/page-shell';
import { formatDate } from '@/components/app/format';

interface Version {
  id: string;
  kind: string;
  identifier: string;
  title: string;
  body: string;
  effectiveFrom: string;
  retiredAt: string | null;
  acceptances: number;
}

const KINDS = [
  {
    value: 'PRIVACY_NOTICE',
    label: 'Privacy notice',
    binds: 'Everybody: practitioners and hospital staff.',
  },
  {
    value: 'PRACTITIONER_ENGAGEMENT',
    label: 'Practitioner engagement terms',
    binds: 'Practitioners, from the Privacy tab of My profile.',
  },
  {
    value: 'FACILITY_TERMS',
    label: 'Facility terms of service',
    binds: 'Hospital owners and administrators, from their dashboard.',
  },
] as const;

const MIN_BODY = 50;

/**
 * The agreements people accept: what is in force, what it replaced, and
 * publishing the next version.
 *
 * Publishing used to be API-only, so the agreements every page asks people
 * to accept could only be written by somebody at a terminal. Publishing a new
 * version retires the current one at once and everybody it binds is asked to
 * accept again — the page says so before the button, not after.
 */
export default function AgreementsPage() {
  const queryClient = useQueryClient();
  const versions = useQuery({
    queryKey: ['agreement-versions'],
    queryFn: async () =>
      (await api.get<{ versions: Version[] }>('/api/v1/agreements/versions')).versions,
  });

  const [kind, setKind] = useState<string>('PRIVACY_NOTICE');
  const [identifier, setIdentifier] = useState('');
  const [title, setTitle] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [body, setBody] = useState('');
  const [reading, setReading] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () =>
      api.patch('/api/v1/agreements', {
        kind,
        identifier: identifier.trim(),
        title: title.trim(),
        body: body.trim(),
        effectiveFrom: effectiveFrom || undefined,
      }),
    onSuccess: () => {
      toast.success('Published', {
        description: 'The previous version is retired. Everybody it binds is asked to accept this one.',
      });
      setIdentifier('');
      setTitle('');
      setBody('');
      setEffectiveFrom('');
      void queryClient.invalidateQueries({ queryKey: ['agreement-versions'] });
    },
    onError: (error) => toast.error('Could not publish it', { description: errorMessage(error) }),
  });

  const ready = identifier.trim().length >= 3 && title.trim().length >= 3 && body.trim().length >= MIN_BODY;
  const chosen = KINDS.find((row) => row.value === kind);

  return (
    <>
      <PageHeader
        title="Terms and notices"
        description="The documents people accept to use Medilink. Each version is kept for good, with who accepted it and when, so what somebody agreed to stays readable years later."
      />

      <div className="space-y-6">
        {versions.isPending ? (
          <QueueSkeleton rows={3} />
        ) : versions.isError ? (
        <ErrorState message="The agreements could not be loaded." onRetry={() => void versions.refetch()} retrying={versions.isFetching} />
      ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {KINDS.map((type) => {
              const rows = versions.data.filter((row) => row.kind === type.value);
              const current = rows.find((row) => !row.retiredAt);
              const retired = rows.filter((row) => row.retiredAt);
              return (
                <Card key={type.value} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{type.label}</CardTitle>
                    <CardDescription className="text-xs">{type.binds}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-3">
                    {current ? (
                      <>
                        <div>
                          <p className="font-medium">{current.title}</p>
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {current.identifier}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">In force from {formatDate(current.effectiveFrom)}</Badge>
                          <Badge variant="outline">
                            {current.acceptances} accepted
                          </Badge>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReading(reading === current.id ? null : current.id)}
                        >
                          {reading === current.id ? 'Hide the text' : 'Read the text'}
                        </Button>
                        {reading === current.id ? (
                          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm leading-relaxed">
                            {current.body}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nothing published yet. Nobody is being asked to accept one.
                      </p>
                    )}
                    {retired.length > 0 ? (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Earlier versions ({retired.length})</summary>
                        <ul className="mt-2 space-y-1">
                          {retired.map((row) => (
                            <li key={row.id}>
                              <span className="font-mono">{row.identifier}</span> ·{' '}
                              {formatDate(row.effectiveFrom)} to{' '}
                              {row.retiredAt ? formatDate(row.retiredAt) : ''} · {row.acceptances}{' '}
                              accepted
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Publish a new version</CardTitle>
            <CardDescription className="text-xs">
              It replaces the current version of the same kind as soon as it takes effect.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Kind</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((row) => (
                      <SelectItem key={row.value} value={row.value}>
                        {row.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosen ? <p className="text-xs text-muted-foreground">Binds: {chosen.binds}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agreement-identifier">Identifier</Label>
                <Input
                  id="agreement-identifier"
                  className="font-mono"
                  placeholder="privacy-notice-2026-11"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Stable and never reused. Acceptances name this, not the title.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agreement-title">Title</Label>
                <Input
                  id="agreement-title"
                  placeholder="Privacy notice, November 2026"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agreement-effective">
                  Takes effect{' '}
                  <span className="font-normal text-muted-foreground">— optional, defaults to now</span>
                </Label>
                <Input
                  id="agreement-effective"
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="agreement-body">The text</Label>
              <Textarea
                id="agreement-body"
                rows={10}
                placeholder="What it says, in full. This is the exact text people accept."
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {body.trim().length < MIN_BODY
                  ? `At least ${MIN_BODY} characters.`
                  : `${body.trim().length} characters.`}
              </p>
            </div>
            <Alert variant="warning">
              <AlertDescription>
                Publishing retires the current {chosen?.label.toLowerCase() ?? 'version'}. Everybody
                it binds sees the new one as not yet accepted.
              </AlertDescription>
            </Alert>
            <Button disabled={!ready} loading={publish.isPending} onClick={() => publish.mutate()}>
              Publish
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
