'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { consoleOf, inboxHref } from '@/lib/ui/inbox';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatAgo } from '@/components/app/format';

interface InboxItem {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

interface Inbox {
  items: InboxItem[];
  unread: number;
}

const KEY = ['inbox'];

/**
 * What the platform has told this person, in the product.
 *
 * Until there is a way to text people, this is the only place an offer, a
 * decision or a reminder reaches them, so it sits in every console's top bar
 * and says how many are unread. It re-asks every minute and when the window is
 * focused again: a phone left open on a ward should not need a reload to show an
 * offer that arrived.
 *
 * Opening it does not mark anything read; reading is a choice, so a message
 * seen in passing is still waiting. "Mark all as read" and following a message
 * are the two ways it clears.
 */
export function NotificationBell() {
  const pathname = usePathname();
  const console_ = consoleOf(pathname);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const inbox = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<Inbox>('/api/v1/me/notifications?limit=20'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // A failed poll is not worth a banner: the bell simply shows what it last knew.
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (which: { all: true } | { ids: string[] }) =>
      api.post('/api/v1/me/notifications/read', which),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  const unread = inbox.data?.unread ?? 0;
  const items = inbox.data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1.5rem)] p-0">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-sm font-medium">Messages</p>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markRead.isPending}
            onClick={() => markRead.mutate({ all: true })}
          >
            Mark all as read
          </Button>
        </div>
        {inbox.isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            Nothing yet. Offers, decisions and reminders from Medilink will appear here.
          </p>
        ) : (
          <ul className="max-h-[26rem] divide-y overflow-y-auto">
            {items.map((item) => {
              const href = inboxHref(item.kind, console_);
              const unreadItem = item.readAt === null;
              const content = (
                <>
                  <span className="flex items-start gap-2">
                    {unreadItem ? (
                      <span
                        aria-label="Unread"
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                      />
                    ) : (
                      <span className="mt-1.5 h-2 w-2 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className={unreadItem ? 'block text-sm font-medium' : 'block text-sm'}>
                        {item.body}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatAgo(item.createdAt)}
                      </span>
                    </span>
                  </span>
                </>
              );
              return (
                <li key={item.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="block px-4 py-3 hover:bg-muted/60"
                      onClick={() => {
                        if (unreadItem) markRead.mutate({ ids: [item.id] });
                        setOpen(false);
                      }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full px-4 py-3 text-left hover:bg-muted/60"
                      onClick={() => unreadItem && markRead.mutate({ ids: [item.id] })}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
