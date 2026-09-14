'use client';

import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, Receipt, Users, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacility, useFacilityId } from '@/lib/ui/facility';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-shell';

interface Tile {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  path: (facilityId: string) => string;
  pick: (body: unknown) => unknown[];
  hint: string;
}

const TILES: Tile[] = [
  {
    href: '/facility/shifts',
    label: 'Shifts published',
    icon: CalendarPlus,
    permission: 'service_request.read',
    path: (id) => `/api/v1/service-requests?scopeType=FACILITY&scopeId=${id}&status=PUBLISHED`,
    pick: (body) => (body as { requests?: unknown[] }).requests ?? [],
    hint: 'Open and waiting to be filled.',
  },
  {
    href: '/facility/roster',
    label: 'Confirmed on the roster',
    icon: Users,
    permission: 'attendance.record',
    path: (id) => `/api/v1/assignments?scopeType=FACILITY&scopeId=${id}&status=CONFIRMED`,
    pick: (body) => (body as { assignments?: unknown[] }).assignments ?? [],
    hint: 'Practitioners due on the floor.',
  },
  {
    href: '/facility/timesheets',
    label: 'Timesheets to approve',
    icon: Receipt,
    permission: 'timesheet.approve',
    path: (id) => `/api/v1/assignments?scopeType=FACILITY&scopeId=${id}&status=CONFIRMED`,
    pick: (body) => (body as { assignments?: unknown[] }).assignments ?? [],
    hint: 'Nobody is paid until these are decided.',
  },
];

export default function FacilityDashboard() {
  const session = useSession();
  const facilityId = useFacilityId();
  const facility = useFacility(facilityId);

  const mine = TILES.filter((tile) => session.permissions.includes(tile.permission));

  const results = useQueries({
    queries: mine.map((tile) => ({
      queryKey: ['tile', tile.href, facilityId],
      queryFn: async () => tile.pick(await api.get(tile.path(facilityId as string))).length,
      enabled: Boolean(facilityId),
    })),
  });

  const unverified = facility.data && facility.data.status !== 'VERIFIED';

  return (
    <>
      <PageHeader
        title={facility.data?.name ?? 'Your facility'}
        description={`Signed in as ${session.user.fullName}.`}
      />

      {unverified ? (
        <Alert variant="warning" className="mb-6">
          <AlertDescription>
            This facility is <strong>{facility.data?.status.toLowerCase()}</strong>, so it cannot
            publish shifts yet. Compliance verifies it once the licence has been checked.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {mine.map((tile, index) => {
          const result = results[index];
          const Icon = tile.icon;

          return (
            <Link key={tile.href} href={tile.href} className="group">
              <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <span className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <Icon className="size-4" />
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <p className="mt-4 text-sm font-medium">{tile.label}</p>
                  {result?.isPending ? (
                    <Skeleton className="mt-2 h-9 w-12" />
                  ) : (
                    <p className="tabular mt-1 text-3xl font-semibold">{result?.data ?? 0}</p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">{tile.hint}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
