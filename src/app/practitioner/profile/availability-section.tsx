'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CalendarCheck, CalendarDays, CalendarOff, Moon, Sun, Trash2 } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQuery } from '@tanstack/react-query';
import { useQueueAction } from '@/lib/ui/queue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { EmptyState } from '@/components/app/page-shell';
import { StaleNote } from '@/components/app/stale-note';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { formatWhen } from '@/components/app/format';
import {
  allDay,
  tonight,
  watDate,
  windowOnDate,
} from '@/modules/availability/domain/quick-windows';
import type { TimeWindow } from '@/modules/availability/domain/availability';
import { lagosLocalToInstant } from '@/lib/lagos-date';

interface Slot {
  id: string;
  kind: string;
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

interface Block {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The days a pattern row can be added for. "Every day" and "Monday to Friday"
 * are the two ways people actually say it, and without them a practitioner who
 * works any day has to add seven rows one at a time.
 */
const EVERY_DAY = 'every';
const WEEKDAYS = 'weekdays';
function daysFor(choice: string): number[] {
  if (choice === EVERY_DAY) return [0, 1, 2, 3, 4, 5, 6];
  if (choice === WEEKDAYS) return [1, 2, 3, 4, 5];
  return [Number(choice)];
}

/** What an all-day slot is stored as: midnight to midnight, with no gap at the end. */
const ALL_DAY = { startMinute: 0, endMinute: 24 * 60 };

/** Minutes past midnight to "08:00", for a value stored as an integer. */
function clock(minute: number | null): string {
  if (minute === null) return '—';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** "08:00" back to minutes past midnight. */
function toMinute(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes ?? '0');
}

/**
 * When you can work, and when you cannot.
 *
 * Two lists rather than one calendar, because they answer different
 * questions: a recurring slot is a standing pattern, a block is a named
 * exception to it. A single grid would flatten that distinction and lose the
 * reason a block carries — which is exactly what a dispute later asks for.
 *
 * Every form here is one column on a phone with its labels always on screen, and a list that
 * could not be loaded says so instead of reading as "nothing set": a practitioner who sees "No
 * pattern set" over a failed request would add a pattern on top of one they already have.
 */
export function AvailabilitySection() {
  // One request for both lists: the endpoint returns slots and blocks
  // together, and two queries against the same URL would fetch it twice.
  const queueKey = ['availability'];
  const calendar = useQuery({
    queryKey: queueKey,
    queryFn: () =>
      api.get<{ slots: Slot[]; blocks: Block[] }>('/api/v1/availability?scopeType=SELF'),
  });
  const allSlots = calendar.data?.slots ?? [];
  const slots = allSlots.filter((slot) => slot.kind !== 'ONE_OFF');
  // Ones already over are history, not something to offer: left in the record,
  // out of the list.
  const upcoming = allSlots
    .filter((slot) => slot.kind === 'ONE_OFF' && slot.endsAt && new Date(slot.endsAt) > new Date())
    .sort((a, b) => new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime());
  // Monday first, as a working week is read; the API's Sunday-is-0 order put
  // the weekend at the top of a pattern most people fill in Monday to Friday.
  const weekday = (slot: Slot) => (slot.dayOfWeek === null ? 7 : (slot.dayOfWeek + 6) % 7);
  const ordered = [...slots].sort(
    (a, b) => weekday(a) - weekday(b) || (a.startMinute ?? 0) - (b.startMinute ?? 0),
  );
  const blocks = [...(calendar.data?.blocks ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [patternAllDay, setPatternAllDay] = useState(false);

  const [date, setDate] = useState('');
  const [dateAllDay, setDateAllDay] = useState(true);
  const [dateFrom, setDateFrom] = useState('20:00');
  const [dateTo, setDateTo] = useState('08:00');

  const [blockFrom, setBlockFrom] = useState('');
  const [blockTo, setBlockTo] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [removing, setRemoving] = useState<Block | null>(null);

  const blockEndsBeforeStart =
    Boolean(blockFrom && blockTo) &&
    lagosLocalToInstant(blockTo).getTime() <= lagosLocalToInstant(blockFrom).getTime();

  const addSlot = useQueueAction<void>({
    queueKey,
    run: () =>
      Promise.all(
        daysFor(dayOfWeek).map((day) =>
          api.post('/api/v1/availability/slots', {
            kind: 'RECURRING_WEEKLY',
            dayOfWeek: day,
            ...(patternAllDay
              ? ALL_DAY
              : { startMinute: toMinute(startTime), endMinute: toMinute(endTime) }),
          }),
        ),
      ),
    success: 'Added to your weekly pattern',
  });

  // A one-off: free on one date, or tonight, without touching the weekly pattern.
  const addOneOff = useQueueAction<TimeWindow>({
    queueKey,
    run: (window) =>
      api.post('/api/v1/availability/slots', {
        kind: 'ONE_OFF',
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
      }),
    success: 'Marked as free',
  });

  function addDate() {
    try {
      addOneOff.mutate(windowOnDate(date, dateAllDay ? 'all_day' : { from: dateFrom, to: dateTo }));
    } catch (error) {
      toast.error('Check the date and hours', {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  const removeSlot = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.del(`/api/v1/availability/slots/${id}`),
    success: 'Removed',
  });

  const addBlock = useQueueAction<void>({
    queueKey,
    run: () =>
      api.post('/api/v1/availability/blocks', {
        startsAt: lagosLocalToInstant(blockFrom).toISOString(),
        endsAt: lagosLocalToInstant(blockTo).toISOString(),
        reason: blockReason.trim(),
      }),
    success: 'Blocked out',
    // What was typed is cleared only once it has been saved.
    onDone: () => {
      setBlockFrom('');
      setBlockTo('');
      setBlockReason('');
    },
  });

  const removeBlock = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.del(`/api/v1/availability/blocks/${id}`),
    success: 'Time away removed',
  });

  /** What a list shows while it loads, when it could not be loaded, and — only then — when it is empty. */
  function listArea(rows: number, whenLoaded: () => ReactNode) {
    if (calendar.isPending) return <ListSkeleton rows={rows} label="Loading your availability" />;
    if (calendar.isError && !calendar.data) {
      return (
        <ErrorState
          error={calendar.error}
          onRetry={() => void calendar.refetch()}
          retrying={calendar.isFetching}
          compact
        />
      );
    }
    return whenLoaded();
  }

  const removeButton = (what: string, onClick: () => void, busy = false) => (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Remove ${what}`}
      loading={busy}
      className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
      onClick={onClick}
    >
      <Trash2 />
      Remove
    </Button>
  );

  const allDayCheckbox = (checked: boolean, onChange: (value: boolean) => void) => (
    <label className="flex min-h-11 items-center gap-3">
      <input
        type="checkbox"
        className="size-6 shrink-0 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      All day
    </label>
  );

  return (
    <>
      <StaleNote
        show={calendar.isError && Boolean(calendar.data)}
        onRetry={() => void calendar.refetch()}
        retrying={calendar.isFetching}
        what="your availability"
      />

      <Tabs defaultValue="pattern">
        <TabsList aria-label="Kinds of availability">
          <TabsTrigger value="pattern">Weekly pattern</TabsTrigger>
          <TabsTrigger value="dates">Free on a date</TabsTrigger>
          <TabsTrigger value="away">Away</TabsTrigger>
        </TabsList>

        <TabsContent
          value="pattern"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add to your pattern</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  addSlot.mutate();
                }}
              >
                <Field label="Day">
                  {(a11y) => (
                    <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                      <SelectTrigger {...a11y}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={EVERY_DAY}>Every day</SelectItem>
                        <SelectItem value={WEEKDAYS}>Monday to Friday</SelectItem>
                        {[1, 2, 3, 4, 5, 6, 0].map((index) => (
                          <SelectItem key={DAYS[index]} value={String(index)}>
                            {DAYS[index]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                {allDayCheckbox(patternAllDay, setPatternAllDay)}
                {patternAllDay ? null : (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From">
                      <Input
                        type="time"
                        value={startTime}
                        onChange={(event) => setStartTime(event.target.value)}
                      />
                    </Field>
                    <Field label="To">
                      <Input
                        type="time"
                        value={endTime}
                        onChange={(event) => setEndTime(event.target.value)}
                      />
                    </Field>
                    <p className="col-span-2 text-sm text-muted-foreground">
                      Nigerian time. For a night, put the later time first: 20:00 to 08:00 runs into
                      the next morning.
                    </p>
                  </div>
                )}
                <Button type="submit" loading={addSlot.isPending} className="sm:w-fit">
                  Add to my pattern
                </Button>
              </form>
            </CardContent>
          </Card>

          {listArea(2, () =>
            slots.length === 0 ? (
              <EmptyState
                compact
                icon={<CalendarDays />}
                title="No pattern set"
                description="Without one the matcher has nothing to check a shift against, so you will not be offered work, unless you say you are free on a date."
              />
            ) : (
              <Card>
                <CardContent className="divide-y p-0">
                  {ordered.map((slot) => {
                    const window =
                      slot.startMinute !== null
                        ? slot.startMinute === 0 && slot.endMinute === 1440
                          ? 'All day'
                          : `${clock(slot.startMinute)} – ${clock(slot.endMinute)}`
                        : `${formatWhen(slot.startsAt)} – ${formatWhen(slot.endsAt)}`;
                    const day = slot.dayOfWeek !== null ? DAYS[slot.dayOfWeek] : '';
                    return (
                      <div
                        key={slot.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-5"
                      >
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4">
                          <span className="w-24 font-medium">{day}</span>
                          <span className="tabular text-muted-foreground">{window}</span>
                        </div>
                        {removeButton(`${day} ${window}`, () => removeSlot.mutate({ id: slot.id }))}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ),
          )}
        </TabsContent>

        <TabsContent
          value="dates"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Say you are free</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  One tap, for when your week is not the usual one. Hours are Nigerian time.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    variant="outline"
                    disabled={addOneOff.isPending}
                    onClick={() => addOneOff.mutate(tonight(new Date()))}
                  >
                    <Moon />
                    Free tonight
                  </Button>
                  <Button
                    variant="outline"
                    disabled={addOneOff.isPending}
                    onClick={() => addOneOff.mutate(allDay(new Date()))}
                  >
                    <Sun />
                    Free all day today
                  </Button>
                  <Button
                    variant="outline"
                    disabled={addOneOff.isPending}
                    onClick={() => addOneOff.mutate(allDay(new Date(), 1))}
                  >
                    <Sun />
                    Free all day tomorrow
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  &ldquo;Tonight&rdquo; is 19:00 to 08:00, and after midnight it means the rest of
                  tonight.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Or choose a date</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (date) addDate();
                  }}
                >
                  <Field label="Date">
                    <Input
                      type="date"
                      min={watDate(new Date())}
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </Field>
                  {allDayCheckbox(dateAllDay, setDateAllDay)}
                  {dateAllDay ? null : (
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="From">
                        <Input
                          type="time"
                          value={dateFrom}
                          onChange={(event) => setDateFrom(event.target.value)}
                        />
                      </Field>
                      <Field label="To">
                        <Input
                          type="time"
                          value={dateTo}
                          onChange={(event) => setDateTo(event.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                  <Button
                    type="submit"
                    disabled={!date}
                    loading={addOneOff.isPending}
                    className="sm:w-fit"
                  >
                    Add this date
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          {listArea(2, () =>
            upcoming.length === 0 ? (
              <EmptyState
                compact
                icon={<CalendarCheck />}
                title="No dates marked as free"
                description="Dates you add here are offered on top of your weekly pattern."
              />
            ) : (
              <Card>
                <CardContent className="divide-y p-0">
                  {upcoming.map((slot) => {
                    const window = `${formatWhen(slot.startsAt)} – ${formatWhen(slot.endsAt)}`;
                    return (
                      <div
                        key={slot.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-5"
                      >
                        <span className="tabular">{window}</span>
                        {removeButton(`free time ${window}`, () =>
                          removeSlot.mutate({ id: slot.id }),
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ),
          )}
        </TabsContent>

        <TabsContent
          value="away"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Block out some dates</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    blockFrom &&
                    blockTo &&
                    !blockEndsBeforeStart &&
                    blockReason.trim().length >= 3
                  ) {
                    addBlock.mutate();
                  }
                }}
              >
                <Field label="From" hint="Nigerian time.">
                  <Input
                    type="datetime-local"
                    value={blockFrom}
                    onChange={(event) => setBlockFrom(event.target.value)}
                  />
                </Field>
                <Field
                  label="Until"
                  error={blockEndsBeforeStart ? 'Until has to be after From.' : undefined}
                >
                  <Input
                    type="datetime-local"
                    value={blockTo}
                    onChange={(event) => setBlockTo(event.target.value)}
                  />
                </Field>
                <Field
                  label="Reason"
                  hint="Required. “Why was this practitioner unavailable” is a question disputes ask."
                >
                  <Textarea
                    rows={2}
                    placeholder="Annual leave, exams, family commitment…"
                    value={blockReason}
                    onChange={(event) => setBlockReason(event.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={
                    !blockFrom || !blockTo || blockEndsBeforeStart || blockReason.trim().length < 3
                  }
                  loading={addBlock.isPending}
                  className="sm:w-fit"
                >
                  Block it out
                </Button>
              </form>
            </CardContent>
          </Card>

          {listArea(1, () =>
            blocks.length === 0 ? (
              <EmptyState compact icon={<CalendarOff />} title="Nothing blocked out" />
            ) : (
              <Card>
                <CardContent className="divide-y p-0">
                  {blocks.map((block) => {
                    const window = `${formatWhen(block.startsAt)} – ${formatWhen(block.endsAt)}`;
                    return (
                      <div
                        key={block.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                      >
                        <div className="min-w-0">
                          <p className="tabular">{window}</p>
                          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                            {block.reason}
                          </p>
                        </div>
                        {removeButton(`time away ${window}`, () => setRemoving(block))}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ),
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Remove this time away"
        object={
          removing
            ? `${formatWhen(removing.startsAt)} – ${formatWhen(removing.endsAt)} · ${removing.reason}`
            : ''
        }
        consequence="You will count as available again for these dates: your weekly pattern and any dates you have marked free apply to them, so offers can reach you."
        reversible="You can block the same dates out again."
        confirmLabel="Remove time away"
        cancelLabel="Keep it"
        loading={removeBlock.isPending}
        onConfirm={() =>
          removing &&
          removeBlock.mutate({ id: removing.id }, { onSuccess: () => setRemoving(null) })
        }
      />
    </>
  );
}
