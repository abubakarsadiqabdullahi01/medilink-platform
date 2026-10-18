> **Detailed audit — facility screens.** Written by reading every file in scope, in full, against commit
> `7ad839c` (the base of this work). File and line references are to that commit unless a note says a
> shared primitive has since changed. Findings tagged `[fixed in WT]` or "adoptable" refer to
> shared components that were being built while this was written; the summary in
> [../ui-ux-audit.md](../ui-ux-audit.md) says what has actually been done about each. Nothing here is a
> change; it is the evidence behind the summary.

# Facility console: UI/UX and accessibility audit (read-only)

Scope: `src/app/facility/**` (11 routes + register + layout/guard/switcher) and the client components they import: `staff-manager.tsx`, `my-invitations.tsx`, `document-upload.tsx`, `combobox.tsx`, `step-up.tsx` (via staff), `money-charts.tsx` (via dashboard). `payout-account-panel.tsx` is **not used by any facility page** (only `src/app/admin/payouts/page.tsx:356`).
Audited against committed facility code at `7ad839c`. Nothing under `src/`, `docs/` or the repo was modified.

## 0. Read this first

**Severity rule used.** CRITICAL = blocks a task, is unsafe/irreversible without a gate, or fails a WCAG 2.2 A/AA criterion that removes a control's name, a user's ability to recover, or text contrast. IMPORTANT = real friction, misleading state, or structural a11y gap. POLISH = consistency, copy, small a11y.

**Two corrections to common assumptions (verified).**
1. **`text-xs` is 14px here and `text-sm` is 16px.** `tailwind.config.ts` overrides the scale (`xs: 0.875rem`, `sm: 1rem`, comment "UXA-01 … nothing set below that"). `grep text-\[\d+px\]` over scope returns nothing. So there is **no sub-14px text** in scope; I only flag consequential content set in the secondary (14px, muted) tier.
2. **Only two facility roles exist** (`src/lib/authz/permissions.ts:196,207`): `facility_administrator` (publish, confirm, cancel, attendance, timesheets, invoices, `facility.write`, payouts, incidents) and `facility_owner` (+ `role.grant`, `dispute.manage`). "Scheduler" and "finance officer" are retired (L242-243). Practical consequence: page-level "permission denied" is rare, but the invite flow cannot give a finance person anything narrower than "do everything" (ST-3). Several in-code comments about "an accounts officer who holds read without publish" are stale.

**Working tree is moving under this audit.** Uncommitted edits to shared primitives landed while I worked (`page-shell.tsx`, `status-badge.tsx`, `badge.tsx`, `card.tsx`, `dialog.tsx`, `sheet.tsx`, `skeleton.tsx`, `globals.css`, `tailwind.config.ts`) plus **new untracked** `components/app/{states,filter-bar,data-table,dashboard,queue-age}.tsx` and `lib/ui/media-query.ts`. No facility page uses them yet (`git status` shows no facility file modified; no `EmptyState action=`/`breadcrumbs=` caller). Effects on this audit:
- Already fixed in working tree, so **not** listed as findings: Dialog close target now 44px (`dialog.tsx` diff); `StatusBadge`/`SeverityBadge` now carry an icon per tone (colour-only status is no longer an issue); global `:focus-visible` outline + `scroll-padding-top` (2.4.7/2.4.11); reduced-motion CSS.
- Now available but unused by facility pages: `PageHeader breadcrumbs/meta`, `EmptyState action`, `ErrorState`/`describeError`/`FilteredEmpty`/`ListSkeleton`/`TableSkeleton`, `FilterBar` (collapses to a sheet on phones), `DataTable` (cards under the table breakpoint), `MetricTile`/`AttentionList`/`DashboardSection`, `QueueAge`. Where a finding below is answered by one of these, I say "adoptable".
- Still not covered by anything in flight: cursor pager, reason/confirm dialog, `SelectField`, choice-card radio group, `FormDialog`+`useZodForm` adoption, tel/reveal phone, signed-URL opener.

**Performance rule check (no per-row API calls): PASS.** Every `useQuery` in scope is page-level or opened-on-demand; none sits inside a component rendered per list row. Closest cases, all clean: `AttendancePanel` (per roster row) has only mutations (`roster/attendance-panel.tsx:71-104`; its comment L54-58 records the old 50-request bug); `RateCardDialog` (per card, `rates/page.tsx:91-101`) has no query; `CaseDialog` query mounts only when a case is opened (`disputes/page.tsx:129-131,150`); incident shift picker is `enabled: open` (`incidents/report-incident-dialog.tsx:101`). Duplicate-fetch and polling findings are per screen.

**Shared-shell notes that affect every facility page** (`components/app/console-shell.tsx`, out of scope but worth knowing): nav active state is exact-match only (L229) so `/facility/shifts/[id]` highlights nothing; no `aria-current` (L233-251); facility nav items define no `prefetch` (`console-layout.tsx:33-97`).

---

## 1. Cross-cutting findings (X-series). Each lists every occurrence once.

- **X1 [CRITICAL] 12 Radix `Select` comboboxes have no accessible name; 16 `<Label>` elements have no `htmlFor`.** A Radix `SelectTrigger` is a button whose name falls back to its selected text ("Every profession"), so the field name is lost (WCAG 1.3.1, 3.3.2, 4.1.2). Unnamed triggers: `shifts/page.tsx:232/240`; `shifts/new-shift-dialog.tsx:142/151, 165/171, 237/239` (+ "Shift type" label at L226 labels a `<p>`); `timesheets/page.tsx:320/322`; `incidents/page.tsx:147/155, 169/177, 192/200`; `incidents/report-incident-dialog.tsx:158/160, 174/176, 191/196`; `register/page.tsx:131/133`. Orphan labels on static content: `profile/page.tsx:209, 214 (read-only branch), 309`. In-repo proof the fix is one attribute: `register/page.tsx:147-152` (`Label htmlFor` + `SelectTrigger id`), `profile/page.tsx:221` and `new-shift-dialog.tsx:188` (`aria-label`). Adoptable: a `SelectField` wrapper.
- **X2 [IMPORTANT] Failure is shown as "empty" or as one generic sentence, and nothing anywhere offers Retry.** `grep refetch` in scope = 0 hits besides one `refetchInterval`. Generic load-failure alerts, none naming the cause (403 vs offline vs 5xx) or showing `errorMessage()`: `shifts/page.tsx:308-312`, `roster/page.tsx:242-246`, `timesheets/page.tsx:381-385`, `invoices/page.tsx:117-121`, `rates/page.tsx:66-70`, `incidents/page.tsx:238-242`, `disputes/page.tsx:82-86`, `profile/page.tsx:158-167`, `shifts/[id]/page.tsx:230-234`, `staff-manager.tsx:499-503,522-526`. **Error rendered as empty:** dashboard charts (D-5), dispute evidence (DP-2), incident shift picker (IN-3), register/shift-filter reference lists (RG-2), agreements/invitations hidden on failure (D-11), timesheet recorded times (T-6). Adoptable: `ErrorState`/`describeError` (untracked `states.tsx`).
- **X3 [IMPORTANT] Mutation errors and confirmations are toast-only.** Sonner, bottom-right (`ui/sonner.tsx:15`), transient; no inline error beside the dialog/field, no `aria-invalid`/`aria-describedby` anywhere (`grep` in scope: 0). `lib/ui/form.ts` (`useZodForm`, per-field errors) exists and has **zero** users in scope; every facility form is `useState` per field plus `disabled={!ready}`.
- **X4 [IMPORTANT] Primary buttons are disabled silently.** The rule that disables them is rarely stated: `new-shift-dialog.tsx:335`, `attendance-panel.tsx:267`, `timesheets/page.tsx:521,652`, `shifts/page.tsx:505`, `roster/page.tsx:410`, `rates/rate-card-dialog.tsx:192` (orig. L318), `register/page.tsx:255`, `staff-manager.tsx:376,643,685,723`. Best of the set: report-incident's character counter (`report-incident-dialog.tsx:233-237`).
- **X5 [IMPORTANT] No `<form>` element in any multi-field form, so Enter does not submit** (new shift, register, profile, rate card, manual attendance, timesheet correction, report incident, staff reason dialogs). `<form>` exists only on filter bars (`shifts:213`, `roster:170`, `incidents:128`) and staff invite/find (`staff-manager.tsx:324,393`).
- **X6 [IMPORTANT] Row actions share labels and none names its row** (WCAG 2.4.6, 2.5.3 in context, SR users hear "Cancel, Cancel, Cancel"): shifts "Publish / Find staff / View / Cancel" (`shifts/page.tsx:391-428`); roster "Cancel" (`roster/page.tsx:321-331`); timesheets "Approve ₦… / Reject / Correct the hours" per card (`timesheets/page.tsx:504-533`); shift detail "Confirm" (`shifts/[id]/page.tsx:481`); staff "Change role / Remove access / Remove all access now" (`staff-manager.tsx:544-568`) and invitation "Cancel" (L797); disputes "Open" (L118) and evidence "Open" (L275, different meaning). "Cancel" means three things in `shifts`, `staff` and every dialog dismiss.
- **X7 [IMPORTANT] Tables with no stacked-card fallback**: shifts (7 cols, fixed widths `shifts/page.tsx:331-335`, ≈1,050px), roster (5-6 cols incl. `min-w-[260px]` attendance, `roster/page.tsx:264-269,312`, ≈1,000px), invoice lines (7 cols nested in each card, `invoices/page.tsx:154-188`). On 390px the last columns (the actions) are off-screen inside `overflow-auto`. Adoptable: `DataTable` (cards on phones, `action` as full-width foot control).
- **X8 [IMPORTANT] Structure.** `CardTitle` renders a `<div>` (`ui/card.tsx`), so card/section titles are not headings: 12 uses (`page.tsx:254,276; profile:204,280; register:113; shifts/[id]:270,300,328,469; facility-agreements:68; staff-manager:312,387`); only `staff-manager.tsx:493,516` use real `<h2>` (at `text-sm`). Sections inside dialogs are `<p>` labels (`disputes:237,253`, `incident-detail:76`). All facility pages share one `<title>Medilink</title>` (root `layout.tsx:6`; every page is a client component with no metadata): WCAG 2.4.2. Heading sizes for the same role vary: `text-sm` / `text-base` / default.
- **X9 [POLISH] Consequential content set in the secondary tier** (14px muted, not a size failure): irreversibility notice under the evidence button (`disputes:320-322`), attendance-code constraints (`attendance-panel.tsx:185-188`), role descriptions (`staff-manager.tsx:368,465,623`), invoice money cells (`invoices:171-183`), timesheet allowance breakdown (`timesheets:443-455`), exclusion explanations (`shifts/[id]:451,457`). Marginal badge contrast (computed): light `warning` 4.54:1, dark `info` 4.52:1.
- **X10 [POLISH] `Alert` hard-codes `role="alert"`** (`ui/alert.tsx`), so static information is announced assertively on mount: `register:102`, `attendance-panel.tsx:255`, `report-incident-dialog.tsx:240`, `profile:192-198,335`, `staff/page.tsx:29`, `page.tsx:163`, `disputes:96`. Several info alerts have no icon, so text indent differs (`[&>svg~*]:pl-7`).
- **X11 [IMPORTANT] Focus is lost when the acted-on element unmounts.** Approve/reject removes the timesheet card (`timesheets:218-226`); roster cancel; incident detail etc. No focus target is set. (Dialog open/close focus is fine: Radix.)
- **X12 [IMPORTANT] `window.open` after an `await` is popup-blocked on iOS Safari / many mobile browsers, with no fallback or message:** `profile/page.tsx:143-147` (View licence), `disputes/page.tsx:201-211` (Open evidence).
- **X13 [IMPORTANT] Phone numbers are auto-requested and each fetch writes an audit row per row.** Roster (`include=attendance,contact`, `roster:98`), timesheets (`include=timesheet,contact`, `timesheets:143`) and shift detail (`include=contact`, `shifts/[id]:138`) ask for the number without anybody asking "by name". The server records one `security_events` reveal per visible row on every call (`matching/application/assignment.ts:1296-1320`), including focus-refetches and page flips; the practitioner-harassment audit trail (its stated purpose, L1334-1336) fills with reveals nobody intended. The timesheets page shows the number although nothing there needs it (L417-419). Numbers are plain `font-mono` text, not `tel:` links (`roster:289-297`, `shifts/[id]:280-288`, `timesheets:417`).
- **X14 [POLISH] Terminology drift** (user-visible strings): shift offer is "offer" (`shifts/[id]`), "Offered", "invitation" (`shifts/page.tsx:482` cancel dialog, "Any invitation still waiting"), and "invitation" also means staff invites (`staff-manager`, `my-invitations`); "booking" (`roster:119,385,398,417`) vs "shift"; "assignment" (`timesheets:296` "Approving completes the assignment"); "match run", "computation", "The engine ranks; a person chooses" (`shifts/[id]:351-352,429`); "category" (`new-shift-dialog.tsx:152`) vs "Profession"; "lapses" (`shifts/[id]:311`, `attendance-panel.tsx:176`) vs "expires"/"answer by"; "Ran out" for expired invitations (`staff-manager.tsx:744`); "Telephone" (`register:218`) vs "Contact phone" (`profile:255`) vs "Their phone number"; phone example formats differ (`0803 123 4567` staff, `+234 803 000 0000` register:223); nav "Report an incident" vs page h1 "Clinical incidents". Sentence case is consistent everywhere; no hard-coded colours (grep clean); one token misuse (ST-1); no emoji; no non-Lucide icons; no raw `toLocale*`/`Intl.DateTimeFormat`/`new Date(...)` used for display (all display goes through `formatWhen/formatDate/formatNaira/formatMinutes`; the exceptions are noted per screen: `{hours} hours` floats, `weekLabel`/`monthLabel`, `money-charts` `naira`, hand-rolled `asMultiple`).
- **X15 [POLISH] Hand-rolled repetition** (see (a)): pager ×4, filter card ×4, status tabs ×3 (tabs without `TabsContent` leave `aria-controls` pointing at nothing, `shifts:194-209`, `roster:151-166`, `timesheets:299-315`), skeleton idioms ×4, record-card header ×8, uppercase mini-label ×3, `<details>` disclosure ×4, role/candidate toggle cards ×4.
- **X16 [POLISH] Invalid nesting.** `Badge` is a `<div>`: inside `<p>` at `staff-manager.tsx:535-538` and inside `DialogDescription` (a `<p>`) at `disputes/page.tsx:229-232`. Block content inside `<button>`: `shifts/[id]:365-411` (candidate), `incidents/page.tsx:252-266` (whole Card).
- **X17 [IMPORTANT] List state is not in the URL.** Tab, filters and page are `useState` (`shifts:113-124`, `roster:73-81`, `timesheets:113-127`, `incidents:70-78`), so Back from `/facility/shifts/[id]` (link at `shifts/[id]:220-226`) resets to "Published", page 1, no filters. Server order is **start-time ascending for every status** (`service-requests/application/request.ts:472`, `matching/application/assignment.ts:1274`), so history tabs (Filled, Cancelled, Expired, Completed, No show) open at the oldest records, 20-50 per page.
- **X18 [POLISH] `Detail` truncates** (`page-shell.tsx` `dd … truncate`): long values clip with no title (`shifts/[id]:246-259`, `incident-detail:66-73`).

---

## 2. Screens

Legend for states: Y = handled deliberately, partial, N = not handled (line refs on partial/N).

### 2.1 `/facility` Dashboard
Files: `facility/page.tsx` (296), `facility-agreements.tsx` (117), `components/app/my-invitations.tsx` (109), `components/app/money-charts.tsx` (charts, lazy via `next/dynamic`).
Audience / task: any facility user on arrival; "what needs me now".

**Data (4 requests on load, no per-row, no polling):** `['facility', id]` `GET /api/v1/facilities/:id` via `useFacility` (staleTime 5 min; same key as switcher, deduped); `['tile','facility-summary', id]` `GET /api/v1/dashboard/facility?facilityId=` (`retry:false`, `page.tsx:122-127`); `['facility-agreements', id]` `GET /api/v1/agreements/facility?facilityId=` (`facility-agreements.tsx:42-48`, `retry:false`); `['staff-invitations','mine']` `GET /api/v1/staff-invitations/mine` (`my-invitations.tsx:38-42`, `retry:false`). Shell also polls notifications every 60 s (`notification-bell.tsx:51`). No blocking full-page loader (tiles/charts have own skeletons). Title flashes "Your facility" then the name (`page.tsx:156`).

**States:** loading Y (L88-89, 260-261) | first-use empty partial: charts say "Not enough shift history yet…"/"Nothing invoiced yet." (L262-266, 282-286) with no CTA; tiles show 0; no first-run guidance for a new or PENDING facility | filtered empty n/a | success n/a (agreements toast Y) | validation n/a | network failure partial: tiles say "Could not load" (L90-91) but charts treat error as empty (D-5) and agreements/invitations vanish on failure (D-11) | permission denied Y (`nothingGranted` card, L199-205, good copy) | server unavailable same as network | archived n/a; PENDING/REJECTED/SUSPENDED banner Y (L163-195) but licence-lapsed N (D-3) | destructive confirm N: Decline invitation is one click (`my-invitations.tsx:90-96`).

**Mobile (390px):** tile grid `sm:grid-cols-2 xl:grid-cols-3` collapses fine. Charts: 26 weekly × 2 bars and 24 monthly × 2 bars in ≈270px (D-6). Tile arrow hover-only (L83).

**Findings**
- **D-1 [IMPORTANT]** "Confirmed on the roster … Practitioners due on the floor." (L225) is the count of **every CONFIRMED assignment of any date** (`facility-summary.ts:67-69`, no date filter); assignments stay CONFIRMED until the timesheet is approved, so it includes shifts already worked. It cannot be read as today's coverage, and "Timesheets to approve" is a subset of it.
- **D-2 [IMPORTANT]** Page answers "how many", not "what do I do now": three counts + two charts; no list of items, no offers waiting, no attendance warnings, no licence/expiry signal; tiles link to unfiltered list pages (`href` has no status). See (c) for what data already exists.
- **D-3 [IMPORTANT]** Banner keys off `status !== 'VERIFIED'` only (L130). A VERIFIED facility with a lapsed licence has `canPublish:false`, `publishBlockers:['licence_expired']` in the very record already fetched (`facilities/application/facility.ts:55-56,107-108`, rule at `facilities/domain/facility.ts:36-61`), but the client type omits them (`lib/ui/facility.ts:8-14`) and nothing warns before publish fails.
- **D-4 [IMPORTANT]** Contradictory copy: PENDING banner "You can set up rates and staff in the meantime" (L168-171) and register "add colleagues straight away" (`register:105-107`) vs staff page "You can add staff once Medilink has verified this facility" (`staff/page.tsx:28-34`). The PENDING banner also never links to the profile where the licence document is uploaded.
- **D-5 [IMPORTANT]** Chart cards: on `summary.isError` both fall to the empty copy (L260-266, L280-286).
- **D-6 [IMPORTANT]** Mobile charts are unreadable and value-by-hover only; `accessibilityLayer` gives keyboard nav but there is no data table/summary. `money-charts.tsx:21` formats money with its own `naira()` (whole naira, loses kobo) instead of `formatNaira`.
- **D-7 [IMPORTANT]** SUSPENDED copy "Contact Medilink for the reason and what is needed to lift it" (L189-191) gives no contact; `SupportContact` exists (`components/app/support-contact.tsx`) and is used only on the landing and `/contact`, never in the console.
- **D-8 [POLISH]** Tile affordance arrow only on hover (L83); three identical "Could not load" with no retry (L90-91); header description is static (L157).
- **D-9 [POLISH]** `weekLabel` omits the year (L40-43); both label helpers are hand-rolled month tables (L37-49).
- **D-10 [POLISH]** Spend chart counts DRAFT invoices as invoiced (I-4).
- **D-11 [IMPORTANT]** `FacilityAgreements` and `MyInvitations` return `null` on error (`facility-agreements.tsx:61-62`, `my-invitations.tsx:67-68`, both `retry:false`): a failed fetch hides an unaccepted agreement or a waiting invitation. Agreements surface only here, not on the page the user may bookmark.
- **D-12 [POLISH]** Decline invitation shows no loading, only disabled (`my-invitations.tsx:90-96`); Accept names no consequence beyond the card text; invitation card has no heading.

### 2.2 `/facility/shifts` (list) + `NewShiftDialog`
Files: `shifts/page.tsx` (519), `shifts/new-shift-dialog.tsx` (342).
Audience / task: ward manager/scheduler; scan open shifts, publish a draft, cancel, open one to staff it, publish a new one.

**Data:** `['shifts', facilityId, status, categoryId, applied, from, to, cursor]` `GET /api/v1/service-requests?scopeType=FACILITY&…&limit=20` (`placeholderData: previous`, `enabled`), `['reference']` (1 h, shared). Dialog adds nothing until opened. No polling, no per-row queries, no duplicates. Not blocking full-page (table area skeleton).

**States (list):** loading Y (L300-307) | first-use empty partial: no CTA (L314-324; `EmptyState action` now exists), description only for Published | filtered empty Y (L316-319) | success Y toast ("Shift cancelled/published") | validation partial (cancel reason ≥3 chars, silent, L505) | network failure partial: generic, no retry, 403 conflated (L308-312) | permission denied: hide-only (L191,390,400,416), N explanation | server unavailable = network | archived/cancelled Y as tab, N: no reason shown | destructive confirm Y for cancel (L477-516), **N for Publish** (L391-398).

**Mobile:** 7-col table (X7); filter card always fully open: search + profession + two dates + Search ≈ 5 stacked controls above the first row (L213-292; `FilterBar` adoptable); `min-w-[220px]` fields fit. Tab list scrolls inside itself (fine).

**Findings (list)**
- **S-1 [IMPORTANT]** Table is unusable on a phone (X7); Actions column is last.
- **S-2 [IMPORTANT]** "Publish" a draft is one click with no terms summary (L391-398), though the page says terms cannot change after publishing (L190). "Publish a shift" is also offered when the facility cannot publish (L191 checks only the permission), so the failure arrives after 12 fields (N-4).
- **S-3 [IMPORTANT]** Cancel dialog names neither the shift nor how many are confirmed/offered, though `confirmedCount` is on the row (L68, L416-429, title L480). It does state consequences (L481-485) but not reversibility, nor that `cancellationTerms` (on the row, L72) may apply. Cancel covers FILLED shifts (L416).
- **S-4 [IMPORTANT]** Filters: search applies only on submit (L215-218) while profession/dates apply on change (L235,260,274). Tab/filters reset when returning from a shift (X17).
- **S-5 [POLISH]** `{hours} hours` is a raw float (L377: "1 hours", "8.333333333333334 hours"); should use `formatMinutes`.
- **S-6 [POLISH]** `Label` for Profession unassociated (L232, X1); "Starts after / Starts before" ambiguous on inclusivity (L255,269); "N on this page" (L294-296); no counts on tabs.
- **S-7 [POLISH]** Empty state has no CTA button; description only for Published (L320-323).
- **S-8 [POLISH]** Published tab can include shifts whose start has passed, unflagged; sort ascending for history tabs (X17).

**`NewShiftDialog`: the shift-publishing task.** One dialog, 12 fields, `max-w-2xl`, `sm:grid-cols-2` (single column on phone), create + publish as one mutation (L81-111).
- **N-1 [IMPORTANT] No review step.** The dialog text admits irreversibility (L134-137) but the confirm is a bare "Publish" (L335-337) with no summary of what will be sent (profession, level, times in Lagos, headcount, rate, terms). The only summary is the money estimate (L313-322).
- **N-2 [IMPORTANT] Silent defaults on the two most consequential fields.** Rate pre-filled ₦5,000 (L58) and cancellation terms pre-filled with a policy (L59-61) that the label says "this is what a dispute turns on" (L289-291). A user can publish after choosing only profession and times. The pay floor is never shown; the server rejects below it (`shifts/page.tsx:88-96`), after the fact.
- **N-3 [IMPORTANT] Partial failure leaves a draft and a retry makes another.** `mutationFn` does create then publish (L83-101). If publish fails (unverified facility, lapsed licence, floor, start passed) a DRAFT exists, the dialog stays open with values, the toast says only "Could not publish" (L110), and clicking Publish again creates a **second** draft. No "a draft was saved" message, no idempotency.
- **N-4 [IMPORTANT] Known blockers are not checked up front.** The facility record carries `canPublish` and `publishBlockers` (D-3); the shifts page never calls `useFacility`. User fills the whole form, then fails.
- **N-5 [IMPORTANT] No "what happens next".** Success toast "It can now be offered to practitioners" (L105); dialog closes and the user stays on the list. `created.id` is returned (L102) and unused: no link to `/facility/shifts/{id}` to "Find candidates". The new shift is on a later page because the list is start-ascending.
- **N-6 [IMPORTANT] Validation and errors.** `ready` (L113-120) never checks headcount ≥ 1 or integer (`Number(headcount || '1')`: "0" passes, L75, L251-258); rate uses `Math.round(Number(...)*100)` (L70) although `parseNairaToKobo` (format.ts) rejects >2 dp; no past-start warning; the only inline error is an Alert **below** the form (L324-329), far from "Ends" on a phone; no `aria-invalid`/`aria-describedby`; Publish silently disabled (X4).
- **N-7 [CRITICAL, via X1]** Profession, Specialty and Urgency selects have no accessible name; the "Shift type" label labels a `<p>` (L142-151,165-171,226-239). The derived shift type does sit in an `aria-live` region (L227), a good touch.
- **N-8 [POLISH]** Form is not reset after success (L104-109): reopening shows the previous shift's values (hidden "repeat" behaviour with duplicate risk), and there is no explicit duplicate/repeat or multi-day option. Cancel/Esc keeps values because state lives in the parent (fine).
- **N-9 [POLISH]** Hours for the estimate use `new Date(local string)` in the device zone (L73) while the payload uses `lagosLocalToInstant` (L79,89-90); estimate prints raw floats (L315). Times are never labelled "Lagos time".
- **N-10 [POLISH]** Specialty label reads "(none for this category)" before any profession is chosen (L165); a chosen specialty cannot be cleared back to "Any" (no clear item, L166-181); placeholder "Choose a category" vs label "Profession" (L152); "provisional register" jargon (L282); native checkbox `size-4` (L273-279).
- **N-11 [POLISH]** On a phone the footer is inside the scrolling content (not sticky), so Publish sits at the bottom of a ≈1,400px form.
- **Form values after server error: preserved (Y).**

### 2.3 `/facility/shifts/[id]`: candidates, offers, confirmations
File: `shifts/[id]/page.tsx` (498).
Audience / task: scheduler; find candidates, offer, confirm acceptances.

**Data:** `['shift', id]` `GET /service-requests/:id?facilityId=`; `['shift-assignments', facilityId, id]` `GET /assignments?…&serviceRequestId=&include=contact`; `['shift-invitations', facilityId, id]` `GET /service-requests/:id/invitations` with **`refetchInterval: 15_000` while any offer is INVITED** (L162-163); `['reference']`. Match results are **component state only** (L143), from a mutation. Not blocking (header + back link render; body skeleton `h-32`, L228-229).

**States:** loading partial (single `Skeleton h-32`, no h1 yet) | first-use empty Y ("No match run yet", L349-353) | filtered n/a | success Y toasts | validation n/a | network failure partial: generic, no retry (L230-234); polling failures silent | permission denied Y (controls hidden when no `assignment.confirm`, L335,418,480) | server unavailable = network | archived/cancelled/expired **N**: no banner, no cancel reason, match button still shown (SD-9) | destructive confirm **N** for Confirm and Offer (SD-4/5).

**Mobile:** DetailGrid auto-fit OK. Candidate rows: container math 358 → 310 (card) → 278 (candidate p-4): factor row = `w-20` label + bar + `w-28` detail ⇒ bar ≈ 70px and reason text clipped to ≈ 14 characters (L398-407). `CardHeader flex-row` with title + button OK.

**Findings**
- **SD-1 [IMPORTANT]** Next action buried: "Ready to confirm" is the **last** card (L466-493), under the whole candidate list; "Offered" tells the user to "confirm below" (L317-320). An accepted offer should lead the page.
- **SD-2 [IMPORTANT]** Candidates and selection live only in component state (L143,123): navigating away or refreshing loses the ranking and forces "Find candidates" again (offers, by contrast, are server-backed, L145-152). "Run again" keeps stale `selected` ids (L170-173 don't clear). `MatchRun.createdAt` (L70) never shown.
- **SD-3 [IMPORTANT]** After offering, candidates remain listed, selectable and unmarked (L184-189 clears selection only; list L362-413 ignores `invitations`), so the same person can be re-offered; there is no un-offer.
- **SD-4 [IMPORTANT]** Offer step: no review/confirm; label "Offer to {n} selected" / "Offer to the selected" when none (L425); no guidance on how many to offer vs `headcount`; no mention of offer expiry or what the practitioner receives; toast only "Offered to N practitioners" (L187).
- **SD-5 [IMPORTANT]** "Confirm" (L481-487) commits a named person to a shift with one click; toast "Practitioner confirmed onto the shift" (L196) doesn't name them or say what happens next (they are notified, phone shown from 2 days before, roster entry). Button is unnamed per row (X6).
- **SD-6 [IMPORTANT]** Candidate `<button>` toggles selection with no `aria-pressed`/role (L365-373); state is a border colour + "Selected" badge only; contains `div`/`p` (X16). Adoptable pattern: a checkbox/choice-card group.
- **SD-7 [IMPORTANT]** Why a candidate scored as they did is clipped (`w-28 truncate`, L405-407) and fully available only via `title` tooltip (not on touch/keyboard); bars carry no value (`points`/`weight` loaded, L44-46, unused); factor names print raw (`capitalize`, L398 → "proximity", "fatigue") though human titles exist (`matching-rules.ts:148-153` `FACTOR_TITLES`: "Nearness", "Rest"); "score N of 100" unexplained (L382).
- **SD-8 [IMPORTANT]** The explanation for exclusions is collapsed by default at the bottom (`<details>`, L435-462) in muted type, yet the empty state says "The reasons are listed below" (L358). For "Free for part of it … shortening or splitting the shift would bring them in" (`EXCLUSION_WORDS`) there is no way to act (terms can't be edited; no "cancel and republish" shortcut).
- **SD-9 [IMPORTANT]** No status awareness: "Find candidates / Run again" show for DRAFT, FILLED, CANCELLED, EXPIRED (L335-344); no Publish or Cancel here; `ServiceRequest` omits `cancellationTerms`, `specialtyId` (L26-40) though the list page promises "the full cancellation terms" live on this page (`shifts/page.tsx:85-86`).
- **SD-10 [POLISH]** Offer rows: `declineReason` loaded (L79) but not shown (L303-316); "lapses" jargon (L311).
- **SD-11 [POLISH]** Poll (15 s) updates silently: no `aria-live`, no "updated" cue.
- **SD-12 [POLISH]** Title is the profession only (L238), description repeats the date twice (L239); back link hand-rolled (L220-226) where `PageHeader breadcrumbs` now exists; status badge passed as `action` where `meta` now exists.
- **SD-13 [POLISH]** Copy is developer-facing: "No match run yet", "Ranking is a computation, not a decision", "The engine ranks; a person chooses" (L351-352, 429, duplicated reassurance).
- **SD-14 [POLISH]** Phone not tappable, "Phone shown from 2 days before the shift" (L280-288, X13); nested card-in-card EmptyState (L349).

### 2.4 `/facility/roster` + `AttendancePanel`
Files: `roster/page.tsx` (424), `roster/attendance-panel.tsx` (278).
Audience / task: ward manager on the floor, often on a phone; see who is due/arrived, issue check-in/out code, record by hand when the network failed, release a booking.

**Data:** `['roster', facilityId, status, applied, from, to, cursor]` `GET /assignments?…&include=attendance,contact&limit=20` (`placeholderData`; **no `enabled`**, unlike siblings, so it can send `scopeId=null`, L88-110). **No polling** (stale 1 min; focus refetch only). Panel: mutations only. No per-row queries.

**States:** loading Y (L234-241) | first-use empty Y for Confirmed (L254-255), none for other tabs | filtered empty Y (L250-253) | success Y toasts | validation partial (silent disabled L410, L267) | network failure partial generic (L242-246) | permission denied hide-only (cancel, L70,318) | server unavailable = network | archived tabs Y (Completed/Cancelled/No show) | destructive confirm Y for booking cancel (L382-421), N for nothing else.

**Mobile:** X7 (≈1,000px+). The Attendance column (the daily task) and Cancel are the last columns; at 390px only Practitioner and part of Starts are visible.

**Findings**
- **R-1 [IMPORTANT]** Primary on-ward screen fails on a phone (X7). Adoptable: `DataTable` identity/status/`action`.
- **R-2 [IMPORTANT]** No live refresh on the screen used to see who has arrived (no `refetchInterval`); shift detail polls, roster does not.
- **R-3 [IMPORTANT]** X13: numbers auto-revealed and un-tappable; the phone is the one thing a manager needs when someone is late.
- **R-4 [IMPORTANT]** Cancel-booking dialog names the practitioner (L387) but not the shift/time, calls it a "booking" (X14), states no reversibility or late-cancel consequence; row button is an unnamed "Cancel" (L321-331, X6).
- **R-5 [IMPORTANT]** Cancel invalidates `['roster', facilityId]` and tiles only (L115-120): `['shifts']` ("Filled n/m"), `['shift']`, `['shift-assignments']` stay stale, though the dialog says the shift "opens again".
- **R-6 [IMPORTANT]** No way to report a no-show or lateness: the "No show" tab (L53) is read-only; the only attendance fallback needs both check-in and check-out times. Facility cannot raise a dispute either (DP-6).
- **R-7 [POLISH]** Agenda group headings are `<td colSpan>` rows (L275-281), not headings; an empty `<th>` heads the cancel column (L269).
- **R-8 [POLISH]** Client re-sorts the page ascending (L122-124); history tabs open at oldest (X17). Start and End columns each repeat the date (L299-307).
- **R-9 [POLISH]** Page description is jargon about evidence design ("that direction is what makes it evidence rather than proof somebody owns a phone", L148). Redundant "Search by practitioner" label + "Search by name" placeholder (L179,184).

**`AttendancePanel`**
- **A-1 [IMPORTANT]** The code dialog doesn't say whose code it is (L172-178): "Read this to the practitioner" among 20 rows. Wrong-person risk.
- **A-2 [IMPORTANT]** The code's rules (5 minutes, 5 attempts, supersedes, shown once) are in muted secondary text (L185-188); expiry is a clock time ("lapses 08:05"), no countdown, and the dialog doesn't change after expiry; no copy button; `qr` is returned (L36) but never rendered; the code is a plain number to screen readers (L181).
- **A-3 [IMPORTANT]** Manual record: both datetimes start empty (L64-66), the panel isn't given the scheduled window, so someone types two full datetimes (on a phone date-time pickers); no out-after-in or future-time check; no preview of hours/pay; consequence (feeds the timesheet) unstated; button silently disabled (L267). Reason rule (≥10) is stated by an Alert (L255-260), good; Alert is `role=alert` on open (X10).
- **A-4 [POLISH]** Hard-coded ids `in`, `out`, `break` (L210-230); vestigial `attendance` shim (L69); two dialogs mounted per row.

### 2.5 `/facility/timesheets`
File: `timesheets/page.tsx` (663).
Audience / task: owner/administrator (finance); decide submitted timesheets (approve a named amount, reject with a reason, correct).

**Data:** `['roster-for-timesheets', facilityId, tab, from, to, cursor]` `GET /assignments?…&include=timesheet,contact&limit=50` (no `enabled`, no `placeholderData`, so tab/page changes flash the skeleton, L134-154); imperative `api.get(.../attendance)` inside `openCorrection` (L180-182, on click, not a query). Mutations refresh query + tiles. No polling, no per-row queries.

**States:** loading Y (`QueueSkeleton`, L379-380) | first-use empty Y (L396-402) | filtered empty partial: "Nothing matches that" can be wrong when `nextCursor` exists (T-4) | success Y | validation partial: reject needs ≥10 chars, rule only in label (L485-487,521) | network failure partial generic (L381-385); correction-times failure **silent** (L190-193) | permission denied N (403 → "roster could not be loaded") | server unavailable = network | archived Y ("Approved" tab, read-only) | destructive confirm **N**: Approve and Reject are single clicks (L504-527).

**Mobile:** best of the set: cards stack, `DetailGrid` auto-fit, buttons wrap, dialog single-column. Filter select unlabeled (X1).

**Findings**
- **T-1 [IMPORTANT] The approver can't see what they are approving against.** Card shows Worked / Break / Billable / To be billed (L429-436) and only the shift **start** (L420-423); actual check-in/out and the scheduled window are not on the card (they are fetched only when "Correct the hours" is opened, L180-182). "8h" can't be sanity-checked.
- **T-2 [IMPORTANT]** Approve/Reject execute on one click. Consequence appears only in the header and the toast ("Approved — the shift is now completed", L221): not stated that invoicing/payment follow or that it can't be undone. Strength: the button carries the amount ("Approve ₦…", L517) and sends `seenRevision` (L513) so a stale figure can't be approved. Weakness: nothing names the practitioner (X6); Approve doesn't disable while another mutation is pending (only Reject does, L521).
- **T-3 [IMPORTANT]** "Awaiting decision" mixes actionable and non-actionable cards: any sheet whose attendance isn't SUBMITTED (REJECTED awaiting the practitioner, DISPUTED, CHECKED_OUT…) renders figures, a status badge and **no actions and no explanation** (L479-536). DISPUTED has no link to Disputes.
- **T-4 [IMPORTANT] Paging and client-side filtering disagree.** Rows without a timesheet are dropped **after** paging (L258-260); the practitioner picker is built from the loaded page only (L266-276) and filters that page only; counter "N shown · more on the next page" (L370-375). "No timesheets yet" (L386-403) can display while `nextCursor` exists and the pager (L544) appears under it, so the dashboard tile can say 7 waiting while page 1 says none. 
- **T-5 [IMPORTANT]** "Approved" tab opens at the oldest 50 (server start-ascending); recent approvals are the last page (X17).
- **T-6 [IMPORTANT]** Correction dialog: recorded times load silently after open (L171-194; fields empty until the call returns, no indicator; on failure the empty fields stay and only break/on-call are corrected), no practitioner/shift named (L585-593), no preview of the resulting billed amount; reason ≥10 chars with silent disabled (L652). Good: prefilled break/on-call, "Nothing is overwritten" copy (L588-592).
- **T-7 [POLISH]** Reject reason is the same textarea as approve notes (L215) with a reject-only placeholder (L492); success copy for reject doesn't say the practitioner is told or can resubmit (L222).
- **T-8 [POLISH]** Night/Overtime/Holiday/On-call and the allowance sentence (L443-455) drive the money but sit in secondary muted type; revision list shows reason only, not who/when (`actorId`, `createdAt` loaded, L85-87, unused).
- **T-9 [POLISH]** No bulk approve, no total across the page, no sort by age/amount. Focus lost when the approved card unmounts (X11). Redundant `settling` and unstable `useMemo` deps (L264,268-276,379).
- **T-10 [POLISH]** Jargon "assignment" (L296); phone shown though not needed (X13).

### 2.6 `/facility/invoices`
File: `invoices/page.tsx` (207).
Audience / task: finance; how much do we owe, and for which shifts.

**Data:** single `useInfiniteQuery(['facility-invoices', facilityId])` `GET /invoices?facilityId=&billedOnly=true&limit=25`; totals from page 1 (`outstandingKobo`, `outstandingCount`, `paidKobo`). No polling, no duplicates.

**States:** loading Y (AmountFigure skeletons + `QueueSkeleton`, L102,115-116) | first-use empty Y (L122-127) | filtered n/a (no filters) | success n/a | validation n/a | network failure Y for the figures ("Could not load", `AmountFigure`) / partial for the list (generic, L117-121; a failed `fetchNextPage` swaps the whole loaded list for this alert) | permission denied N | server unavailable = network | archived: VOID shown as ordinary grey card (I-1) | destructive n/a.

**Mobile:** each invoice's 7-col line table scrolls inside its card (comment L154); header right block (`₦ + badge`) competes with left text at 310px.

**Findings**
- **I-1 [IMPORTANT]** Invoice statuses ISSUED / PAID / VOID are not in `status-badge.tsx` `VARIANTS`, so all fall to grey `secondary` (L149): an unpaid and a paid invoice look identical in the list; "which are unpaid" requires reading the word. (Badge now has an icon per tone but the tone is still neutral for all.)
- **I-2 [IMPORTANT]** Nothing to act or find with: no filter (unpaid / period), no search by number, no download/print, no due date, no "how to pay"/reference/bank detail. The record has `paymentReference`, `paidOn`, `payerName` (`prisma/schema.prisma:2043-2046`) and no due date; none shown or linked. No link from a line to its shift/timesheet/dispute.
- **I-3 [IMPORTANT]** Every invoice expands every line (L153-189): 25 invoices × N shifts on one page; no collapse or summary row; nested tables have no caption/name (L156); money cells are secondary-size (L171-183).
- **I-4 [IMPORTANT]** The dashboard spend chart counts DRAFT invoices as invoiced (`facility-summary.ts:94`, `status <> 'VOID'`) while this page deliberately hides drafts "showing it as a bill would be showing an amount nobody has asked for yet" (L60-63, `billedOnly=true`): totals disagree.
- **I-5 [POLISH]** Invoice number and amount are `<p>` not headings (L134,148); header pattern duplicates timesheets (L414-426).
- Good: money always `formatNaira`, dates `formatDate`; totals from server not a page sum (L67-68).

### 2.7 `/facility/rates` + `RateCardDialog`
Files: `rates/page.tsx` (126), `rates/rate-card-dialog.tsx` (200; line numbers below are file-relative).
Audience / task: owner/administrator; set night/holiday/overtime/on-call multiples (priced into invoices).

**Data:** `['rate-cards', facilityId]` `GET /rate-cards?facilityId=` only. Dialog: mutation. No per-row queries (a dialog instance per ACTIVE card, no fetch).

**States:** loading Y (L64-65) | first-use empty Y copy, partial: no CTA in the empty state (button is in the header, L72-76) | filtered n/a | success Y toast | validation partial (min 1, max 5 Alert, not tied to field) | network failure partial generic (L66-70) | permission denied N | archived (superseded cards listed) Y | destructive: **superseding the current card is one click** (dialog L192-195).

**Mobile:** cards and dialog (single column below `sm`) fine.

**Findings**
- **RT-1 [IMPORTANT]** The pricing consequence arrives after the click: "It prices every shift invoiced from now on" is only in the success toast (dialog L98-100). Before saving the user sees neither an effective date nor whether already-approved timesheets are re-priced. "Make it active" supersedes immediately.
- **RT-2 [IMPORTANT]** Naming mismatch: row button "Edit" (page L96-98) opens "Update the rate card" (dialog L129) and saves a **new** card that supersedes the old; the name defaults to "<name> (updated)" (dialog L80), growing "(updated) (updated)".
- **RT-3 [POLISH]** Validation Alert appears only when invalid and isn't attached to a field (dialog L108-111, 177-185); hints and the "× the agreed rate" unit sit outside the label/`aria-describedby` (L164-166); worked example is night-only and hard-codes "₦5,000" outside `formatNaira` (L113-114, 172); no preview for holiday/overtime/on call.
- **RT-4 [POLISH]** Unsaved edits survive Cancel in edit mode (dialog L120-123 reset only the name when `!editing`; multiples never reset).
- **RT-5 [POLISH]** Four grey "1×" badges per card are noise (page L109-118); `asMultiple` is a local formatter (page L28). Nav puts "Rates and allowances" under "After the shift" (`console-layout.tsx:56,76-81`) though it prices shifts.

### 2.8 `/facility/profile` + `DocumentUpload`
Files: `profile/page.tsx` (375), `components/app/document-upload.tsx` (177).
Audience / task: owner/administrator; check what Medilink holds, fix address/contact/licence, resubmit after a rejection.

**Data:** `['facility-profile', facilityId]` `GET /facilities/:id` (**same URL as `['facility', id]`**, so a second fetch under another key; default 1-min stale vs 5-min for the other); on-demand `POST /facilities/:id/licence-url` mutation. **Blocking:** `!facilityId || facility.isPending` replaces the whole body with `Skeleton h-64` (L149-156; header kept).

**States:** loading partial (L149-156) | first-use n/a | filtered n/a | success partial: toast only ("Saved"), form repopulates from refetch (L87-97) | validation N: no field errors; server messages toast-only (L140) | network failure partial generic (L158-167) | permission denied partial: `canEdit` false → all inputs just `disabled` with no reason (L249,261,271,293,303) | archived n/a; REJECTED/PENDING banners Y (L178-199); **lapsed licence N** | destructive: licence change on a VERIFIED facility sends it back to review: inline warning (L335-342) but no confirm; Save is at page bottom (L347-372).

**Mobile:** two-column grid at `lg` only, stacks below; the licence-change warning sits in card 2 while Save is at the page foot, a full screen apart.

**Findings**
- **P-1 [IMPORTANT]** X12: "View" licence opens via `window.open` after the fetch (L143-147), blocked on iOS with no fallback.
- **P-2 [IMPORTANT]** Licence expiry is invisible as a state: `licenceExpiresAt` only populates a date input (L297-305); `publishBlockers` (`licence_expired`) are never shown, so the owner isn't told publishing is blocked or why. Note: the date goes through `z.coerce.date()` as UTC midnight (`facilities/presentation/schemas.ts:94`) and `canPublish` compares `licenceExpiresAt <= now` (`facilities/domain/facility.ts:51`), so a licence "expiring 31 March" blocks publishing from 01:00 WAT on 31 March (start of the day). Worth a product check; it is what a "licence warning" would be built on.
- **P-3 [IMPORTANT]** Severe consequence without a gate: changing a verified facility's licence means it cannot publish until re-verified (L335-342); the warning is shown, but the button that does it is far away and has no confirmation.
- **P-4 [POLISH]** A cleared email or licence number is ignored (`changes()` L105-110) and Save stays disabled with no explanation.
- **P-5 [POLISH]** Read-only users get disabled inputs (low-contrast, no reason, no "ask the owner"); `<Label>` on static text and on a group (X1 occurrences).
- **P-6 [POLISH]** "The name and type are changed through Medilink" (L205) gives no route (D-7). The two Save buttons don't disable each other while pending (L349-364). `record.canPublish`, `publishBlockers`, `verifiedAt` returned and unused.
- **DocumentUpload (shared)**
  - **U-1 [IMPORTANT]** The hidden `<input type="file" class="sr-only">` after the button (L158-167) stays tabbable and unnamed: two tab stops, the second with an invisible focus target.
  - **U-2 [POLISH]** "Uploading…" is text only (L152): no progress, no `aria-live` for busy/success/replace; "Remove" doesn't name the file (L113-123); HEIC check by `file.type` (L66) is fragile on iOS; the only error is the `role=alert` Alert (good, L169-174).

### 2.9 `/facility/staff` + `StaffManager`
Files: `staff/page.tsx` (47), `components/app/staff-manager.tsx` (823, shared with admin), `step-up.tsx`, `lib/ui/staff-roles.ts`.
Audience / task: **owner only** (`role.grant`); invite colleagues by phone, change role, remove access.

**Data:** `['staff', 'FACILITY', id]` `GET /grants` (`retry:false`), `['staff-invitations', id]` `GET /staff-invitations` (`enabled: isFacility`); page also `useFacility` (`['facility', id]`). Both load immediately; no polling, no per-row queries.

**States:** loading Y (`QueueSkeleton`, L497-498, 520-521) | first-use empty Y/partial ("Nobody yet. Add someone above", L528: an owner is always listed; the invite form is above) | filtered n/a | success Y toasts, with good "what next" for invite (L151-153) | validation N: phone not validated (only non-empty, L376), reason ≥5 silent (L643,685,723) | network failure Y distinct from empty but generic (L499-503, 522-526) | permission denied Y (step-up lock card, L285-306; nav hides) | server unavailable = network | archived: past access list Y (L576-591) | destructive confirm Y (three dialogs, each names the person and the consequence; no reversibility line).

**Mobile:** role cards full width, rows `flex-wrap` three buttons; the two forms come first so the list is far down a phone page (ST-4).

**Findings**
- **ST-1 [CRITICAL for contrast]** "Remove all access now" uses `text-destructive` (L561): in dark mode that is 3.32:1 on the card (computed; AA needs 4.5:1). The token built for this, `destructive-text`, gives 6.5:1. Beyond contrast: three overlapping removal buttons per row at equal weight ("Change role", "Remove access", "Remove all access now", L544-568) with no person in the accessible name (X6) and a non-obvious difference between the last two.
- **ST-2 [IMPORTANT]** Own row and last owner: a "You" badge shows (L537) yet all three actions are offered on yourself; the server refuses removing a facility's last owner (`auth/application/grants.ts:318-363`) only after the click, as a toast. No warning in the dialog ("this is you").
- **ST-3 [IMPORTANT]** Role choice is under-informed and over-broad. Only two roles are offered (`staff-roles.ts`); the administrator description lists publishing, staffing, attendance, timesheets, incidents but **omits** invoices, rate cards, facility profile/licence edit and payout management that the role holds (`permissions.ts:196` bundle). A finance person must be given everything an administrator can do. Descriptions are secondary-size muted (L368,465,623). Choice is a set of `aria-pressed` toggle buttons instead of a radio group (L345-350,442-447,611-616).
- **ST-4 [POLISH]** Order: invite form(s) first, then Invitations, then "Who has access" (L309-592): the page's main job (see/maintain who has access) is last.
- **ST-5 [POLISH]** Invitation "Cancel" is ambiguous and spins on **every** row (single boolean `cancelling`, L508,797); expired shows "Ran out" (L744); earlier lists are plain text, not badges (L813-816).
- **ST-6 [POLISH]** Phone field: no `type=tel`/autocomplete/format hint beyond a placeholder; example differs from register (X14).
- **ST-7 [POLISH]** `Badge` (div) inside `<p>` (L535-538). Staff page replaces the manager with a warning when unverified (`staff/page.tsx:28-34`), contradicting dashboard/register (D-4).
- Good: step-up retry pattern (`guarded`, L99-103), preserved input after failure, explicit "Keep their access"/"Leave it as it is" dismiss labels, invite toast says one text, nothing changes until they say yes, and it lasts a week.

### 2.10 `/facility/incidents` + report + detail
Files: `incidents/page.tsx` (311), `incidents/report-incident-dialog.tsx` (268), `incidents/incident-detail-dialog.tsx` (94; line numbers file-relative).
Audience / task: ward manager; file an incident quickly, read the outcome of past reports.

**Data:** `['facility-incidents', facilityId, status, severity, category, applied, cursor]` `GET /incidents?facilityId=…&limit=20`; dialog `['incident-recent-shifts', facilityId]` `GET /assignments?…&from=&to=` (`enabled: open`, good; **no `limit`, all statuses, 14 days**). Detail dialog: none.

**States (list):** loading Y (3 × `h-24`) | first-use empty partial: "Nothing reported yet", no description/CTA (L246-247) | filtered empty Y | success Y (toast "Reported … cannot be edited or withdrawn") | validation partial: identifier + ≥20-char checks Y (L227-237) but not tied to the field, others none | network failure partial generic (L238-242) | permission denied N | archived/closed Y (detail dialog shows outcome and notes) | destructive/irreversible: Y notice before submit (`report-incident-dialog.tsx:240-246`).

**Mobile:** filter card = search + 3 selects + Search/Clear stacked above the first result (L128-224); `FilterBar` adoptable. Dialog single column.

**Findings**
- **IN-1 [CRITICAL via X1]** Status, Severity, Category on the page and Category, Severity, Shift in the dialog have no accessible name.
- **IN-2 [IMPORTANT]** The report form pre-answers the two safety fields: severity defaults to NEAR_MISS and category to MEDICATION (L79-80). A serious event is recorded as "Near miss" unless the user notices; for an irreversible safety record these should be explicit choices.
- **IN-3 [IMPORTANT]** Shift picker: unbounded, non-searchable `Select` (Combobox exists); loading and error unhandled (L195-207), so on failure it silently offers only "Not about a particular shift or person" and the user may file an unlinked report believing there are no shifts. Lists CANCELLED/NO_SHOW too, with no status.
- **IN-4 [POLISH]** Patient-identifier error is `role=alert` (good, L228) but not tied to the textarea via `aria-describedby`/`aria-invalid`; counter not announced (L233-237).
- **IN-5 [POLISH]** Success gives no reference number; the incident `id` isn't displayed anywhere (detail dialog L49-80) to quote to compliance; no escalation guidance for severe/death and no support contact (D-7).
- **IN-6 [POLISH]** "When it happened" starts empty (L78), could default to now. Whole-card `<button>` with block children (L252-266, X16). Nav label "Report an incident" vs h1 "Clinical incidents" (X14). OPEN and REPORTED both exist, both amber, unexplained (L27-33). Detail dialog titles with the category not the summary (detail L49); hand-rolled uppercase label (detail L75-80).

### 2.11 `/facility/disputes` (owner only)
File: `disputes/page.tsx` (330).
Audience / task: owner; read a case over a shift, add evidence, withdraw a case the facility raised.

**Data:** `['facility-disputes', facilityId]` `GET /disputes?facilityId=` (server `take: 200`, newest first, silently capped, `dispute.ts:643-646`); case detail `['facility-dispute', id]` mounts only when a case is open (`{open && …}`, L129-131, good). No polling; detail not invalidated if Medilink decides while open (dialog reads `row.status` from the clicked snapshot, L158,243).

**States:** loading Y | first-use empty Y | filtered n/a (no filters at all; open and resolved mixed) | success Y toasts | validation partial (type/size, L216-217; error text not announced, L323) | network failure partial: list generic; **detail N** (DP-2) | permission denied N | archived/decided Y alert (L243-250, with DP-4 caveat) | **destructive confirm N** (DP-1).

**Mobile:** cards wrap; dialog `max-h-[90vh]` (L224) overrides the shared dialog's deliberate `90dvh`, so the bottom is under mobile browser chrome.

**Findings**
- **DP-1 [CRITICAL] "Withdraw this case" is one click, irreversible and styled like a neutral button.** `variant="outline"` identical to "Choose a file" (L302-318); `withdraw.mutate()` with no dialog; the consequence ("The case stays on record, marked withdrawn") appears only in the success toast (L194); the page elsewhere says money for a disputed shift is held back until decided (L98-99), so what withdrawing does to that hold is never said.
- **DP-2 [CRITICAL] Failed load of the evidence list reads as "Nothing has been attached yet."** (L256-260: `isPending → Loading… : length===0 → empty`; no `isError` branch). Evidence can never be removed (L321), so a user acting on a false empty adds permanent duplicates.
- **DP-3 [IMPORTANT]** Evidence is uploaded the instant a file is chosen, with whatever note is in the field then (L213-220, L299); no filename shown, no confirm; the irreversibility notice sits below the button at secondary size (L320-322).
- **DP-4 [IMPORTANT]** Outcome alert is amber ("warning") for every UPHELD regardless of who raised it (L244): upheld in the facility's favour looks like bad news; "Decided: upheld." never says for or against whom.
- **DP-5 [IMPORTANT]** Evidence rows show author and time only (no filename/type, `Evidence` L39-45), each with an "Open" button identical to the case-card "Open" (L118,275) and opened via async `window.open` (X12).
- **DP-6 [IMPORTANT]** Page copy says a case appears "when you or a practitioner raise one" (L91), and the API supports facility-raised cases (`POST /assignments/:id/disputes`, facility scope), but **nothing in `src/app/facility` calls it** (the only caller is `practitioner/timesheets/page.tsx:121`): no "Dispute this" on roster, timesheets or shift detail.
- **DP-7 [POLISH]** Hand-rolled uppercase labels (L237,253); `StatusBadge` div inside `DialogDescription` `<p>` (L229-232, X16); no status filter though the API accepts one; silent 200 cap.

### 2.12 `/facility/register` + `Combobox`
Files: `register/page.tsx` (263), `components/app/combobox.tsx` (140).
Audience / task: a new hospital's first user; register the facility.

**Data:** `['reference']` only (shared, cached 1 h). Route sits **outside** the guard (`console-layout.tsx:104-110`), by design.

**States:** loading **N** (no skeleton for reference lists, L132-143,178-205) | first-use n/a | filtered n/a | success Y (toast + redirect, L70-83) | validation partial: silent disabled (`ready`, L87-93), no required markers, server errors toast-only (L84) | network failure **N** | permission n/a | destructive: irreversible-ish, no review (RG-3).

**Mobile:** `sm:grid-cols-2` collapses; combobox popover full width.

**Findings**
- **RG-1 [CRITICAL via X1]** "Type" select unnamed (L131-133). Combobox: trigger `role=combobox` without `aria-haspopup`/`aria-controls` (`combobox.tsx:66-72`), and its search input is named only by its placeholder (L103).
- **RG-2 [IMPORTANT]** If `/reference` is slow or fails, Type/State/LGA are empty lists with no message (L137,180,198); the form cannot be completed and nothing says why.
- **RG-3 [IMPORTANT]** No review step and no warning that name and type become uneditable ("changed through Medilink", `profile:205`; CAC editable only after refusal, `profile:215`). A typo in the name or registration number is effectively permanent.
- **RG-4 [IMPORTANT]** "What next" is wrong or vague: lands on the dashboard whose PENDING banner doesn't point to the licence upload (profile) and promises staff access the staff page refuses (D-4). The form collects a licence **number** only (L238-252).
- **RG-5 [POLISH]** Required fields are unmarked (only optionals say "optional"); `contactPhone.trim().length >= 7` is the whole phone check (L93); name guidance is a placeholder that vanishes while typing (L126); `searchPlaceholder="Search 37 states…"` hard-coded (L190); copy drift (X14).

### 2.13 Layout, guard, switcher
Files: `layout.tsx` (16), `console-layout.tsx` (160), `facility-switcher.tsx` (76). Line numbers are file-relative.
- **L-1 [POLISH]** Account with none of the five permissions the guard checks (`console-layout.tsx:104-110`) sees "Register a facility" as the main button (L129-131); acceptable, but it also appears for an invitee who has not yet accepted (the invitation card renders first, L120).
- **L-2 [POLISH]** Switcher: trigger forced to `h-8` (32px, `facility-switcher.tsx:63`) over the shared 44px; `Loading…` as a menu item (L69); `resetQueries` on switch (L56-62) gives no "Now acting for X" announcement; `useQueries` fires even with one facility (L37-45; deduped with `useFacility`).
- **L-3 [IMPORTANT]** All facility pages share the title "Medilink" (X8).
- **L-4 [POLISH]** IA: "After the shift" holds Rates and "Report an incident" (`console-layout.tsx:56,76-87`). No `loading.tsx` or facility `error.tsx` (global ones exist).

---

## (a) Patterns repeated in 3+ places here (candidate shared components)

| Pattern | Occurrences (file:line) | Candidate |
|---|---|---|
| Cursor pager (Prev/Next, "Page n · loading") + `cursors[]`/`pageIndex` state | `shifts/page.tsx:122-129,440-475`; `roster/page.tsx:79-86,345-380`; `timesheets/page.tsx:125-132,544-579`; `incidents/page.tsx:76-83,271-306` | `useCursorPager` + `<Pager>` (not in flight) |
| Filter card: search + selects + dates + Search + Clear + "N on this page" | `shifts:211-298`; `roster:168-232`; `incidents:126-230`; `timesheets:317-377` (variant) | `FilterBar` (in flight, untracked) |
| Status tabs without panels | `shifts:194-209`; `roster:151-166`; `timesheets:299-315` | `StatusTabs` (aria-correct) |
| Reason-required confirm dialog (object named, consequence, reversibility, counter, disabled reason) | `shifts:477-516`; `roster:382-421`; `staff-manager:596-654,656-696,698-734`; `timesheets:483-527,581-660` (variant); `attendance-panel:198-275` (variant) | `ReasonDialog` (not in flight) |
| Label + Radix Select with no association | 12 sites in X1 | `SelectField` |
| Toggle-card choice (role cards, candidates) | `staff-manager:342-374,439-471,606-627`; `shifts/[id]:365-411` | `ChoiceCardGroup` (radio/checkbox semantics) |
| Record-card header (title+meta left, amount+status right) | `timesheets:414-426`; `invoices:132-151`; `disputes:106-122`; `incidents:252-266`; `shifts/[id]:274-291,304-315,475-489`; `staff-manager:533-570,774-801`; `my-invitations:74-103` | `RecordCard`/`DataTable` card layout |
| Generic destructive Alert for load failure | 10 sites in X2 | `ErrorState` (in flight) |
| Four skeleton idioms | `shifts:300-307`; `roster:234-241`; `incidents:232-237`; `profile:153`; `QueueSkeleton` elsewhere | `ListSkeleton`/`TableSkeleton` (in flight) |
| Hand-rolled form dialog (`useState` per field, `disabled={!ready}`, no `<form>`, toast errors) | `new-shift-dialog`; `attendance-panel:198-275`; `timesheets:581-660`; `rate-card-dialog`; `report-incident-dialog`; `register`; `profile` | `FormDialog` + `useZodForm` (hook exists, unused) |
| Phone line (`font-mono` + "Phone shown from 2 days before the shift") | `roster:289-297`; `shifts/[id]:280-288`; `timesheets:417-419`; `staff-manager:778` | `PhoneLink` (`tel:`, withheld state) |
| Open signed URL after await | `profile:143-147`; `disputes:201-211` | `useOpenSignedUrl` |
| Uppercase muted mini-label | `disputes:237,253`; `incident-detail:75-80`; `Detail` | use `Detail`/`h3` |
| `<details>` disclosure in muted type | `shifts/[id]:436-461`; `timesheets:458-476`; `staff-manager:577-590,807-819` | `Disclosure` |
| Irreversibility notice in muted text after the action | `disputes:320-322`; `attendance-panel:185-188` | `ConsequenceNote` inside `ReasonDialog` |

## (b) Top 10 findings, ranked

1. **[CRITICAL] 12 unnamed comboboxes and 16 orphan labels (X1)**, including every filter and both creation dialogs (new shift, report incident). One-attribute fix, already done correctly at `register/page.tsx:147-152`.
2. **[CRITICAL] Disputes: "Withdraw this case" is a one-click, irreversible, neutral-looking button (DP-1)**, and evidence uploads are immediate and permanent with the warning below the button (DP-3).
3. **[CRITICAL] Errors masquerading as empty (X2/DP-2):** dispute evidence reads "Nothing has been attached yet." on a failed load while evidence can never be removed; dashboard charts, incident shift picker, register reference lists and hidden agreements/invitations do the same; no screen has a Retry.
4. **[IMPORTANT] Publishing a shift (N-1…N-6):** no review, silent ₦5,000 and cancellation-terms defaults, a failed publish leaves a draft and a retry makes another, `canPublish`/blockers known but unused, no link to staff it afterwards.
5. **[IMPORTANT] Timesheet decisions are made half-blind (T-1…T-5):** no actual/scheduled times on the card, one-click approve/reject, inert "Awaiting decision" cards, rows dropped after paging, history opens at the oldest.
6. **[IMPORTANT] Roster on a phone (R-1…R-3, A-1…A-3):** ≈1,000px table puts attendance and cancel off-screen, no live refresh, numbers not tappable and auto-revealed, manual record starts blank, code dialog doesn't name the person.
7. **[IMPORTANT] Dashboard doesn't answer "what needs me today" (D-1…D-4, D-11):** "roster" tile is an all-time count labelled "due on the floor", no offers/attendance/licence signal although licence data is already fetched, contradictory staff-access copy.
8. **[IMPORTANT] Row actions that don't name their row, and focus loss when the row disappears (X6, X11):** identical "Cancel/Open/Approve/Confirm" labels across every list and card.
9. **[IMPORTANT] Privacy/audit noise (X13):** `include=contact` on roster, timesheets and shift detail writes a reveal audit row per visible row on every refetch, for numbers nobody asked to see.
10. **[CRITICAL for contrast / IMPORTANT for the rest] Staff removal stack (ST-1…ST-3):** "Remove all access now" is 3.32:1 in dark mode, three near-identical removal buttons per row, no self/last-owner warning, role descriptions omit invoices/rates/licence edit and only two roles exist.

---

## (c) Dashboard: exact sections, data sources, and what the endpoint already returns

**Sections of `src/app/facility/page.tsx`, in render order**
1. `PageHeader` (L155-158): h1 = `facility.data?.name ?? 'Your facility'`; static description. Source: `GET /api/v1/facilities/:id` (`useFacility`).
2. `<MyInvitations />` (L161): invitations addressed to the signed-in phone; renders nothing if none. Source: `GET /api/v1/staff-invitations/mine`.
3. Facility-status banner (L163-195): PENDING (warning), REJECTED (destructive, with `reviewNotes`, link to profile), SUSPENDED (destructive). Source: facility record `status`, `reviewNotes`.
4. `<FacilityAgreements />` (L197): outstanding agreements to read and accept; renders nothing if none. Source: `GET /api/v1/agreements/facility?facilityId=`.
5. Either `nothingGranted` card (L199-205) or the **tile grid** (L207-247): "Shifts published" (`published`, needs `service_request.read`), "Confirmed on the roster" (`roster`, `attendance.record`), "Timesheets to approve" (`awaitingApproval`, `timesheet.approve`). Source: `GET /api/v1/dashboard/facility?facilityId=`.
6. **Chart row** (L249-293): "Staffing your shifts" (`fulfilment`, `service_request.read`), "What you're spending" (`spend`, `invoice.read`). Same endpoint.

**`GET /api/v1/dashboard/facility?facilityId=<uuid>`** (`src/app/api/v1/dashboard/facility/route.ts` → `modules/audit-compliance/application/facility-summary.ts`). 403 if the caller holds none of `service_request.read | attendance.record | timesheet.approve | invoice.read` at that facility; each section is present only if its permission is held. Returns:

| Field | Type | Present when | Exact meaning |
|---|---|---|---|
| `published` | int | `service_request.read` | count of requests with status PUBLISHED, not deleted, **any start date** |
| `fulfilment[]` | `{week:'YYYY-MM-DD' (Monday), needed:int, filled:int}` | `service_request.read` | last 26 weeks **and all future weeks**; `needed = Σ headcount` of every non-DRAFT request **including CANCELLED/EXPIRED**; `filled = Σ min(non-cancelled assignments, headcount)`; week bucket is `date_trunc('week', starts_at)` with no Lagos conversion (a Mon 00:30 WAT shift lands in the prior week), unlike `spend` which converts |
| `roster` | int | `attendance.record` **or** `timesheet.approve` | count of assignments with status CONFIRMED, **all dates** (includes worked shifts awaiting approval) |
| `awaitingApproval` | int | `timesheet.approve` | CONFIRMED assignments whose attendance record is SUBMITTED |
| `spend[]` | `{month:'YYYY-MM' (Lagos), invoicedKobo, paidKobo}` | `invoice.read` | last 24 months by `period_start`; `invoicedKobo = Σ gross where status <> 'VOID'` (**includes DRAFT**), `paidKobo = Σ gross where PAID` |

**Needs of a redesign vs what exists (no new requests):**

| Signal | Status |
|---|---|
| Today's coverage | **Absent.** `roster` is all-time CONFIRMED; `fulfilment` is weekly. No per-shift or per-day data. |
| Unfilled / open shifts | **Partial.** `published` (count only, no urgency/start-soon, no list); this/next week's gap derivable from `fulfilment` (but polluted by cancelled shifts). |
| Offers awaiting response | **Absent.** Only per shift via `GET /service-requests/:id/invitations`; no aggregate. |
| No-show / attendance warnings | **Absent.** (Facility can't mark no-shows either, R-6.) |
| Timesheets awaiting approval | **Present as a count** (`awaitingApproval`); no oldest age, no amount. |
| Licence warnings | **Absent from the summary, but available now** in the facility record the page already fetches (`GET /facilities/:id`): `licenceExpiresAt`, `licenceNumber`, `canPublish`, `publishBlockers[]` (`deleted | suspended | not_verified | licence_expired`), `verifiedAt`. The client type `FacilitySummary` (`lib/ui/facility.ts:8-14`) only declares `id,name,status,reviewNotes`. |
| Invoice / payment summary | **Partial.** Monthly invoiced vs paid (invoiced includes drafts). No outstanding or overdue total in the summary; `GET /invoices` returns `totals {outstandingKobo, outstandingCount, paidKobo}` (billed only) but the dashboard doesn't call it. |
| Staff-access warnings | **Absent.** No pending-invitation count, sole-owner flag or step-up state; grants/invitations need `role.grant` and separate calls. Only the user's own incoming invitations (`MyInvitations`) and outstanding agreements are surfaced. |
| Other already on the page | Session permissions/grants (SSR'd), facility `status`/`reviewNotes`, outstanding agreements, own invitations. |
