'use client';

import { useState } from 'react';
import { CalendarDays, CalendarOff, Trash2, TriangleAlert } from 'lucide-react';
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
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatWhen } from '@/components/app/format';

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
export default function AvailabilityPage() {
  // One request for both lists: the endpoint returns slots and blocks
  // together, and two queries against the same URL would fetch it twice.
  const queueKey = ['availability'];
  const calendar = useQuery({
    queryKey: queueKey,
    queryFn: () => api.get<{ slots: Slot[]; blocks: Block[] }>('/api/v1/availability?scopeType=SELF'),
  });
  const slots = calendar.data?.slots ?? [];
  const blocks = calendar.data?.blocks ?? [];

  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');

  const [blockFrom, setBlockFrom] = useState('');
  const [blockTo, setBlockTo] = useState('');
  const [blockReason, setBlockReason] = useState('');

  const addSlot = useQueueAction<void>({
    queueKey,
    run: () =>
      api.post('/api/v1/availability/slots', {
        kind: 'RECURRING_WEEKLY',
        dayOfWeek: Number(dayOfWeek),
        startMinute: toMinute(startTime),
        endMinute: toMinute(endTime),
      }),
    success: 'Added to your weekly pattern',
  });

  const removeSlot = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.del(`/api/v1/availability/slots/${id}`),
    success: 'Removed',
  });

  const addBlock = useQueueAction<void>({
    queueKey,
    run: () =>
      api.post('/api/v1/availability/blocks', {
        startsAt: new Date(blockFrom).toISOString(),
        endsAt: new Date(blockTo).toISOString(),
        reason: blockReason.trim(),
      }),
    success: 'Blocked out',
  });

  return (
    <>
      <PageHeader
        title="Availability"
        description="A standing weekly pattern, plus the dates you are away. The matcher reads both — a shift you are not available for is never offered to you."
      />

      <Tabs defaultValue="pattern">
        <TabsList>
          <TabsTrigger value="pattern">Weekly pattern</TabsTrigger>
          <TabsTrigger value="away">Away</TabsTrigger>
        </TabsList>

        <TabsContent value="pattern" className="space-y-6">
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
                    {DAYS.map((day, index) => (
                      <SelectItem key={day} value={String(index)}>
                        {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
              <Button loading={addSlot.isPending} onClick={() => addSlot.mutate()}>
                Add
              </Button>
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
              icon={<CalendarDays />}
              title="No pattern set"
              description="Without one the matcher has nothing to check a shift against, so you will not be offered work."
            />
          ) : (
            <div className="space-y-2">
              {slots.map((slot) => (
                <Card key={slot.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant="secondary">
                        {slot.dayOfWeek !== null ? DAYS[slot.dayOfWeek] : 'One off'}
                      </Badge>
                      <span className="tabular text-sm">
                        {slot.startMinute !== null
                          ? `${clock(slot.startMinute)} – ${clock(slot.endMinute)}`
                          : `${formatWhen(slot.startsAt)} – ${formatWhen(slot.endsAt)}`}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeSlot.mutate({ id: slot.id })}
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

        <TabsContent value="away" className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Block out some dates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
            <EmptyState icon={<CalendarOff />} title="Nothing blocked out" />
          ) : (
            <div className="space-y-2">
              {blocks.map((block) => (
                <Card key={block.id}>
                  <CardContent className="py-3">
                    <p className="text-sm">
                      {formatWhen(block.startsAt)} – {formatWhen(block.endsAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{block.reason}</p>
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
