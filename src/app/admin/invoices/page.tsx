'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, Receipt, Send, TriangleAlert, Wallet } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatDate, formatMinutes, formatNaira, shortId } from '@/components/app/format';

interface FacilitySummary {
  id: string;
  name: string;
}

interface InvoiceLine {
  assignmentId: string;
  practitionerId: string;
  hourlyRateKobo: number;
  ordinaryMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  overtimeMinutes: number;
  onCallMinutes: number;
  baseKobo: number;
  premiumKobo: number;
  amountKobo: number;
}

interface Invoice {
  id: string;
  facilityId: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  grossKobo: number;
  platformFeeKobo: number;
  status: string;
  lines: InvoiceLine[];
}

/** The first of the month, which is what a billing period almost always is. */
function monthBounds(offset = 0) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Raising, issuing and settling invoices.
 *
 * Three separate acts on purpose. A draft can be read and checked before
 * anybody is asked for money; issuing is the asking; recording a payment is
 * somebody confirming it arrived. Collapsing them into one button would mean
 * an invoice nobody looked at.
 */
export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [facilityId, setFacilityId] = useState('');
  const [period, setPeriod] = useState(monthBounds(-1));

  const facilities = useQuery({
    queryKey: ['finance-facilities'],
    queryFn: () =>
      api.get<{ facilities: FacilitySummary[] }>(
        '/api/v1/facilities?scopeType=PLATFORM&status=VERIFIED',
      ),
  });

  const invoices = useQuery({
    queryKey: ['invoices', facilityId],
    queryFn: () => api.get<{ invoices: Invoice[] }>(`/api/v1/invoices?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['tile'] });
  }

  const generate = useMutation({
    mutationFn: () =>
      api.post('/api/v1/invoices', {
        facilityId,
        periodStart: new Date(`${period.start}T00:00:00.000Z`).toISOString(),
        periodEnd: new Date(`${period.end}T00:00:00.000Z`).toISOString(),
      }),
    onSuccess: () => {
      toast.success('Draft raised', { description: 'Check it, then issue it.' });
      refresh();
    },
    onError: (error) => toast.error('Nothing to bill', { description: errorMessage(error) }),
  });

  const issue = useMutation({
    mutationFn: (invoice: Invoice) =>
      api.post(`/api/v1/invoices/${invoice.id}/issue`, { facilityId: invoice.facilityId }),
    onSuccess: () => {
      toast.success('Issued');
      refresh();
    },
    onError: (error) => toast.error('Could not issue it', { description: errorMessage(error) }),
  });

  const pay = useMutation({
    mutationFn: (invoice: Invoice) =>
      api.post(`/api/v1/invoices/${invoice.id}/pay`, { facilityId: invoice.facilityId }),
    onSuccess: () => {
      toast.success('Recorded as paid', {
        description: 'The ledger now shows the facility owing nothing on it.',
      });
      refresh();
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Raised from shifts a facility has already approved, so nothing here can bill for hours they did not accept."
      />

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Raise a draft</CardTitle>
          <CardDescription>
            Every approved shift in the period that is not already on an invoice.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] space-y-1.5">
            <Label>Facility</Label>
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose one" />
              </SelectTrigger>
              <SelectContent>
                {(facilities.data?.facilities ?? []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              value={period.start}
              onChange={(event) => setPeriod({ ...period, start: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="to">Until</Label>
            <Input
              id="to"
              type="date"
              value={period.end}
              onChange={(event) => setPeriod({ ...period, end: event.target.value })}
            />
          </div>

          <Button
            disabled={!facilityId || generate.isPending}
            loading={generate.isPending}
            onClick={() => generate.mutate()}
          >
            <FileText />
            Raise
          </Button>
        </CardContent>
      </Card>

      {!facilityId ? (
        <EmptyState
          icon={<Receipt />}
          title="Choose a facility"
          description="Invoices are per facility, so pick one to see what it has been billed."
        />
      ) : invoices.isPending ? (
        <QueueSkeleton rows={2} />
      ) : invoices.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Invoices could not be loaded.</AlertDescription>
        </Alert>
      ) : invoices.data.invoices.length === 0 ? (
        <EmptyState icon={<Receipt />} title="Nothing billed yet" />
      ) : (
        <div className="space-y-4">
          {invoices.data.invoices.map((invoice) => (
            <Card key={invoice.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">{invoice.number}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)} ·{' '}
                    {invoice.lines.length} shift{invoice.lines.length === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <p className="tabular text-lg font-semibold">{formatNaira(invoice.grossKobo)}</p>
                  <StatusBadge status={invoice.status} />
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Practitioner</TableHead>
                      <TableHead>Ordinary</TableHead>
                      <TableHead>Night</TableHead>
                      <TableHead>Holiday</TableHead>
                      <TableHead className="text-right">Base</TableHead>
                      <TableHead className="text-right">Premium</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.lines.map((line) => (
                      <TableRow key={line.assignmentId}>
                        <TableCell className="font-mono text-xs">
                          {shortId(line.practitionerId)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatMinutes(line.ordinaryMinutes)}
                        </TableCell>
                        <TableCell className="text-xs">{formatMinutes(line.nightMinutes)}</TableCell>
                        <TableCell className="text-xs">
                          {formatMinutes(line.holidayMinutes)}
                        </TableCell>
                        <TableCell className="tabular text-right text-xs">
                          {formatNaira(line.baseKobo)}
                        </TableCell>
                        <TableCell className="tabular text-right text-xs">
                          {line.premiumKobo > 0 ? formatNaira(line.premiumKobo) : '—'}
                        </TableCell>
                        <TableCell className="tabular text-right text-xs font-medium">
                          {formatNaira(line.amountKobo)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <Separator />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Platform fee {formatNaira(invoice.platformFeeKobo)}
                    {invoice.platformFeeKobo === 0 ? ' — the rate is not set' : ''}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {invoice.status === 'DRAFT' ? (
                      <Button
                        loading={issue.isPending && issue.variables?.id === invoice.id}
                        onClick={() => issue.mutate(invoice)}
                      >
                        <Send />
                        Issue it
                      </Button>
                    ) : null}
                    {invoice.status === 'ISSUED' ? (
                      <Button
                        variant="success"
                        loading={pay.isPending && pay.variables?.id === invoice.id}
                        onClick={() => pay.mutate(invoice)}
                      >
                        <Wallet />
                        Record payment
                      </Button>
                    ) : null}
                  </div>
                </div>

                {invoice.status === 'ISSUED' ? (
                  <Alert variant="info">
                    <AlertDescription>
                      Recording a payment does not take one. Confirm the transfer has arrived
                      first — there is no gateway to capture it, and the ledger will say it was
                      paid either way.
                    </AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
