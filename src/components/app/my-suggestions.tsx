'use client';

import { Badge } from '@/components/ui/badge';
import { statusVariant } from '@/components/app/status-badge';
import { formatDate } from '@/components/app/format';

/**
 * What a person wrote to Medilink, where each stands, and the answer (SUG-01).
 *
 * The form promised "The Medilink team reads every suggestion and replies to it"; the reply was
 * written on the operations screen and nothing carried it back. This is where the author finds it.
 */
export type SuggestionStatus = 'NEW' | 'TRIAGED' | 'PLANNED' | 'DONE' | 'DECLINED';

export interface MySuggestion {
  id: string;
  area: string;
  body: string;
  status: SuggestionStatus;
  response: string | null;
  answeredAt: string | null;
  createdAt: string;
}

export const SUGGESTION_AREAS = [
  ['ONBOARDING', 'Signing up and getting verified'],
  ['CREDENTIALS', 'Documents and credentials'],
  ['MATCHING', 'Offers and matching'],
  ['SCHEDULING', 'Shifts and rotas'],
  ['ATTENDANCE', 'Checking in and out'],
  ['TIMESHEETS', 'Timesheets'],
  ['PAYMENTS', 'Pay and invoices'],
  ['SUPPORT', 'Getting help'],
  ['OTHER', 'Something else'],
] as const;

const AREA_LABEL = new Map<string, string>(SUGGESTION_AREAS);

/** In the words a person would use, not the queue's ("triaged" means nothing to somebody who wrote one). */
export function suggestionStatusLabel(status: SuggestionStatus): string {
  return {
    NEW: 'Received',
    TRIAGED: 'Being looked at',
    PLANNED: 'Planned',
    DONE: 'Done',
    DECLINED: 'Not taken forward',
  }[status];
}

const EXPLANATION: Partial<Record<SuggestionStatus, string>> = {
  NEW: 'We have it. Somebody on the team will read it and reply.',
  TRIAGED: 'Somebody has read it and is deciding what to do.',
};

export function MySuggestionsList({ suggestions }: { suggestions: MySuggestion[] }) {
  if (suggestions.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        You have not sent a suggestion yet. When you do, you can follow it here and read the reply.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {suggestions.map((suggestion) => (
        <li key={suggestion.id} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {AREA_LABEL.get(suggestion.area) ?? 'Something else'}
            </span>
            <Badge variant={statusVariant(suggestion.status)}>
              {suggestionStatusLabel(suggestion.status)}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-relaxed">{suggestion.body}</p>
          <p className="mt-1 text-xs text-muted-foreground">Sent {formatDate(suggestion.createdAt)}</p>
          {suggestion.response ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Answer{suggestion.answeredAt ? ` · ${formatDate(suggestion.answeredAt)}` : ''}
              </p>
              <p className="mt-1 leading-relaxed">{suggestion.response}</p>
            </div>
          ) : EXPLANATION[suggestion.status] ? (
            <p className="mt-2 text-xs text-muted-foreground">{EXPLANATION[suggestion.status]}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
