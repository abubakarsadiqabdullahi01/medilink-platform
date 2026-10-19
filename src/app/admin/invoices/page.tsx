'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, FileText, ReceiptText, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/app/combobox';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { Money } from '@/components/app/money';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { StatusBadge } from '@/components/app/status-badge';
import { isStepUpRequired, useStepUp } from '@/components/app/step-up';
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

const shifts = (count: number) => `${count} shift${count === 1 ? '' : 's'}`;

/**
 * Raising, issuing and settling invoices.
 *
 * Three separate acts on purpose. A draft can be read and checked before
 * anybody is asked for money; issuing is the asking; recording a payment is
 * somebody confirming it arrived. Collapsing them into one button would mean
 * an invoice nobody looked at.
 *
 * Each of the three that cannot be taken back goes through a confirmation that names the invoice,
 * the amount and the facility, says what happens next and who is told, and says that it cannot be
 * undone — because in the code, it cannot. Raising a draft is not one of them: a draft is the
 * working copy, and voiding it is the way back.
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
  const facilityName = useMemo(
    () =>
      (facilities.data?.facilities ?? []).find((row) => row.id === facilityId)?.name ??
      'This facility',
    [facilities.data, facilityId],
  );

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

  const [issuing, setIssuing] = useState<Invoice | null>(null);
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
      payer: facilityName === 'This facility' ? '' : facilityName,
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
      setIssuing(null);
      refresh();
    },
    onError: (error, invoice) => {
      if (stepUp.handle(error, () => issue.mutate(invoice))) return;
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
    },
  });

  // A failed confirmation is read inside the dialog, which stays open with what was typed. A
  // step-up refusal is not a failure: the password prompt handles it and the action runs again.
  const failure = (error: unknown) =>
    error && !isStepUpRequired(error) ? errorMessage(error) : null;

  const describe = (invoice: Invoice) =>
    `${invoice.number} · ${facilityName} · ${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}`;

  return (
    <>
      {stepUp.dialog}

      <ConfirmDialog
        open={issuing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setIssuing(null);
            issue.reset();
          }
        }}
        title="Issue this invoice"
        object={
          issuing ? (
            <>
              {describe(issuing)} · <Money kobo={issuing.grossKobo} strong /> ·{' '}
              {shifts(issuing.lines.length)}
            </>
          ) : (
            ''
          )
        }
        consequence={
          <>
            It becomes a bill the facility is asked to pay. People at {facilityName} who can read
            invoices are sent a message with the invoice number and the amount. Check the lines
            first: once it is issued it can no longer be voided here.
          </>
        }
        reversible={false}
        confirmLabel="Issue invoice"
        loading={issue.isPending}
        error={failure(issue.error)}
        onConfirm={() => issuing && issue.mutate(issuing)}
      />

      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setVoiding(null);
            setVoidReason('');
            voidIt.reset();
          }
        }}
        title="Void this draft"
        object={
          voiding ? (
            <>
              {describe(voiding)} · <Money kobo={voiding.grossKobo} strong />
            </>
          ) : (
            ''
          )
        }
        consequence={
          <>
            The draft is cancelled and what the ledger credited for it is reversed. Its{' '}
            {voiding ? shifts(voiding.lines.length) : 'shifts'} can be invoiced again. If a payout
            has already been prepared or made for anybody on it, the system refuses. An issued
            invoice cannot be voided here.
          </>
        }
        reversible={{
          tone: 'final',
          label: 'This cannot be undone.',
          detail: 'Raising a new draft for the period bills the same shifts again.',
        }}
        destructive
        confirmLabel="Void invoice"
        cancelLabel="Keep the draft"
        loading={voidIt.isPending}
        error={failure(voidIt.error)}
        confirmDisabled={voidReason.trim().length < 10}
        onConfirm={() => voiding && voidIt.mutate(voiding)}
      >
        <Field
          label="Why is it being voided?"
          hint="At least 10 characters. It is kept with your name."
          required
        >
          <Textarea
            value={voidReason}
            maxLength={500}
            rows={3}
            onChange={(event) => setVoidReason(event.target.value)}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={paying !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPaying(null);
            pay.reset();
          }
        }}
        title="Record a payment received"
        object={
          paying ? (
            <>
              {describe(paying)} · invoice <Money kobo={paying.grossKobo} strong />
            </>
          ) : (
            ''
          )
        }
        consequence={
          paying ? (
            <>
              This records that {payment.payer.trim() || facilityName} paid{' '}
              <Money kobo={paying.grossKobo} strong /> in full
              {payment.paidOn ? <> on {formatDate(payment.paidOn)}</> : null}, and the ledger will
              show it paid. It does not take a payment — there is no gateway — so confirm the
              transfer has arrived at the bank first. Nobody is sent a message.
            </>
          ) : null
        }
        reversible={false}
        confirmLabel="Record payment"
        loading={pay.isPending}
        error={failure(pay.error)}
        confirmDisabled={!paymentReady}
        onConfirm={() => paying && pay.mutate(paying)}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter what the bank statement shows. The amount is typed rather than filled in because
            typing it is the check against the statement: the invoice is{' '}
            {paying ? formatNaira(paying.grossKobo) : ''}, and a part payment, or one transfer for
            several invoices, cannot be recorded yet.
          </p>
          <Field label="Bank reference for the transfer" required>
            <Input
              value={payment.reference}
              maxLength={100}
              onChange={(event) => setPayment({ ...payment, reference: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Amount received (₦)"
              required
              error={
                payment.amount !== '' && amountKobo === null
                  ? 'That is not an amount in naira.'
                  : undefined
              }
            >
              <Input
                inputMode="decimal"
                placeholder="1,250,000.00"
                value={payment.amount}
                onChange={(event) => setPayment({ ...payment, amount: event.target.value })}
              />
            </Field>
            <Field label="Date it arrived" required>
              <Input
                type="date"
                value={payment.paidOn}
                onChange={(event) => setPayment({ ...payment, paidOn: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Paid by, as the statement names them" required>
            <Input
              value={payment.payer}
              maxLength={120}
              onChange={(event) => setPayment({ ...payment, payer: event.target.value })}
            />
          </Field>
          {paying && amountKobo !== null && amountKobo !== paying.grossKobo ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                That is not the invoice amount, {formatNaira(paying.grossKobo)}. The system will
                refuse it.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </ConfirmDialog>

      <PageHeader
        title="Invoices"
        description="Raised from shifts a facility has already approved, so nothing here can bill for hours they did not accept."
      />

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Raise a draft</CardTitle>
          <CardDescription>
            Every approved shift in the period that is not already on an invoice. A draft bills
            nobody until it is issued.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 space-y-1.5 sm:min-w-[18rem]">
            <Label htmlFor="facility" className="text-base font-medium leading-snug">
              Facility
            </Label>
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
            {facilities.isError ? (
              <p
                role="alert"
                className="flex flex-wrap items-center gap-2 text-sm text-destructive-text"
              >
                The list of facilities could not be loaded.
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={facilities.isFetching}
                  onClick={() => void facilities.refetch()}
                >
                  Try again
                </Button>
              </p>
            ) : null}
          </div>

          <Field label="From">
            <Input
              type="date"
              value={period.start}
              onChange={(event) => setPeriod({ ...period, start: event.target.value })}
            />
          </Field>

          <Field label="Until">
            <Input
              type="date"
              value={period.end}
              onChange={(event) => setPeriod({ ...period, end: event.target.value })}
            />
          </Field>

          <Button
            disabled={!facilityId || generate.isPending}
            loading={generate.isPending}
            onClick={() => generate.mutate()}
          >
            <FileText />
            Raise a draft
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
        <ListSkeleton rows={2} label="Loading invoices" />
      ) : invoices.isError && !invoices.data ? (
        <ErrorState
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
          retrying={invoices.isFetching}
        />
      ) : invoiceRows.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title="Nothing billed yet"
          description="Raise a draft above and it appears here to be checked."
        />
      ) : (
        <div className="space-y-4">
          {invoiceRows.map((invoice) => (
            <Card key={invoice.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                <div className="min-w-0">
                  <h2 className="font-mono text-base font-medium">{invoice.number}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)} ·{' '}
                    {shifts(invoice.lines.length)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <Money kobo={invoice.grossKobo} strong className="text-xl" />
                  <StatusBadge status={invoice.status} />
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <InvoiceLines lines={invoice.lines} />

                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Platform fee <Money kobo={invoice.platformFeeKobo} />
                    {invoice.platformFeeKobo === 0 ? ' — the rate is not set' : ''}
                  </p>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    {invoice.status === 'DRAFT' ? (
                      <>
                        <Button
                          variant="outline"
                          aria-label={`Void draft ${invoice.number}`}
                          onClick={() => setVoiding(invoice)}
                        >
                          Void it
                        </Button>
                        <Button
                          aria-label={`Issue invoice ${invoice.number}`}
                          onClick={() => setIssuing(invoice)}
                        >
                          Review and issue
                        </Button>
                      </>
                    ) : null}
                    {invoice.status === 'ISSUED' ? (
                      <Button
                        variant="success"
                        aria-label={`Record payment of invoice ${invoice.number}`}
                        onClick={() => startPayment(invoice)}
                      >
                        Record payment
                      </Button>
                    ) : null}
                  </div>
                </div>

                {invoice.status === 'PAID' && invoice.paymentReference ? (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CircleCheck
                      className="mt-0.5 size-4 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span>
                      Paid on {formatDate(invoice.paidOn)} by {invoice.payerName}, bank reference{' '}
                      <span className="font-mono">{invoice.paymentReference}</span>.
                    </span>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
          {invoices.isError ? (
            <p role="alert" className="text-sm text-destructive-text">
              The next page could not be loaded. The invoices above are still current.
            </p>
          ) : null}
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

/**
 * What an invoice is made of, one line per practitioner: a table where there is room and a short
 * list where there is not, so the minutes and amounts that a draft is checked against are never
 * off the edge of a phone.
 */
function InvoiceLines({ lines }: { lines: InvoiceLine[] }) {
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <caption className="sr-only">What this invoice bills, by practitioner</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Practitioner</TableHead>
              <TableHead scope="col">Ordinary</TableHead>
              <TableHead scope="col">Night</TableHead>
              <TableHead scope="col">Holiday</TableHead>
              <TableHead scope="col" className="text-right">
                Base
              </TableHead>
              <TableHead scope="col" className="text-right">
                Premium
              </TableHead>
              <TableHead scope="col" className="text-right">
                Total
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.assignmentId}>
                <TableCell>{line.practitionerName}</TableCell>
                <TableCell>{formatMinutes(line.ordinaryMinutes)}</TableCell>
                <TableCell>{formatMinutes(line.nightMinutes)}</TableCell>
                <TableCell>{formatMinutes(line.holidayMinutes)}</TableCell>
                <TableCell className="tabular text-right">{formatNaira(line.baseKobo)}</TableCell>
                <TableCell className="tabular text-right">
                  {line.premiumKobo > 0 ? formatNaira(line.premiumKobo) : '—'}
                </TableCell>
                <TableCell className="tabular text-right font-medium">
                  {formatNaira(line.amountKobo)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul
        className="divide-y rounded-md border md:hidden"
        aria-label="What this invoice bills, by practitioner"
      >
        {lines.map((line) => (
          <li key={line.assignmentId} className="space-y-2 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium [overflow-wrap:anywhere]">
                {line.practitionerName}
              </p>
              <Money kobo={line.amountKobo} strong />
            </div>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
              <div>
                <dt className="text-muted-foreground">Ordinary</dt>
                <dd>{formatMinutes(line.ordinaryMinutes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Night</dt>
                <dd>{formatMinutes(line.nightMinutes)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Holiday</dt>
                <dd>{formatMinutes(line.holidayMinutes)}</dd>
              </div>
              <div className="col-span-3 flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  <span className="text-muted-foreground">Base </span>
                  <Money kobo={line.baseKobo} />
                </span>
                {line.premiumKobo > 0 ? (
                  <span>
                    <span className="text-muted-foreground">Premium </span>
                    <Money kobo={line.premiumKobo} />
                  </span>
                ) : null}
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
