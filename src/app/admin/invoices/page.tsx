'use client';

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, ReceiptText, Send, TriangleAlert, Wallet } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/app/combobox';
import { StatusBadge } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { useStepUp } from '@/components/app/step-up';
import { formatDate, formatMinutes, formatNaira, parseNairaToKobo } from '@/components/app/format';

interface FacilitySummary {
  id: string;
  name: string;
}

interface InvoiceLine {
  assignmentId: string;
  practitionerId: string;
  practitionerName: string;
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
  /** What was recorded when it was marked paid. */
  paymentReference: string | null;
  paidOn: string | null;
  payerName: string | null;
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

  const invoices = useInfiniteQuery({
    queryKey: ['invoices', facilityId],
    queryFn: ({ pageParam }) =>
      api.get<{ invoices: Invoice[]; nextCursor: string | null }>(
        `/api/v1/invoices?facilityId=${facilityId}&limit=25${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(facilityId),
  });
  const invoiceRows = invoices.data?.pages.flatMap((page) => page.invoices) ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['tile'] });
  }

  const stepUp = useStepUp('Issuing, and recording payment of, an invoice moves money.');

  const [voiding, setVoiding] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // Recording a payment says which transfer it was, so it can be checked against
  // the bank statement later (BIL-07). The amount is typed, not prefilled: typing
  // it is the check that what the bank shows is what the invoice says.
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payment, setPayment] = useState({ reference: '', amount: '', paidOn: '', payer: '' });
  const amountKobo = parseNairaToKobo(payment.amount);
  const paymentReady =
    payment.reference.trim().length >= 3 &&
    payment.payer.trim().length >= 2 &&
    amountKobo !== null &&
    payment.paidOn !== '';

  function startPayment(invoice: Invoice) {
    setPaying(invoice);
    setPayment({
      reference: '',
      amount: '',
      // Today in Lagos, which is when somebody is recording a transfer they can see.
      paidOn: new Date(Date.now() + 3600_000).toISOString().slice(0, 10),
      payer: (facilities.data?.facilities ?? []).find((row) => row.id === invoice.facilityId)?.name ?? '',
    });
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
    onError: (error) => {
      if (stepUp.handle(error, () => generate.mutate())) return;
      toast.error('Nothing to bill', { description: errorMessage(error) });
    },
  });

  const issue = useMutation({
    mutationFn: (invoice: Invoice) =>
      api.post(`/api/v1/invoices/${invoice.id}/issue`, { facilityId: invoice.facilityId }),
    onSuccess: () => {
      toast.success('Issued');
      refresh();
    },
    onError: (error, invoice) => {
      if (stepUp.handle(error, () => issue.mutate(invoice))) return;
      toast.error('Could not issue it', { description: errorMessage(error) });
    },
  });

  const voidIt = useMutation({
    mutationFn: (invoice: Invoice) =>
      api.post(`/api/v1/invoices/${invoice.id}/void`, {
        facilityId: invoice.facilityId,
        reason: voidReason.trim(),
      }),
    onSuccess: () => {
      toast.success('Voided', {
        description: 'What was credited for it is reversed, and its shifts can be invoiced again.',
      });
      setVoiding(null);
      setVoidReason('');
      refresh();
    },
    onError: (error, invoice) => {
      if (stepUp.handle(error, () => voidIt.mutate(invoice))) return;
      toast.error('Could not void it', { description: errorMessage(error) });
    },
  });

  const pay = useMutation({
    mutationFn: (invoice: Invoice) =>
      api.post(`/api/v1/invoices/${invoice.id}/pay`, {
        facilityId: invoice.facilityId,
        paymentReference: payment.reference.trim(),
        amountKobo,
        paidOn: payment.paidOn,
        payerName: payment.payer.trim(),
      }),
    onSuccess: () => {
      toast.success('Recorded as paid', {
        description: 'The ledger now shows the facility owing nothing on it.',
      });
      setPaying(null);
      refresh();
    },
    onError: (error, invoice) => {
      if (stepUp.handle(error, () => pay.mutate(invoice))) return;
      toast.error('Could not record it', { description: errorMessage(error) });
    },
  });

  return (
    <>
      {stepUp.dialog}
      <Dialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVoiding(null);
            setVoidReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void {voiding?.number}</DialogTitle>
            <DialogDescription>
              Cancels this draft and reverses what the ledger credited for it. Its shifts can then
              be invoiced again. It cannot be undone, and an invoice that has been issued cannot
              be voided here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Why is it being voided?</Label>
            <Textarea
              id="void-reason"
              value={voidReason}
              maxLength={500}
              onChange={(event) => setVoidReason(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 10 characters. It is kept with your name.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={voidReason.trim().length < 10}
              loading={voidIt.isPending}
              onClick={() => voiding && voidIt.mutate(voiding)}
            >
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={paying !== null} onOpenChange={(open) => (open ? null : setPaying(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment of {paying?.number}</DialogTitle>
            <DialogDescription>
              There is no gateway to capture a payment, so this records a transfer you can see in
              the bank. Enter what the statement shows; the invoice is {paying ? formatNaira(paying.grossKobo) : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pay-reference">Bank reference for the transfer</Label>
              <Input
                id="pay-reference"
                value={payment.reference}
                maxLength={100}
                onChange={(event) => setPayment({ ...payment, reference: event.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">Amount received (₦)</Label>
                <Input
                  id="pay-amount"
                  inputMode="decimal"
                  value={payment.amount}
                  onChange={(event) => setPayment({ ...payment, amount: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pay-date">Date it arrived</Label>
                <Input
                  id="pay-date"
                  type="date"
                  value={payment.paidOn}
                  onChange={(event) => setPayment({ ...payment, paidOn: event.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-payer">Paid by, as the statement names them</Label>
              <Input
                id="pay-payer"
                value={payment.payer}
                maxLength={120}
                onChange={(event) => setPayment({ ...payment, payer: event.target.value })}
              />
            </div>
            {payment.amount !== '' && amountKobo === null ? (
              <p className="text-xs text-destructive-text">That is not an amount in naira.</p>
            ) : null}
            {paying && amountKobo !== null && amountKobo !== paying.grossKobo ? (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertDescription>
                  That is not the invoice amount, {formatNaira(paying.grossKobo)}. Part payments and
                  one transfer for several invoices cannot be recorded yet, and the system will
                  refuse it.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button
              variant="success"
              disabled={!paymentReady}
              loading={pay.isPending}
              onClick={() => paying && pay.mutate(paying)}
            >
              <Wallet />
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          <div className="min-w-[18rem] space-y-1.5">
            <Label htmlFor="facility">Facility</Label>
            {/* Searchable: a plain dropdown is fine over four hospitals and
                not over four hundred, and this list grows with the pilot. */}
            <Combobox
              id="facility"
              options={(facilities.data?.facilities ?? []).map((row) => ({
                value: row.id,
                label: row.name,
              }))}
              value={facilityId}
              onChange={setFacilityId}
              searchPlaceholder="Search facilities…"
            />
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
          icon={<ReceiptText />}
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
      ) : invoiceRows.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="Nothing billed yet" />
      ) : (
        <div className="space-y-4">
          {invoiceRows.map((invoice) => (
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
                        <TableCell className="text-xs">{line.practitionerName}</TableCell>
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
                      <Button variant="outline" onClick={() => setVoiding(invoice)}>
                        Void it
                      </Button>
                    ) : null}
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
                        onClick={() => startPayment(invoice)}
                      >
                        <Wallet />
                        Record payment
                      </Button>
                    ) : null}
                  </div>
                </div>

                {invoice.status === 'PAID' && invoice.paymentReference ? (
                  <p className="text-xs text-muted-foreground">
                    Paid on {formatDate(invoice.paidOn)} by {invoice.payerName}, bank reference{' '}
                    <span className="font-mono">{invoice.paymentReference}</span>.
                  </p>
                ) : null}

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
          {invoices.hasNextPage ? (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => void invoices.fetchNextPage()}
                loading={invoices.isFetchingNextPage}
              >
                Show older invoices
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
