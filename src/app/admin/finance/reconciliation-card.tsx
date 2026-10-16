'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNaira } from '@/components/app/format';
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
          The ledger, every invoice and every payout checked against each other, as this page opened.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {report.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : report.isError ? (
          <p className="text-sm text-muted-foreground">
            The check could not be run. The figures above are unaffected.
          </p>
        ) : report.data.findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm">
            <CircleCheck className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
            <span>
              It does. {report.data.checked.transactions} transactions, {report.data.checked.invoices} invoices
              and {report.data.checked.payouts} payouts agree.
            </span>
          </p>
        ) : (
          <div className="space-y-3">
            <Alert variant="destructive">
              <TriangleAlert className="size-4" aria-hidden />
              <AlertTitle>
                {report.data.findings.length} {report.data.findings.length === 1 ? 'thing does' : 'things do'} not
                add up
              </AlertTitle>
              <AlertDescription>
                Nothing has been changed. Each line below goes once its cause is put right.
              </AlertDescription>
            </Alert>
            <ul className="divide-y rounded-md border text-sm">
              {report.data.findings.map((finding, index) => (
                <li key={`${finding.kind}-${finding.subject.id ?? index}`} className="space-y-1 p-3">
                  <p className="font-medium">
                    {FINDING_TITLES[finding.kind]} <span className="font-normal text-muted-foreground">· {subjectLabel(finding)}</span>
                  </p>
                  <p className="text-muted-foreground">{finding.detail}</p>
                  {finding.expectedKobo !== null && finding.actualKobo !== null ? (
                    <p className="tabular text-xs text-muted-foreground">
                      Should be {formatNaira(finding.expectedKobo)}, is {formatNaira(finding.actualKobo)}.
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
