'use client';

import { useQuery } from '@tanstack/react-query';
import { Receipt, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AmountFigure } from '@/components/app/amount-figure';
import { StatusBadge } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatDate, formatMinutes, formatNaira } from '@/components/app/format';

interface InvoiceLine {
  assignmentId: string;
  practitionerName: string;
  ordinaryMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  baseKobo: number;
  premiumKobo: number;
  amountKobo: number;
}

interface Invoice {
  id: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  grossKobo: number;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
  lines: InvoiceLine[];
}

/**
 * What this facility has been billed, and what it still owes.
 *
 * The API has served a facility its own invoices since module 12, and the
 * dashboard drew a chart from them, but there was no page a finance officer
 * could open to answer the only question they bring: how much do we owe, and
 * for which shifts?
 *
 * Drafts are left out. A draft is Medilink still putting the invoice
 * together — it can change, and showing it as a bill would be showing an
 * amount nobody has asked for yet.
 */
export default function FacilityInvoicesPage() {
  const facilityId = useFacilityId();

  const invoices = useQuery({
    queryKey: ['facility-invoices', facilityId],
    queryFn: () => api.get<{ invoices: Invoice[] }>(`/api/v1/invoices?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });

  const billed = (invoices.data?.invoices ?? []).filter((row) => row.status !== 'DRAFT');
  const outstanding = billed.filter((row) => row.status === 'ISSUED');
  const owed = outstanding.reduce((sum, row) => sum + row.grossKobo, 0);
  const paid = billed
    .filter((row) => row.status === 'PAID')
    .reduce((sum, row) => sum + row.grossKobo, 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every invoice Medilink has issued to this facility, shift by shift, at the rate agreed when each was published and this facility's rate card."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <AmountFigure
          label="Outstanding"
          amountKobo={owed}
          hint={
            outstanding.length === 0
              ? 'Nothing waiting to be paid.'
              : `${outstanding.length} issued invoice${outstanding.length === 1 ? '' : 's'} not yet paid.`
          }
          isPending={invoices.isPending}
          isError={invoices.isError}
          emphasise
        />
        <AmountFigure
          label="Paid"
          amountKobo={paid}
          hint="Everything recorded as received, all time."
          isPending={invoices.isPending}
          isError={invoices.isError}
        />
      </div>

      {invoices.isPending ? (
        <QueueSkeleton rows={2} />
      ) : invoices.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Invoices could not be loaded.</AlertDescription>
        </Alert>
      ) : billed.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="Nothing billed yet"
          description="An invoice covers approved shifts over a period. It appears here once Medilink issues it."
        />
      ) : (
        <div className="space-y-4">
          {billed.map((invoice) => (
            <Card key={invoice.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">{invoice.number}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)} ·{' '}
                    {invoice.lines.length} shift{invoice.lines.length === 1 ? '' : 's'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {invoice.paidAt
                      ? `Paid ${formatDate(invoice.paidAt)}`
                      : invoice.issuedAt
                        ? `Issued ${formatDate(invoice.issuedAt)}`
                        : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <p className="tabular text-lg font-semibold">{formatNaira(invoice.grossKobo)}</p>
                  <StatusBadge status={invoice.status} />
                </div>
              </CardHeader>

              <CardContent>
                {/* Wide on a phone; it scrolls inside its card, not the page. */}
                <div className="overflow-x-auto">
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
                          <TableCell className="text-xs">{formatMinutes(line.ordinaryMinutes)}</TableCell>
                          <TableCell className="text-xs">{formatMinutes(line.nightMinutes)}</TableCell>
                          <TableCell className="text-xs">{formatMinutes(line.holidayMinutes)}</TableCell>
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
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
