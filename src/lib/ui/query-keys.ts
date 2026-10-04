/**
 * Every query key in the console, in one file.
 *
 * Not tidiness. Keys were string literals typed at fifty call sites, and two
 * pages picked `['invitations']` independently — one caching the unwrapped
 * array, the other the `{ invitations: [...] }` envelope the API returns.
 * Whichever rendered first won the cache and the other threw
 * `.filter is not a function`, on the page that had done nothing wrong. A key
 * that exists in exactly one place cannot be collided with by accident, and a
 * second caller has to come here and see what shape is already stored.
 *
 * The rule the keys encode: **what goes under a key is the unwrapped list**,
 * never the envelope. Unwrap at the boundary, every time.
 *
 * Keys are arranged so a prefix invalidates its children — `keys.credentials
 * .all` clears every filtered page of credentials without naming the filters.
 */
export const keys = {
  /** Who is signed in. Read by every console shell. */
  session: ['session'] as const,

  /** The controlled vocabularies: states, LGAs, categories, credential types. */
  reference: ['reference'] as const,

  /** Dashboard tiles. Invalidated wholesale after any queue action. */
  tiles: {
    all: ['tile'] as const,
    one: (path: string) => ['tile', path] as const,
    scoped: (name: string, scopeId: string) => ['tile', name, scopeId] as const,
  },

  credentials: {
    all: ['credentials'] as const,
    page: (status: string, typeId: string, search: string) =>
      ['credentials', status, typeId, search] as const,
    forPractitioner: (userId: string) => ['practitioner-credentials', userId] as const,
  },

  practitioners: {
    directory: (filters: unknown) => ['practitioner-directory', filters] as const,
    eligibility: (userId: string) => ['eligibility-of', userId] as const,
    verification: (userId: string) => ['verification', userId] as const,
    photoUrl: (userId: string) => ['photo-url', userId] as const,
  },

  facilities: {
    directory: (filters: unknown) => ['facility-directory', filters] as const,
    detail: (id: string) => ['facility-detail', id] as const,
    history: (id: string) => ['facility-history', id] as const,
    incidents: (id: string) => ['facility-incidents', id] as const,
  },

  incidents: {
    all: ['incident-queue'] as const,
    page: (filters: unknown) => ['incident-queue', filters] as const,
    detail: (id: string) => ['incident', id] as const,
    history: (id: string) => ['incident-history', id] as const,
  },

  unhonoured: {
    all: ['unhonoured-queue'] as const,
    page: (filters: unknown) => ['unhonoured-queue', filters] as const,
    history: (id: string) => ['unhonoured-history', id] as const,
  },

  dataRequests: {
    all: ['request-queue'] as const,
    page: (filters: unknown) => ['request-queue', filters] as const,
    history: (id: string) => ['request-history', id] as const,
    mine: ['my-data-requests'] as const,
  },

  audit: {
    all: ['audit'] as const,
    page: (filters: unknown) => ['audit', filters] as const,
    /** The history strip on a detail screen: one record's rows. */
    forRecord: (entityId: string) => ['audit', 'record', entityId] as const,
  },

  shifts: {
    all: ['shifts'] as const,
    detail: (id: string) => ['shift', id] as const,
    assignments: (facilityId: string, requestId: string) =>
      ['shift-assignments', facilityId, requestId] as const,
    roster: (filters: unknown) => ['roster', filters] as const,
  },

  /** The practitioner's own screens. */
  me: {
    profile: ['profile'] as const,
    eligibility: ['eligibility'] as const,
    /** Shared with the offers queue — both store the unwrapped array. */
    invitations: ['invitations'] as const,
    assignments: ['my-assignments'] as const,
    attendance: (assignmentId: string) => ['my-attendance', assignmentId] as const,
    timesheets: ['my-timesheets'] as const,
    consent: ['consent'] as const,
    agreements: ['agreements'] as const,
    erasure: ['erasure'] as const,
  },

  money: {
    invoices: (filters: unknown) => ['invoices', filters] as const,
    payouts: (filters: unknown) => ['payouts', filters] as const,
    rateCards: (facilityId: string) => ['rate-cards', facilityId] as const,
    facilities: ['finance-facilities'] as const,
  },
} as const;

/**
 * How long a thing stays fresh, by how fast it actually changes.
 *
 * One global staleness cannot be right for both a list of Nigerian states and
 * a queue somebody is clearing. Before this everything was fifteen seconds,
 * so opening a dashboard twice in a minute refetched six endpoints to render
 * identical numbers — and on a slow connection that is the second or two
 * between a click and a screen.
 *
 * Pick by the question "if this were a minute out of date, would anybody be
 * misled?" — not by how important the data feels.
 */
export const timing = {
  /** Reference data and vocabularies. Changes when compliance edits it. */
  static: 60 * 60 * 1000,

  /** Directories and histories. Changes when somebody is onboarded. */
  stable: 5 * 60 * 1000,

  /** Queues and dashboards. Changes when a colleague works a row. */
  interactive: 60 * 1000,

  /** Attendance and anything mid-shift, where a stale number misleads. */
  live: 15 * 1000,
} as const;
