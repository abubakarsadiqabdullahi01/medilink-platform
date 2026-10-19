'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarCheck, CalendarDays, CalendarOff, Moon, Sun, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQuery } from '@tanstack/react-query';
import { useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, QueueSkeleton } from '@/components/app/page-shell';
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
  /** Whether it is doing anything today, from the same model the matcher uses. */
  standing?: 'open' | 'part_away' | 'all_away' | 'starts_later' | 'finished';
}

interface Effective {
  next: { startsAt: string; endsAt: string; openEnded?: boolean } | null;
  lookaheadDays: number;
  hasUsableSlots: boolean;
}

/** What a thing they entered is doing, when it is not simply working. */
function StandingBadge({ standing, kind }: { standing: Slot['standing']; kind: string }) {
  if (standing === 'all_away') return <Badge variant="warning">Not used: you are away then</Badge>;
  if (standing === 'part_away') return <Badge variant="warning">Partly in your time away</Badge>;
  if (standing === 'starts_later') return <Badge variant="info">Starts later</Badge>;
  if (standing === 'finished') {
    return <Badge variant="secondary">{kind === 'ONE_OFF' ? 'Over' : 'Ended'}</Badge>;
  }
  return null;
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
 */
export function AvailabilitySection() {
  // One request for both lists: the endpoint returns slots and blocks
  // together, and two queries against the same URL would fetch it twice.
  const queueKey = ['availability'];
  const calendar = useQuery({
    queryKey: queueKey,
    queryFn: () =>
      api.get<{ slots: Slot[]; blocks: Block[]; effective?: Effective }>(
        '/api/v1/availability?scopeType=SELF',
      ),
  });
  const effective = calendar.data?.effective;
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
  // Time away that is already over is history, as a past free window is: kept in the record, out
  // of the list.
  const blocks = (calendar.data?.blocks ?? []).filter((block) => new Date(block.endsAt) > new Date());

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

  const removeBlock = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.del(`/api/v1/availability/blocks/${id}`),
    success: 'Time away removed',
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
  });

  return (
    <>
      {/* What the matcher will actually do with all of this, said first: the next time they can be
          offered a shift, or why they cannot be. Away always wins over what they offer. */}
      {effective ? (
        effective.next ? (
          <Alert variant="info" className="mb-5">
            <CalendarCheck />
            <AlertDescription>
              <strong>You can next be offered a shift</strong> from {formatWhen(effective.next.startsAt)}
              {effective.next.openEnded ? ' onwards' : ` to ${formatWhen(effective.next.endsAt)}`}. Time
              you mark as away always wins over what you offer: a shift that touches it is never
              offered to you.
            </AlertDescription>
          </Alert>
        ) : effective.hasUsableSlots ? (
          <Alert variant="warning" className="mb-5">
            <CalendarOff />
            <AlertDescription>
              <strong>Everything you offer falls in time you marked as away</strong>, so you will not be
              offered shifts. Remove or shorten your time away on the Away tab to be matched again.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="warning" className="mb-5">
            <TriangleAlert />
            <AlertDescription>
              <strong>Nothing you have entered is still in play</strong>, so you will not be offered
              shifts. Add a weekly pattern, or a date you are free.
            </AlertDescription>
          </Alert>
        )
      ) : null}

      <Tabs defaultValue="pattern">
        <TabsList>
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
              <CardTitle className="text-sm">Add to your pattern</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-3">
              <div className="min-w-[10rem] space-y-1.5">
                <Label>Day</Label>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger>
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
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={patternAllDay}
                  onChange={(event) => setPatternAllDay(event.target.checked)}
                />
                All day
              </label>
              {patternAllDay ? null : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="from">From</Label>
                    <Input
                      id="from"
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="to">To</Label>
                    <Input
                      id="to"
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                    />
                  </div>
                </>
              )}
              <Button loading={addSlot.isPending} onClick={() => addSlot.mutate()}>
                Add
              </Button>
              <p className="basis-full text-xs text-muted-foreground">
                For a night, put the later time first: 20:00 to 08:00 runs into the next morning.
              </p>
            </CardContent>
          </Card>

          {calendar.isPending ? (
            <QueueSkeleton rows={2} />
          ) : calendar.isError ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>Your availability could not be loaded.</AlertDescription>
            </Alert>
          ) : slots.length === 0 ? (
            <EmptyState
              compact
              icon={<CalendarDays />}
              title="No pattern set"
              description="Without one the matcher has nothing to check a shift against, so you will not be offered work, unless you say you are free on a date."
            />
          ) : (
            <Card>
              <CardContent className="divide-y p-0">
                {ordered.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="flex items-center gap-4">
                      <span className="w-24 text-sm font-medium">
                        {slot.dayOfWeek !== null ? DAYS[slot.dayOfWeek] : ''}
                      </span>
                      <span className="tabular text-sm text-muted-foreground">
                        {slot.startMinute !== null
                          ? slot.startMinute === 0 && slot.endMinute === 1440
                            ? 'All day'
                            : `${clock(slot.startMinute)} – ${clock(slot.endMinute)}`
                          : `${formatWhen(slot.startsAt)} – ${formatWhen(slot.endsAt)}`}
                      </span>
                      <StandingBadge standing={slot.standing} kind={slot.kind} />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                      onClick={() => removeSlot.mutate({ id: slot.id })}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent
          value="dates"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Say you are free</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  One tap, for when your week is not the usual one. Hours are Nigerian time.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    loading={addOneOff.isPending}
                    onClick={() => addOneOff.mutate(tonight(new Date()))}
                  >
                    <Moon />
                    Free tonight
                  </Button>
                  <Button variant="outline" onClick={() => addOneOff.mutate(allDay(new Date()))}>
                    <Sun />
                    Free all day today
                  </Button>
                  <Button variant="outline" onClick={() => addOneOff.mutate(allDay(new Date(), 1))}>
                    <Sun />
                    Free all day tomorrow
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  &ldquo;Tonight&rdquo; is 19:00 to 08:00, and after midnight it means the rest of
                  tonight.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Or choose a date</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="free-date">Date</Label>
                  <Input
                    id="free-date"
                    type="date"
                    min={watDate(new Date())}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={dateAllDay}
                    onChange={(event) => setDateAllDay(event.target.checked)}
                  />
                  All day
                </label>
                {dateAllDay ? null : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="free-from">From</Label>
                      <Input
                        id="free-from"
                        type="time"
                        value={dateFrom}
                        onChange={(event) => setDateFrom(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="free-to">To</Label>
                      <Input
                        id="free-to"
                        type="time"
                        value={dateTo}
                        onChange={(event) => setDateTo(event.target.value)}
                      />
                    </div>
                  </>
                )}
                <Button disabled={!date} loading={addOneOff.isPending} onClick={addDate}>
                  Add
                </Button>
              </CardContent>
            </Card>
          </div>

          {calendar.isPending ? (
            <QueueSkeleton rows={2} />
          ) : upcoming.length === 0 ? (
            <EmptyState
              compact
              icon={<CalendarCheck />}
              title="No dates marked as free"
              description="Dates you add here are offered on top of your weekly pattern, unless you are away then."
            />
          ) : (
            <Card>
              <CardContent className="divide-y p-0">
                {upcoming.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="tabular text-sm">
                        {formatWhen(slot.startsAt)} – {formatWhen(slot.endsAt)}
                      </span>
                      <StandingBadge standing={slot.standing} kind={slot.kind} />
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                      onClick={() => removeSlot.mutate({ id: slot.id })}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent
          value="away"
          className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Block out some dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Time away always wins. A shift that touches it is never offered to you, even on a
                day you have marked as free.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="block-from">From</Label>
                  <Input
                    id="block-from"
                    type="datetime-local"
                    value={blockFrom}
                    onChange={(event) => setBlockFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="block-to">Until</Label>
                  <Input
                    id="block-to"
                    type="datetime-local"
                    value={blockTo}
                    onChange={(event) => setBlockTo(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="block-reason">
                  Reason{' '}
                  <span className="font-normal text-muted-foreground">
                    — required; &ldquo;why was this practitioner unavailable&rdquo; is a question
                    disputes ask
                  </span>
                </Label>
                <Textarea
                  id="block-reason"
                  rows={2}
                  placeholder="Annual leave, exams, family commitment…"
                  value={blockReason}
                  onChange={(event) => setBlockReason(event.target.value)}
                />
              </div>
              <Button
                disabled={!blockFrom || !blockTo || blockReason.trim().length < 3}
                loading={addBlock.isPending}
                onClick={() => addBlock.mutate()}
              >
                Block it out
              </Button>
            </CardContent>
          </Card>

          {calendar.isPending ? (
            <QueueSkeleton rows={1} />
          ) : blocks.length === 0 ? (
            <EmptyState compact icon={<CalendarOff />} title="Nothing blocked out" />
          ) : (
            <div className="space-y-2">
              {blocks.map((block) => (
                <Card key={block.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm">
                        {formatWhen(block.startsAt)} – {formatWhen(block.endsAt)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{block.reason}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                      loading={removeBlock.isPending && removeBlock.variables?.id === block.id}
                      onClick={() => removeBlock.mutate({ id: block.id })}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
