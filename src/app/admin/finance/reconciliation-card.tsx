'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, LoadingStatus } from '@/components/app/states';
import { formatNaira, formatWhen } from '@/components/app/format';
import { FINDING_TITLES, type Finding } from '@/modules/billing-settlement/domain/reconciliation';

interface Report {
  ranAt: string;
  checked: { transactions: number; invoices: number; payouts: number };
  findings: Finding[];
}

const subjectLabel = (finding: Finding): string => {
  const { type, id, label } = finding.subject;
  if (label) return label;
  if (!id) return type === 'cash' ? 'Cash' : 'The whole ledger';
  return `${type[0]!.toUpperCase()}${type.slice(1)} ${id.slice(0, 8)}`;
};

/**
 * Does the money add up (M12-07), worked out as the page opens from the ledger and the records
 * that point at it. Nothing is stored: a line here is true now, and goes when its cause is put
 * right. The same checks run every night and fail a job that shows on System health.
 *
 * Its three states are said in words, with a mark, and none of them can be mistaken for another:
 * a check that agrees, a check that found something, and a check that could not be run — which
 * is not the same as "all is well", and says so.
 */
export function ReconciliationCard() {
  const report = useQuery({
    queryKey: ['finance', 'reconciliation'],
    queryFn: () => api.get<Report>('/api/v1/finance/reconciliation'),
    retry: false,
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Does the money add up?</CardTitle>
        <CardDescription>
          The ledger, every invoice and every payout checked against each other
          {report.data ? `, as of ${formatWhen(report.data.ranAt)}` : ', as this page opened'}. The
          same check runs every night; a night that finds a break shows on System health.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {report.isPending ? (
          <>
            <LoadingStatus label="Checking the ledger" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : report.isError ? (
          <ErrorState
            compact
            error={report.error}
            onRetry={() => void report.refetch()}
            retrying={report.isFetching}
          />
        ) : report.data.findings.length === 0 ? (
          <p className="flex items-start gap-2 text-base">
            <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <span>
              <span className="font-medium">It does.</span> {report.data.checked.transactions}{' '}
              transactions, {report.data.checked.invoices} invoices and{' '}
              {report.data.checked.payouts} payouts agree.
            </span>
          </p>
        ) : (
          <div className="space-y-3">
            <Alert variant="destructive">
              <TriangleAlert className="size-4" aria-hidden="true" />
              <AlertTitle>
                {report.data.findings.length}{' '}
                {report.data.findings.length === 1 ? 'thing does' : 'things do'} not add up
              </AlertTitle>
              <AlertDescription>
                Nothing has been changed. Each line below goes once its cause is put right.
              </AlertDescription>
            </Alert>
            <ul className="divide-y rounded-md border text-base">
              {report.data.findings.map((finding, index) => (
                <li
                  key={`${finding.kind}-${finding.subject.id ?? index}`}
                  className="space-y-1 p-3"
                >
                  <p className="font-medium">
                    {FINDING_TITLES[finding.kind]}{' '}
                    <span className="font-normal text-muted-foreground">
                      · {subjectLabel(finding)}
                    </span>
                  </p>
                  <p className="text-muted-foreground">{finding.detail}</p>
                  {finding.expectedKobo !== null && finding.actualKobo !== null ? (
                    <p className="tabular text-sm text-muted-foreground">
                      Should be {formatNaira(finding.expectedKobo)}, is{' '}
                      {formatNaira(finding.actualKobo)}.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
