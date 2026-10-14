import { prisma } from '@/lib/db';

/**
 * The inbox: every message the platform sent to a person, as the person reads it.
 *
 * It is the same record as the texts, because a text and a notice are the same
 * telling. That matters while there is no SMS gateway: a message the gateway
 * never delivered is still here, so an offer is not lost for want of a phone
 * network. It is the person's own and nobody else's: the functions take the
 * signed-in user's id and nothing from the request decides whose it is.
 */

export interface InboxItem {
  id: string;
  kind: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface Inbox {
  items: InboxItem[];
  /** Everything unread, not just what is in `items`. */
  unread: number;
}

export const INBOX_DEFAULT_LIMIT = 30;
export const INBOX_MAX_LIMIT = 100;

export async function listInbox(
  userId: string,
  options: { limit?: number } = {},
): Promise<Inbox> {
  const limit = Math.min(Math.max(options.limit ?? INBOX_DEFAULT_LIMIT, 1), INBOX_MAX_LIMIT);

  const [rows, unread] = await Promise.all([
    prisma.notificationMessage.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      // The masked number and the delivery detail are for the people who run the
      // platform, not for the person it was sent to.
      select: { id: true, kind: true, body: true, createdAt: true, readAt: true },
    }),
    prisma.notificationMessage.count({ where: { userId, readAt: null } }),
  ]);

  return { items: rows, unread };
}

/**
 * Marks messages read, and returns how many it changed.
 *
 * Only the caller's own: an id that is somebody else's changes nothing and says
 * nothing. A message already read keeps the time it was first read.
 */
export async function markInboxRead(
  userId: string,
  which: { ids: string[] } | { all: true },
): Promise<number> {
  const result = await prisma.notificationMessage.updateMany({
    where: {
      userId,
      readAt: null,
      ...('all' in which ? {} : { id: { in: which.ids } }),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}
