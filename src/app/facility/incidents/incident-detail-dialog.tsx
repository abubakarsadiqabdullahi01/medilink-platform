'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SeverityBadge, StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid } from '@/components/app/page-shell';
import { formatAgo, formatWhen } from '@/components/app/format';

export interface FacilityIncident {
  id: string;
  severity: string;
  category: string;
  summary: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
  outcome: string | null;
  closedAt: string | null;
  closureNotes: string | null;
}

/**
 * The full record of one report, read-only.
 *
 * There is no edit or withdraw action here — the report itself said so when
 * it was filed, and that is a rule, not an omission this dialog works around.
 * What was missing was the other half of the story: once compliance decides
 * an outcome, the facility that filed the report had no way to see it. This
 * is that.
 */
export function IncidentDetailDialog({
  incident,
  onClose,
}: {
  incident: FacilityIncident | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={incident !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        {incident ? (
          <>
            <DialogHeader>
              <DialogTitle>{humanise(incident.category)}</DialogTitle>
              <DialogDescription>
                Occurred {formatWhen(incident.occurredAt)} · reported{' '}
                {formatAgo(incident.reportedAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={incident.severity} />
                <StatusBadge status={incident.status} />
              </div>

              <p className="text-sm leading-relaxed">{incident.summary}</p>

              {incident.status === 'CLOSED' ? (
                <>
                  <DetailGrid>
                    <Detail label="Outcome">
                      {incident.outcome ? humanise(incident.outcome) : '—'}
                    </Detail>
                    <Detail label="Closed">
                      {incident.closedAt ? formatWhen(incident.closedAt) : '—'}
                    </Detail>
                  </DetailGrid>
                  {incident.closureNotes ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What compliance found
                      </p>
                      <p className="mt-1">{incident.closureNotes}</p>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Still open. Compliance has not closed this one yet.
                </p>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
