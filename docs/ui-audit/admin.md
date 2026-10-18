> **Detailed audit — admin screens.** Written by reading every file in scope, in full, against commit
> `7ad839c` (the base of this work). File and line references are to that commit unless a note says a
> shared primitive has since changed. Findings tagged `[fixed in WT]` or "adoptable" refer to
> shared components that were being built while this was written; the summary in
> [../ui-ux-audit.md](../ui-ux-audit.md) says what has actually been done about each. Nothing here is a
> change; it is the evidence behind the summary.

# Medilink admin console: UI/UX and accessibility audit (read-only)

Scope: all 21 routes under `src/app/admin/**` (about 11.6k lines in 36 source files), every client component they import (`*-detail.tsx`, `evidence-review.tsx`, `credentials-tab.tsx`, `standing-panel.tsx`, `new-facility-dialog.tsx`, `reconciliation-card.tsx`, `growth-chart.tsx`, plus shared `staff-manager.tsx` 823, `payout-account-panel.tsx` 272, `document-dialog.tsx` 119, `combobox.tsx` 140, `money-charts.tsx` 108, `step-up.tsx` 152, `console-shell.tsx` 392, `motion.tsx` 87), and the server code that decides what the screens show (list ordering, dashboard summary).
Method: every file in `src/app/admin` and every shared component listed above read in full (shell extras such as the bell, suggestion dialog and text-size control only where they affect admin screens); cross-cutting greps; server ordering and step-up rules read from `src/modules/**` and `src/lib/authz/permissions.ts`. No file in the repo was modified.

Reading notes
- Priorities: **CRITICAL** (misleads or can harm a person or money decision), **IMPORTANT** (slows or endangers queue-clearing, or fails accessibility basics), **POLISH**.
- State codes: Y = handled, P = partial, N = not handled, "-" = not applicable.
- Line numbers refer to the working tree on 2026-10-18. Files under `src/app/admin/**` are unmodified (`git status`). During the audit another process edited shared primitives (`globals.css`, `tailwind.config.ts`, `ui/badge|card|dialog|sheet|skeleton.tsx`, all uncommitted). Findings cite the state at the final read: global `:focus-visible` fallback ring now exists, dialog close is 44px, skeleton is `aria-hidden`.
- **Type scale (important):** `tailwind.config.ts:86-93` remaps `text-xs` to 14px and `text-sm` to 16px (`text-base` is also 16px). Only one text size is below 14px in the whole scope: `text-[10px]` on the bell count (`notification-bell.tsx:79`, aria-hidden, button has an aria-label with the count). "12px text" is therefore NOT a finding. The class names no longer mean what shadcn docs imply, which is a contributor hazard (`CardTitle text-sm` and `text-base` render identically, so that split is naming drift only).
- Only two platform roles exist (`permissions.ts:180-192,227`): `administrator` and `super_administrator`. Operations, compliance, clinical safety, support and finance staff all hold the same bundle (super adds `config.manage`). Consequences: no role-specific queues exist, nothing prevents two officers working the same row, and "permission denied" only occurs for the four `config.manage` pages and `role.grant`.

---

## 0. Cross-cutting findings (referenced as S-xx from the screens)

**S-01 [CRITICAL] A failed fetch is drawn as a true zero / "all clear".** `finance/page.tsx`: totals default `?? 0` (89-94), tiles have no error branch so show "₦0.00" (196-200), charts say "Nothing invoiced yet." (219-221) and "Nothing outstanding. Every issued invoice has been paid." (237-240) when the summary request failed. The only error is one Alert further down inside the invoices card (256-260). `AmountFigure` (`amount-figure.tsx:8,37`) was written precisely so "₦0.00" and "could not find out" never look alike; Finance doesn't use it. Same family (silent, reads as empty): `payouts/page.tsx:254` (accounts-waiting list has no loading/error branch), `suggestions/page.tsx:99` (area summary), `evidence-review.tsx:58` (`return null` on error, comment says "the credentials tab already says so" but the officer is on the other tab), `incident-detail.tsx:79-89` (`fresh` has no error/pending UI: subject and shift just vanish), `invoices/page.tsx:94-100,362-371` (facility list error gives an empty combobox), `reconciliation-card.tsx:49-51` ("could not be run" in muted text; a reconciliation that did not run is shown like a pass).

**S-02 [IMPORTANT] Errors are one generic sentence, with no retry, no cause, no permission-denied state.** "This queue could not be loaded." on credentials:255, facilities:199, incidents:240, disputes:163, unhonoured:161, data-requests:207, suggestions:174 (practitioners:858 "The directory could not be loaded."). 401, 403, offline and 5xx are indistinguishable; `errorMessage()` is never rendered for reads. `SessionProvider` has the right model ("Could not reach Medilink" + Try again, `session.tsx:107-120`) that no page copies. Default query retry makes a 5xx show a skeleton for three attempts first on every list (`providers.tsx:38-41`), while the dashboard, finance and every detail query set `retry:false` (`page.tsx:146`, `finance/page.tsx:85`, `facility-detail.tsx:83,94`), so the same outage looks different per screen. A user who types a `config.manage` URL (agreements, holidays, rate-floors, levels) gets the same generic alert.

**S-03 [CRITICAL] Consequential decisions are one click: no confirmation of effect, no step-up.** Server step-up covers only `payout.account.change`, `payout.manage`, `data.erase`, `role.grant` (`permissions.ts:79-91`); the console adds step-up only reactively (after a 401) and only on those. Everything below changes a person's ability to work, a legal record, or pay, and has only a "disabled until text typed" button:
- Clear a sanctions flag (`practitioners/standing-panel.tsx:163-167`) and Reinstate a suspended practitioner (`:250-254`): docstring `:53-62` says each "returns somebody to clinical work".
- Close incident incl. outcome "Suspend the practitioner" or "Refer to the regulator" (`incident-detail.tsx:300-307`, outcome Select 245-263), with `SYSTEM_ISSUE` preselected (`:73`).
- Dispute Uphold/Dismiss (`dispute-detail.tsx:306-312`; Uphold reopens the timesheet).
- Unhonoured fault: "The practitioner" records a no-show against their reliability score (`unhonoured-detail.tsx:58,243-249`); "Excuse them" (`:411-418`).
- Credential Reject / Ask for more (`credentials/page.tsx:414-427`, `credentials-tab.tsx:218-231`, `evidence-review.tsx:245-258`); data request Refuse (`request-detail.tsx:368-375`); suggestion Decline (`suggestion-detail.tsx:259-267`).
- Sanctions bulk add (up to 500, all-or-none; flags people) with no preview (`sanctions/page.tsx:302-309`); Rate floor set, append-only (`rate-floors/page.tsx:230-236`); Holiday remove changes pay (`holidays/page.tsx:149-157`); Agreement publish retires the current text and forces everyone to re-accept (`agreements/page.tsx:268-270`); Level/category retire (`levels/page.tsx:154-161,231-238`); System event replay "including any text it sends" (`system/page.tsx:229-236`, copy 193-194); Invoice Issue (`invoices/page.tsx:490-497`); Payout Release/Prepare (`payouts/page.tsx:485-498,549-556`).
Only erasure has a typed confirmation + step-up (`request-detail.tsx:84,148-199`). Where step-up does fire, its dialog restates only a generic page-level purpose (`invoices:119`, `payouts:128`, `step-up.tsx:76`) and then silently re-runs the action (`step-up.tsx:143-147`), so the person re-enters a password without seeing the amount or payee that will be acted on.

**S-04 [IMPORTANT] Dialog text survives an explicit Cancel (bug class from ~10 hand-rolled dialogs).** `onOpenChange` clears state but the Cancel/Back/Keep buttons call `setX(null)` directly, which never fires it: `invoices/page.tsx:253` (void reason), `payouts/page.tsx:442-444` (reason), `sanctions/page.tsx:195` (remove reason is then shown for the next person), `payout-account-panel.tsx:183`, `data-requests/request-detail.tsx:186` (after Cancel the typed "ERASE" stays, so reopening the same request starts with the confirmation already armed), `staff-manager.tsx:555` + `718-720` (revoke reason never reset on open). `new-facility-dialog.tsx:108-115` closes without resetting 12 fields, so reopening shows the last facility and representative.

**S-05 [IMPORTANT] 18 Selects have a `<Label>` that is not bound to anything.** `Label` has no `htmlFor` and the Radix trigger has no `id`, so the control's accessible name is just its current value ("Any severity") with no field name: `incidents/page.tsx:136,158,181`, `incident-detail.tsx:245`, `data-requests/page.tsx:144`, `finance/page.tsx:284`, `audit/page.tsx:145`, `facilities/page.tsx:141`, `credentials/page.tsx:201`, `rate-floors/page.tsx:145,167,184,201`, `agreements/page.tsx:197`, `sanctions/page.tsx:237`, `practitioners/page.tsx:647,709`, `evidence-review.tsx:475`. (Two others are rescued by `aria-label`: `practitioners/page.tsx:202,222`.) The correct pattern already exists: `new-facility-dialog.tsx:153-155,169-171,211-212` and `Combobox id`.

**S-06 [IMPORTANT] Validation is "disabled button with a silent rule"; errors are never tied to fields.** Zero uses of `aria-describedby`, `aria-invalid`, `aria-required` or `required` in `src/app/admin` (grep). `lib/ui/form.ts:13-38` (`useZodForm`) describes this exact anti-pattern and is not used by any admin form. Minimum-length rules are stated three ways: static ("At least 20 characters", `incident-detail.tsx:283-285`), live counter (`dispute-detail.tsx:290-294`, `suggestion-detail.tsx:243-247`, `agreements/page.tsx:257-259`), or not at all (`unhonoured-detail.tsx:244` 10, `request-detail.tsx:361,370` 10, `standing-panel.tsx:163,250` 20, `sanctions/page.tsx:200` 5, `staff-manager.tsx:643,685,723` 5, `payouts/page.tsx:447`). `Button` base has `disabled:pointer-events-none` (`button.tsx:20`) so a disabled button cannot show a title and is not focusable: reason-gated buttons never explain themselves to keyboard users (`credentials/page.tsx:416,423`, `facility-detail.tsx:339-347` seven conditions). Field-level problems are loose `<p>`: `invoices/page.tsx:315-317`, `rate-floors/page.tsx:237-239`, `sanctions/page.tsx:295-301`, `new-facility-dialog.tsx:273-278`; server validation errors go to a toast only (`new-facility-dialog.tsx:116`).

**S-07 [IMPORTANT] Selection, filters, page and tab are `useState`, not URL; focus and scroll are unmanaged; every tab is titled "Medilink".** List-to-detail is `if (selected) return <ScreenTransition>…` (`facilities/page.tsx:84-90`, `incidents:96-102`, `disputes:80-86`, `unhonoured:71-77`, `data-requests:86-92`, `suggestions:84-90`, `practitioners:414-770`). Browser Back leaves the section instead of closing the case, reload loses the case, a colleague cannot be sent a link (only `?user=` exists, `practitioners:261`). `ScreenTransition` only fades (`motion.tsx:178-198`); there is no `focus()`/`scrollTo` anywhere in admin (grep), so after clicking a row focus falls to `<body>` and scroll stays where the list was. `<title>` is the root string for all 21 pages (`app/layout.tsx:5-6`; pages are client components, no metadata), which matters to staff who keep several queues open. Nav links have no `aria-current` and match `pathname === item.href` (`console-shell.tsx:229-251`); the sidebar carries no queue counts or health signal although the counts exist in `/api/v1/dashboard/platform`.

**S-08 [IMPORTANT] `Detail` truncates values silently.** `page-shell.tsx:100` `<dd class="truncate">` in a 9rem minimum column (`:111`), no title/tooltip. The cut part is often the important part: `expiryOf().text` appends "(an estimate, no date was read from the document)" (`format.ts:49`; rendered at `credentials/page.tsx:317`, `credentials-tab.tsx:129`); sanctions match name "Listed as" (`standing-panel.tsx:133`) where the officer compares names; facility, practitioner+phone, licence and reference values elsewhere.

**S-09 [IMPORTANT] Static explanatory text is announced as an error.** `Alert` is always `role="alert"` (`alert.tsx:25`); 22 of 64 `<Alert>` uses in scope are info/warning notes (most always present), e.g. one per ISSUED invoice (`invoices/page.tsx:518-526`, so a page of 25 issued invoices announces 25 alerts). There is no `success` Alert variant, so "all good" is drawn as info (`system/page.tsx:111`) or with hard-coded emerald (`reconciliation-card.tsx:54`, the only hard-coded colour in scope). Inline status changes (counts, "Page N · loading", self-refreshing system and performance pages) have no `aria-live`; only Sonner toasts announce. Toasts auto-dismiss at the library default (`sonner.tsx:12-27`, no duration/close button) including errors, so a failed release or a 403 explanation can vanish in about 4 seconds. Skeletons are `aria-hidden` and lists never set `aria-busy`, so loading is silent to assistive tech.

**S-10 [IMPORTANT] Date and "today in Lagos" are computed four ways, one of them wrong for money.** `lagosDate()` (`payouts/page.tsx:203`), `Date.now()+3600_000` hack (`invoices/page.tsx:142`, `rate-floors/page.tsx:76`), UTC month bounds (`invoices/page.tsx:74-79`), literal `+01:00` (`audit/page.tsx:59-65`), device-time `Math.ceil` countdown (`data-requests/page.tsx:49-51`). Invoice periods are sent as `T00:00:00.000Z` (`invoices/page.tsx:151-152`), i.e. 01:00 WAT, which is the bug the audit page's own docstring describes ("cut the day at 01:00 WAT", `audit/page.tsx:49-58`): shifts between 00:00 and 01:00 WAT on a period boundary can land in the wrong invoice. `monthLabel` is copied (`page.tsx:120`, `finance/page.tsx:74`) and renders "Oct 26" (ambiguous with the 26th). `formatAgo` is a snapshot at render: a queue left open shows frozen ages because a focus refetch that returns identical data does not re-render.

**S-11 [IMPORTANT] Shared components exist and are bypassed.** Hand-rolled avatars (`credentials/page.tsx:287-298`, `practitioners/page.tsx:134-153`) although `components/app/avatar.tsx:25-37` documents that it exists because "it used to be three"; the hand-rolled `<img alt="">` has no `onError` fallback, so an expired signed URL shows a broken image. Hand-rolled pills instead of `Badge` (`practitioners:909-935`, `facilities:245-254`, `facility-detail:169-175`, `data-requests:253-268`, `request-detail:222`, `dispute-detail:188-190`) with three different paddings. `monthLabel`, "today", the review-actions block (S-12) and `AuditEntry` (declared six times) are copy-pasted. Query keys: 99 literal `queryKey:` occurrences in admin vs 1 use of `keys.*` (`audit/page.tsx:101`), despite `query-keys.ts:1-14`; one dead key (`incident-detail.tsx:115` invalidates `['dashboard-incidents']`, which nothing reads). Sidebar prefetch for Practitioners (`console-layout.tsx:49`) omits `&application=waiting`, so the hover request never matches the page's first call (`practitioners/page.tsx:314-316`) and is wasted.

**S-12 [IMPORTANT] Credentials review exists twice and disagrees.** `credentials/page.tsx:349-430` and `credentials-tab.tsx:159-234` duplicate the reason field, expiry date, three buttons and mutation (~100 lines each), plus a third variant in `evidence-review.tsx:214-262`. They disagree on which rows are actionable: the queue treats `MORE_INFO_REQUESTED` as open (`credentials/page.tsx:279`); the per-practitioner tab tests `'INFO_REQUESTED'` (`credentials-tab.tsx:109`), a value that does not exist (Prisma enum has only `MORE_INFO_REQUESTED`, `schema.prisma:666`; the queue's own comment at `credentials/page.tsx:65-67` records that this exact typo was fixed there). So a submission awaiting more information can be Verified or Rejected from the queue but shows no controls on the practitioner's tab.

**S-13 [POLISH] Misc.** Radix `Tabs` used as filters with no `TabsContent` (credentials, facilities, disputes, unhonoured, data-requests, suggestions, practitioners queue): `aria-controls` points at a panel never rendered, tabs carry no counts. Row buttons contain `<div>`/`<p>` (invalid inside `<button>`). `Table` wrapper scrolls (`table.tsx:9`) but is not focusable and no table in scope has a caption or `scope`. Client files import server-module domain files (`request-detail.tsx:28`, `reconciliation-card.tsx:10`, `audit/page.tsx:32`). Radio-like choices are built five ways (section A row 12).

**What is good (keep):** skip link, `lang="en-NG"`, persistent labels on all inputs but one, icon-only buttons all have names, every list row is a real `<button>`, reduced-motion honoured, text-size control, `QueueSkeleton`/`EmptyState`, distinct empty vs filtered-empty copy, Sonner success toasts, WAT formatting centralised in `format.ts` (used everywhere except S-10), no per-row API calls (the only per-row `useQuery`, `evidence-review.tsx:139`, is click-gated), no polling beyond system (30 s), performance (15 s), bell (60 s, `notification-bell.tsx:51`), data-request deadline countdown, erase dialog, empty-sanctions-list warning (`sanctions/page.tsx:216-225`), second-approver rule explained (`payouts/page.tsx:561-565`), `useStepUp` hook.

---

## 1. State matrix (every screen incl. detail panels/dialogs)

Columns: Load | 1st-use empty | Filtered empty | Success confirmation | Validation | Network fail (distinct from empty) | 403 | 5xx | Completed/archived record | Destructive confirm + step-up.

| Screen | Load | Empty | Filt. | OK | Valid. | Net | 403 | 5xx | Done | Destr. |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard | Y | Y (199-201,330,389) | - | - | - | P (253,328,387; no retry, `retry:false` 146) | N | N | - | - |
| Credentials | Y | Y | Y | Y toast | P (416,423) | P (252-256) | N | N | Y (tabs, `open` 279) | N (421-427) |
| Practitioners (+tab, evidence, standing) | Y | Y | Y | Y | P (666,747) | P; N at evidence-review:58 | N | N | P (no approved view; "Everyone") | N (663-670; standing-panel 163-167, 250-254) |
| Facilities / detail | Y | Y | Y | Y | P (339-347) | P (196-200) | N | N | Y | N (353-359) |
| New facility dialog | - | - | - | Y (109) | P (119-126) | P toast (116) | N | N | - | - |
| Incidents / detail | Y | P (copy wrong for non-OPEN, 245-250) | Y | Y | P (283-285) | P | N | N | Y | N (300-307) |
| Disputes / detail | Y | P (169) | Y | Y | Y (290-294) | P | N | N | Y | N (306-312) |
| Unhonoured / detail | Y | Y | Y | Y | P (244) | P | N | N | Y | N (243-249) |
| Data requests / detail | Y | Y | Y | Y | P (361,370) | P | N | N | Y | Y erase (148-199); N refuse; Cancel keeps "ERASE" (186) |
| Finance (+reconciliation) | Y | P (267-270) | Y (308-311) | - | - | **N (S-01)** | N | N | - | - |
| Invoices | Y | Y | - | Y | P (315-317) | P (413-417); N facility list (94-100) | N | N | Y (511-516) | P: void/pay dialogs + reactive step-up; Issue N (490-497) |
| Payouts | Y | Y | Y | Y | P (398,447) | P (290-294,504-508); **N accounts list (254)** | N | N | Y | P: release single click (549-556); cancel/fail dialogs Y |
| Audit | Y | Y | Y | - | - | P (235-239) | N | N | - | - |
| System | Y | - | - | Y | - | P (103-107 wipes data on a failed poll) | P (Replay hidden 228) | P (`status` unused 53) | - | N (229-236) |
| Performance | Y | Y | - | - | - | P (71-75, same wipe) | N | N | - | - |
| Staff | Y | Y | - | Y | P (643,685,723) | P | P (step-up lock card only, 285-306) | N | Y (576-591) | P: dialogs + reason + reactive step-up |
| Suggestions / detail | Y | P (179) | P | Y | Y (243-247) | P; N summary (99) | N | N | Y | N (259-267) |
| Sanctions | Y | Y (216-225) | P (344-346) | Y | P (164,295-301) | P (338-342) | N | N | N (removed rows vanish) | P (remove dialog; no step-up) |
| Levels | Y | Y | - | **N for retire/restore (77,94)** | P (199) | P | N | N | Y (153) | N |
| Rate floors | Y | Y | - | Y | P (237-239) | P | N | N | P | N (230-236) |
| Holidays | Y | Y | - | Y | P (82) | P | N | N | N | N (149-157) |
| Agreements | Y | Y (161-163) | - | Y | P (257-259) | P | N | N | P (retired text unreadable 165-179) | N (268-270) |

---

## 2. Screens

Each block: files and lines; audience and task; data; then findings (priority first) with the mobile/tablet, accessibility, consistency and queue notes that are specific to that screen. Cross-cutting items are cited as S-xx instead of repeated. "Mobile" assumes the console is used on desktop; the shell collapses to a drawer below `lg` (`console-shell.tsx:271-306`).

### 2.1 Dashboard `/admin`
Files: `page.tsx` 422, `growth-chart.tsx` 110, `layout.tsx` 16, `console-layout.tsx` 175, shell. Audience: everyone on landing; task: decide what to work first.
Data: one query, `GET /api/v1/dashboard/platform` (`page.tsx:143-147`, key `['tile','platform-summary']`, `retry:false`, no polling, no per-row calls); chart chunk lazy (132-135); shell polls notifications every 60 s.
- [IMPORTANT] `STALE_AFTER_DAYS = 5` (113) is one threshold for every queue; a SEVERE incident, where hours matter, is "fine" at 4 days, and a suggestion is "stale" at 6. The stale signal is border + weight + colour (237, 267-270) with no text that says "over 5 days", so 4 days and 6 days read identically except for tint.
- [IMPORTANT] Tiles show a count and an age but link only to the queue, not the oldest item; for credentials and facilities the destination is newest-first (Q-1), so the oldest cannot be found from the number the tile just advertised.
- [IMPORTANT] No tile for data requests (legal deadline, `audit.read`), payouts awaiting release, invoices awaiting issue, failed notifications, or failed reconciliation (section C).
- [IMPORTANT] `total` (159) adds credentials + facilities + incidents + disputes + unhonoured + suggestions into "N things are waiting on you"; the oldest is computed across the same mix (166-170). A suggestion nobody needs answered this week sets the headline.
- [IMPORTANT] Any failure turns six tiles and two cards into three "Could not load" lines with no retry (253, 328, 387); `retry:false` means a blip sticks until focus.
- [POLISH] `Good day, {name}` is the h1 (188), so h1 and tab title never name the page. Copy says "A flat or falling line" (295) but the chart is bars (`growth-chart.tsx:58`). Chart gets three bar series on two axes with `usage` in muted grey (`growth-chart.tsx:28-32,64-80`); no data-table alternative (Finance has one). `monthLabel` duplicate (S-10). Local `Summary` interface (44-50) is hand-copied from the server type. `formatAgo(new Date(x).toISOString())` round trips (216, 271). Card title `text-base` (290) vs `text-sm` (322, 378). `Link` tile wraps a Card with no ring class (233) but now gets the global fallback.

### 2.2 Credentials `/admin/credentials`
Files: `credentials/page.tsx` 476, `document-dialog.tsx` 119, `lib/ui/reference.ts`, `lib/ui/queue.ts`. Audience: compliance reviewers; task: Verify / Ask for more / Reject pending submissions.
Data: `GET /api/v1/credentials?scopeType=PLATFORM&status=…&limit=20[&credentialTypeId][&search][&cursor]` (109-125); `GET /api/v1/reference` for one dropdown (92, includes all states and LGAs); mutation `POST …/review` (135-154); `POST …/document-url` only on click (`document-dialog.tsx:53-66`). No per-row queries, no polling.
- [IMPORTANT] Pending queue is newest-first (`submission.ts:296` `createdAt desc`); row shows "date · N ago" (319) with no emphasis; there is no sort control. The oldest waiting submission is on the last page.
- [IMPORTANT] S-03 for Reject/Ask for more (414-427); S-12 for the duplicate of `credentials-tab.tsx` and the `MORE_INFO_REQUESTED` disagreement (279).
- [IMPORTANT] S-08: expiry estimate caveat is truncated (317).
- [IMPORTANT] `useQueueAction` invalidates only the current status prefix (108, 135-140): the Verified tab and the practitioner's own detail (`['practitioner-credentials']`, `['eligibility-of']`) can show the pre-decision state for up to 60 s.
- [POLISH] Credential Select label unbound (201, S-05); Search spinner and disabled state on every background fetch (223); `N on this page` is all the count there is (245); hand-rolled avatar (287-298, S-11); literal key (108) beside unused `keys.credentials.page`; `placeholderData` keeps old-status rows with live action buttons visible while a tab switch loads (124) with no dimming.
- Mobile: filter wraps cleanly; cards stack; no issue. A11y: labels persistent (191, 353, 374); focus is lost when a decided card disappears.

### 2.3 Practitioners `/admin/practitioners` (list + inline detail with Record and Credentials tabs)
Files: `page.tsx` 987, `credentials-tab.tsx` 241, `evidence-review.tsx` 534, `standing-panel.tsx` 267, `submissions.ts` 54. Audience: onboarding officers, compliance; task: approve applications, record NIN and registration, verify credentials, clear screening flags, reinstate.
Data: list `GET /api/v1/practitioners?scopeType=PLATFORM&limit=20[&application=waiting|draft][&search][&cursor]` (309-322); `…&userId=` only for `?user=` (271-279); on selection: `…/verification` (331-339), `…/eligibility` (341-349), `…/screening` (`standing-panel.tsx:79-83`), `/users/{id}/suspensions` (`:188-195`), `GET /credentials?…&scopeId=` shared key (`submissions.ts:44-53`, mounted by both tabs from one cache), `GET /reference`. Evidence: `POST …/document-url` run through `useQuery` inside a per-submission component (`evidence-review.tsx:139-150`), gated by a click.
- [IMPORTANT] That `useQuery` is a POST that writes a "document accessed" security event (see `document-dialog.tsx:31-34`); `staleTime` is 4 minutes and `refetchOnWindowFocus` is on by default, so every refocus after 4 minutes re-fetches the identity document and writes another access record nobody chose.
- [IMPORTANT] S-12 (`credentials-tab.tsx:109`), S-01 family (`evidence-review.tsx:58`), S-03 for Clear flag / Reinstate, and for the irreversible identity record: "nobody can read it back afterwards" (copy 639-643) is followed by a one-click Record identity (663-670); Confirm identity (`evidence-review.tsx:377-384`) likewise.
- [IMPORTANT] `selected` is a snapshot of the list row (268, 414); the header `StatusBadge` (453) and name block never update after identity, registration or approval because `refresh()` invalidates only the directory and detail queries (351-355).
- [IMPORTANT] Age and queue: "waiting" is the one onboarding queue sorted oldest-first (`directory.ts:111-113`), but the age pill "Submitted N ago" and the identity/registration pills are `hidden sm:flex` (907), i.e. missing on a portrait tablet, and are neutral coloured whatever the age (909-911). Draft and Everyone tabs are newest-first.
- [IMPORTANT] S-05 for selects at 647, 709, `evidence-review.tsx:475`.
- [POLISH] Level/category editor state `standing` is shared by every registration row (394, 591-594) and `recordStanding` posts no registration id (397-403). `<details>` hand-rolled disclosure (609-615). Local avatar (134-153). Name-match toggle is two `aria-pressed` buttons about 38px high (`evidence-review.tsx:350-366`), should be a radio group. PDFs open in a new tab (`evidence-review.tsx:190-208`) unlike `DocumentDialog`'s inline iframe, so the "evidence beside the decision" promise (docstring 29-44) fails for PDFs. A 987-line page contains the whole detail screen (414-770) whereas six other queues split `*-detail.tsx`; no `ScreenTransition` here. `h3` appears without an `h2` (`evidence-review.tsx:78`); other cards use `CardTitle` divs. Detail repeats the name in `PageHeader` (418) and the card (441).

### 2.4 Facilities `/admin/facilities`
Files: `page.tsx` 302, `facility-detail.tsx` 429, `new-facility-dialog.tsx` 293, shared `staff-manager.tsx`, `document-dialog.tsx`. Audience: onboarding/compliance; task: verify a hospital's licence; register one on its behalf.
Data: list `GET /api/v1/facilities?scopeType=PLATFORM&status=…&limit=20[&search][&stateId][&cursor]` (66-82); detail `GET /api/v1/facilities/{id}?scopeType=PLATFORM` with `initialData` (79-84, so effectively no fetch for 60 s); `GET /api/v1/audit?scopeType=PLATFORM&entityId=…&limit=25` runs on mount although History is a closed tab (86-95); Staff tab mounts only when opened (comment 366-368, good).
- [IMPORTANT] Queue age is `createdAt` and newest-first (`facility.ts:393`; "onboarded N ago" `page.tsx:239`). The facility table has no submitted/resubmitted timestamp (`schema.prisma:722`), yet the page says changing a verified facility's licence "sends it straight back to this queue" (99): a resubmission looks months old and the dashboard `oldest` counts from registration.
- [IMPORTANT] S-03: Verify/Reject single click after a checklist (337-359); Verify disabled on seven conditions with no indication which is missing (339-347, S-06). After a decision the officer remains on a now-Verified record with no next item (121-132), unlike disputes/unhonoured/requests/suggestions which return to the list: post-decision behaviour is inconsistent across queues (Q-4).
- [IMPORTANT] New facility dialog: state not reset after success (108-115); no `<form>` so Enter submits neither the dialog nor the representative lookup (248-267, 286); errors only by toast (116); 12 `useState` fields hand-validated (119-126); lookup Alert not tied to its input (273-278). Redundant `max-h/overflow` (136) duplicates `DialogContent`.
- [POLISH] State Select label unbound (141); pills `px-2.5 py-1` (169-175) vs `px-2 py-0.5` (245-254); checklist built from an array of tuples with casts (293-307) and native checkbox `size-5 accent-primary` (303) vs `size-4` on Levels (`levels:266`); "Licence attached" pill hidden below `sm` (245-247); Timeline copy (403-415; section A row 6).

### 2.5 Clinical incidents `/admin/incidents`
Files: `page.tsx` 315, `incident-detail.tsx` 354. Audience: clinical safety; task: review, take and close incidents, most serious first.
Data: list `GET /api/v1/incidents/queue?status=…&limit=20[&severity][&category][&search][&cursor]` (78-94); detail `GET /api/v1/incidents/{id}` returning `{incident, subject, shift, subjectHistory}` (79-89), audit history on mount (91-100).
- [CRITICAL] The queue's headline promise is false beyond page 1. Page copy and code comment say "Most serious first … A death reported this morning outranks a near miss from March" (`page.tsx:29,112`; dashboard hint `page.tsx:84`). The server pages by `reportedAt desc` and sorts by severity only within each fetched page (`incident.ts:396-433`: `orderBy reportedAt desc` at 418, then `.sort(severityRank)` at 429, with a comment admitting the cursor follows DB order), and within one severity the order is newest-first, not "oldest within that". A severe incident older than the newest 20 sits on page 2+ below minor ones. The dashboard's "Most serious open" card (server query orders by severity then oldest) can name an incident the queue does not show first.
- [IMPORTANT] `subjectHistory` is fetched and typed (`incident-detail.tsx:86`) but never rendered; the comment at 76-78 says it exists so "a reader never has to decide from one report whether this is a pattern". Compliance decides suspension without the pattern the API supplies.
- [IMPORTANT] S-03: Close incident including Suspend / Refer (300-307); outcome preselected `SYSTEM_ISSUE` (73), the opposite of the "no default" principle in `evidence-review.tsx:276-277`.
- [IMPORTANT] Empty state says "Nothing open / Every reported incident has been closed" for any filter that returns nothing, including Closed and Under review (`page.tsx:245-250`).
- [IMPORTANT] `fresh` has no error/pending UI (S-01 family); a severe REPORTED case that must be taken first (`blockedUntilTaken` 107-108) has no "not yet taken" marker on the list.
- [POLISH] Status/Severity/Category Selects unbound (S-05). `row.severity.toLowerCase().replace('_',' ')` (237) instead of `humanise`. Dead key `dashboard-incidents` (115). Age is "reported N ago" in the muted meta line (`page.tsx:264-267`), no emphasis. Row `<button>` contains `div`/`p`.

### 2.6 Disputes `/admin/disputes`
Files: `page.tsx` 260, `dispute-detail.tsx` 445. Audience: ops/support adjudicators; task: decide who was right using both sides' evidence.
Data: list `GET /api/v1/disputes?status=…&limit=20[&search][&cursor]` (61-75); detail `GET …/{id}/evidence` (103-112, feeds the tab count) and audit history on mount (114-123); evidence viewed via `DocumentDialog` mutation per item, click-only (376-389).
- [IMPORTANT] S-03 for Uphold/Dismiss (306-312); the per-option consequence text beside each (303-305) is the best "what happens" copy in the console and could be the confirmation. Resolve returns to the list (151).
- [POLISH] Oldest-first (`dispute.ts:590` `createdAt asc`), good, but age shows only for open rows (207-211) as muted text; OPEN is distinguished by `border-warning/40` only (181-184). Party badges use `warning` for "Facility" and `info` for "Practitioner" (203, 173, 359-361): warning means "waiting" everywhere else. Dismiss is styled destructive and Uphold success (73-85) though neither is destructive. Evidence count pill (188-190) hand-rolled and unnamed. "Start reviewing" shows no reviewer, so two officers can both open the case. Empty state has no description (169).

### 2.7 Unhonoured shifts `/admin/unhonoured`
Files: `page.tsx` 258, `unhonoured-detail.tsx` 436. Audience: ops/compliance; task: decide fault, answer excusal requests.
Data: list `GET /api/v1/unhonoured?status=…&limit=20[&search][&cursor]` (55-69); audit history on mount (81-90); `GET /api/v1/assignments/{id}/excusals` on mount (335-344).
- [IMPORTANT] The fault picker is a `<button>` with a drawn radio dot and no `aria-pressed`/role (197-225): the selected fault is invisible to screen readers (staff-manager's equivalent has `aria-pressed`).
- [IMPORTANT] `ExcusalRequests` keeps one `notes` string for all excusals (333, 407-408): a refusal reason typed against one request can be submitted against another.
- [IMPORTANT] S-03 for the fault decision (58, 243-249) and "Excuse them" (411-418, closes the flag and leaves the screen, 359).
- [POLISH] Oldest-first (`fault.ts:299` `detectedAt asc`), age as muted text "Shift ended … · flagged …" (201-203), no emphasis. "{Fault} at fault" hidden below `sm` (207). Practitioner name repeated in header and card (113, 127). Single static `MIN_REASON` with no counter (S-06).

### 2.8 Data requests `/admin/data-requests`
Files: `page.tsx` 318, `request-detail.tsx` 422. Audience: privacy/compliance; task: answer or refuse data-subject requests inside the legal month.
Data: list `GET /api/v1/data-requests?status=…&limit=20[&kind][&search][&cursor]` (69-84), audit history on mount (86-95), mutations start/close/erase.
- Best age model in the console: deadline-ordered (`data-subject.ts:289` `dueBy asc`), countdown pill, overdue border and "N past the deadline" (190-192, 232, 252-269). Flaws: "1 days left / over" (264,267); threshold 7 days hard-coded (258); `daysLeft` is device-time (49-51, S-10); hand-rolled pill (255); border/pill tint is the only mid-state cue.
- [IMPORTANT] "I am working on it" (316) calls `onBack()` (105): the officer is thrown to the list and the item leaves the Received tab. `dispute-detail.tsx:91-98` documents this exact complaint and fixes it with local status; the two screens now behave differently.
- [IMPORTANT] Erase: successful but incomplete erasure tells the officer "Press Erase again to finish" (127-128) and then `onBack()` (135) leaves the screen that holds the Erase button, and the request may now be closed (353). S-04: Cancel leaves the typed confirmation (186).
- [IMPORTANT] S-03 for Refuse (368-375): the docstring says refusal is "the one somebody appeals".
- [POLISH] Right Select unbound (144). "Answered" (365) names a state not an action. `ERASURE_RETAINED` imported from `modules/…/domain` into a client file (28).

### 2.9 Finance overview `/admin/finance`
Files: `page.tsx` 385, `reconciliation-card.tsx` 92, `money-charts.tsx` 108 (shared). Audience: finance; task: see what is owed and whether the ledger adds up.
Data: `GET /api/v1/dashboard/finance` (82-86), `GET /api/v1/finance/invoices?limit=20[&status][&search][&cursor]` (137-152), `GET /api/v1/finance/reconciliation` computed at every page open from the whole ledger (`reconciliation-card.tsx:31-35`, no refresh control, `ranAt` fetched and never shown 12-15). Debounced search (127-134).
- [CRITICAL] S-01 (finance tiles and charts present failure as zero and as "Every issued invoice has been paid").
- [IMPORTANT] Spend chart has its legend turned off (`page.tsx:224` `legend={false}`): two series in two hues are identified only by tooltip. The table captioned "The same figures as the charts above, readable without colour" (251-253) lists individual invoices, not monthly totals or facility balances, so the claim is inaccurate and neither chart has a text equivalent.
- [IMPORTANT] Chart axes and tooltips use a private `naira()` that rounds to whole naira via `toLocaleString` (`money-charts.tsx:24,60,99`) instead of `formatNaira`; the tooltip for ₦12,345.67 reads ₦12,346.
- [IMPORTANT] Invoice rows are dead ends (326-336): no link to `/admin/invoices`, no period, due date or age, status as raw `DRAFT` text (329, `humanise`/`StatusBadge` exist), no overdue concept anywhere on the page.
- [POLISH] The filter bar renders only after load and is removed when the card shows its error (256-260, 273-306), so a failed search cannot be cleared; pager buttons ignore `isFetching` (349,359) unlike other pages; CardTitle `text-sm font-medium` vs `text-base` (192, 213, 231, 250); hand-rolled tiles (187-205) although `AmountFigure` exists; "platform fees read zero" said twice (175, 378-382); `monthLabel` copy (74). Reconciliation: hard-coded `text-emerald-700 dark:text-emerald-400` (`:54`), findings show `id.slice(0,8)` with no link (22), failure muted (49-51), no success Alert variant.
- Mobile: 5-column table scrolls horizontally with no stacked fallback (314-339).

### 2.10 Invoices `/admin/invoices`
Files: `page.tsx` 545. Audience: finance; task: raise draft, issue, record payment, per facility.
Data: `GET /api/v1/facilities?scopeType=PLATFORM&status=VERIFIED` unpaginated, on mount (94-100); `GET /api/v1/invoices?facilityId=&limit=25&cursor` via `useInfiniteQuery`, enabled only after a facility is chosen (102-111); mutations generate/issue/void/pay with `useStepUp` (119).
- [IMPORTANT] No cross-facility work queue: the page opens on "Choose a facility" (405-410). Finance must iterate hospitals to find drafts to issue or issued invoices to chase; the platform-wide list exists only read-only on Finance (`finance/page.tsx:137-152`).
- [IMPORTANT] Issue it (490-497) sends a facility a bill with one click and no summary of facility, period and amount, while void (222-266) and pay (267-344) have dialogs. S-03.
- [IMPORTANT] S-10: periods sent as 01:00 WAT (151-152), "today" via +1 h hack (142), UTC month bounds (74-79).
- [IMPORTANT] `overtimeMinutes` and `onCallMinutes` are in the payload (50-51) and priced into Base/Premium but the table has Ordinary/Night/Holiday columns only (442-448), so a line's total cannot be reconciled on screen.
- [IMPORTANT] S-09: an info Alert per ISSUED invoice (518-526).
- [POLISH] Any raise failure is toasted as "Nothing to bill" (160). Amount error and the "that is not the invoice amount" warning are not tied to the field and the Record button stays enabled (315-327, 335). Third pager style ("Show older invoices", 530-539). Two inline dialogs (222-344; section A row 8). Combobox is the correct bound-label pattern (362-371).
- Mobile: 7-column line table scrolls (439-474), no stacked fallback.

### 2.11 Payouts `/admin/payouts`
Files: `page.tsx` 600, `payout-account-panel.tsx` 272, `amount-figure.tsx` 53. Audience: finance; task: verify bank accounts, prepare, release (second approver), record the bank transfer.
Data: `GET /api/v1/practitioners?limit=8&search=` (79-86); `GET /api/v1/payouts?scopeType=PLATFORM&scopeId={practitioner}` (88-104); `GET /api/v1/payout-accounts` on mount (108-122); reveal `GET …/payout-accounts/practitioner/{id}` as a mutation (panel 96-106); `useStepUp` (128).
- [IMPORTANT] No payout queue. The API is per practitioner (`payouts/route.ts` GET), so "prepared, waiting for a second approver" and "released, waiting for the bank record" can only be found by searching names. The second-approver rule (550-565) creates work for a colleague who has no list to find it in.
- [IMPORTANT] The accounts-waiting queue fails silently (254, S-01), is unbounded, shows only a created date (270), no age emphasis.
- [IMPORTANT] S-03: Prepare (485-498) and Release (549-556) are single clicks (labelled with the amount, which helps); step-up copy is generic (128) and replays automatically.
- [IMPORTANT] After a reveal the full account number stays on screen until some mutation clears it (panel 90-94, 228): no re-mask or timeout for a value described as the most sensitive thing in the product.
- [POLISH] Back pattern differs (ghost button above the header, 323-326) and a practitioner chosen from the waiting list has `phone: ''` so the header description is blank (264, 328). Hand-rolled dialogs with Back not clearing reason (363-455, S-04). Rows at 261-276 and 304-312 are a fourth row style (`rounded-lg p-3`). Good: `AmountFigure` with error (331-352), `lagosDate` (203).

### 2.12 Audit trail `/admin/audit`
Files: `page.tsx` 360. Audience: compliance, investigators; task: what happened to a record.
Data: `GET /api/v1/audit?scopeType=PLATFORM&limit=50[&area][&entityId][&from][&to][&cursor]` (100-120), `staleTime` 5 min (118), `placeholderData` previous (119).
- [IMPORTANT] Filters apply on change with no submit and no busy indicator; the old rows stay on screen as placeholder and the only `isFetching` cue is inside the pager, which renders only when paging exists (322-337). A date or area change can look applied while showing the previous result.
- [IMPORTANT] Five-minute staleness on the page used to see what just happened, no refresh button (`performance/page.tsx:62-66` has one); a focus refetch respects staleTime so new rows do not appear.
- [POLISH] Area Select unbound (145). Record drill-down is a bare mono button with no padding (277-287) and its hint is a `title`; the exact action code is available only through `title` (268), unreachable by keyboard. Id cannot be pasted as a filter, only clicked. "Nothing recorded at platform scope yet" (243) is jargon. Pager says Newer/Older (331,353) unlike Previous/Next. 5-column table in a Card, no caption.

### 2.13 System health `/admin/system`
Files: `page.tsx` 296. Audience: ops/engineering on call; task: know whether background work is healthy; replay dead events.
Data: `GET /api/v1/admin/system` polled every 30 s (77-82); mutation replay.
- [IMPORTANT] A failed poll replaces the whole page with an error Alert (103-107) even though the last good data is still in the query; a blip at poll time hides the health you came to read. No "last updated" time.
- [IMPORTANT] Replay is one click though the copy says it re-runs the event "including any text it sends" (193-194, 229-236). S-03.
- [POLISH] Response `status: 'ok'|'degraded'` (53) is never used; healthy state is an info Alert (111-117, S-09); a self-refreshing page with no live region; three hand-rolled stat tiles (139-144, 179-183); 5-column and 4-column tables, no stacked fallback; `CardDescription className="text-xs"` (151,192,250) repeated. This page already holds failed-notification and job data the dashboard never summarises (section C).

### 2.14 Performance `/admin/performance`
Files: `page.tsx` 135. Audience: engineering; task: find slow routes.
- [POLISH] A developer metrics page inside the operations console. Slow rows are "marked" (85-88) by colour alone (`text-warning` on p95 and queries, 112, 120; `slow || ''` shows blank, 125). Polls every 15 s with a manual Refresh (54, 63) and a failed poll replaces the table with an error (71-75). 9-column table inside `overflow-x-auto` (84), no caption or sorting.

### 2.15 Staff `/admin/staff` (shared `staff-manager.tsx` 823)
Files: `staff/page.tsx` 40. Audience: administrators; task: appoint, change, remove platform staff.
Data: `GET /api/v1/grants?scopeType=PLATFORM` (`staff-manager.tsx:113-117`), invitations only for facilities. Its own step-up wiring (`guarded()` + `StepUpDialog`, 96-111, 273-283) is the second step-up pattern next to `useStepUp`; a lock card handles the "password needed" state (285-306, good).
- [IMPORTANT] S-04: revoke reason not reset on open (555, 718-720).
- [POLISH] Role choice is three copies of a card made of `<button aria-pressed>` (345-372, 442-470, 611-625) instead of a radio group; "Remove all access now" uses `text-destructive`, not the `destructive-text` token the stylesheet says exists for text (561); Cancel on an invitation spins on every row (797); minimum reason length 5 is silent (643,685,723); `h2` headings here (493, 516) are the only ones outside `PageHeader`; reasons are required but no typed confirmation for removing all access.

### 2.16 Suggestions `/admin/suggestions`
Files: `page.tsx` 259, `suggestion-detail.tsx` 324. Audience: product/ops; task: triage and answer pilot feedback.
Data: `GET /api/v1/suggestions?status=NEW&limit=20[&area][&cursor]` (52-63); `GET /api/v1/suggestions/summary` (77-80) with no loading or error UI (99); audit history on mount.
- [IMPORTANT] S-03 light: Decline is one click (259-267) although the answer is read by the person who raised it.
- [POLISH] Area "bars" are buttons whose selected state is background tint only, no `aria-pressed` (117-146); the count cell `w-16` cannot hold "12 · 3 open" (142). Newest-first (`suggestion.ts:245`), so untriaged oldest are last. No search, unlike other queues. "Declined invitation" uses `warning` (209-211). Triaged/Planned explain themselves only via `title` (215). Empty state is a title only (179).

### 2.17 Sanctions list `/admin/sanctions`
Files: `page.tsx` 392. Audience: compliance; task: maintain the list practitioners are screened against.
Data: `GET /api/v1/sanctions[?search]` (109-113), unpaginated; add and remove mutations.
- [IMPORTANT] Adding up to 500 entries (all or none) flags and blocks practitioners immediately; there is no preview of matches and the flagged count appears only in the toast afterwards (130-134). Removal (168-208) asks for a reason of 5 characters (200) without showing who it will clear.
- [POLISH] Parse errors appear while the first line is still being typed and are not tied to the field (295-301). "Which list" label unbound (237). The list search is the only input with no visible label (324-329). No pagination or total; removed entries disappear. Good: empty-list warning (216-225), `aria-label="Remove {name}"` (376).

### 2.18 Levels `/admin/levels`
Files: `page.tsx` 282.
- [IMPORTANT] Retire / Bring back (154-161, 231-238) is one click that changes who can be offered shifts; success shows nothing (`onSuccess: refresh`, 77 and 94) so the page gives no confirmation that anything happened.
- [POLISH] Native checkbox `size-4` (266) vs `size-5 accent-primary` elsewhere; rank rule is silent (199); the same hand-rolled list-row appears twice here (147-163, 222-240) and again in `staff-manager.tsx:533-570`.

### 2.19 Pay floors `/admin/rate-floors`
Files: `page.tsx` 279.
- [IMPORTANT] Setting a floor is append-only and governs all shift publishing (docstring 54-63) but is one click with no summary of what will be set (230-236); a typo can only be superseded.
- [IMPORTANT] Four Selects with unbound labels (145, 167, 184, 201, S-05). Specialty column prints the raw key while level resolves to a name (263 vs 264). "Today" via +1 h hack (76, S-10). Amount error not tied to field (237-239).

### 2.20 Public holidays `/admin/holidays`
Files: `page.tsx` 215.
- [IMPORTANT] Remove (149-157) changes the holiday premium on pay for shifts on that date, one click, no reason or confirmation.
- [POLISH] Gaps are announced at the top with "Add them below" (120) while the form is at the bottom of the page (171-211). Date and name rules silent (82).

### 2.21 Terms and notices `/admin/agreements`
Files: `page.tsx` 276.
- [IMPORTANT] Publish (268-270) retires the current text and forces everyone it binds to re-accept; a warning Alert sits above the button (262-267) but there is no preview or confirmation.
- [IMPORTANT] Retired versions show metadata only (165-179) although the page promises "so what somebody agreed to stays readable years later" (109) and `Version.body` is in the data (30): only the current text can be read (147-158).
- [POLISH] Kind Select unbound (197). Nav says "Terms and notices" for the route `/agreements`; two nav entries are called "Overview" (`console-layout.tsx:38,101`); "The pilot" groups legal data requests and the audit trail with suggestions (107).

---

## 3. Queue UX

**Q-1 Age and ordering, per queue (what the list shows, how it is ordered, source)**

| Queue | Age on row | Emphasis beyond colour? | Server order | Oldest first? |
|---|---|---|---|---|
| Credentials (pending) | date + "N ago" in Detail (319) | none | `createdAt desc` (`submission.ts:296`) | **No** |
| Facilities (pending) | "onboarded N ago" in the meta line (239) | none; age is creation, not submission | `createdAt desc` (`facility.ts:393`) | **No** |
| Practitioners (waiting) | "Submitted N ago" pill, hidden <sm (909) | none | `submittedForReviewAt asc` (`directory.ts:111-113`) | Yes |
| Incidents | "reported N ago" in meta (266) | severity badge text | `reportedAt desc` (`incident.ts:418`), then severity sort within each page (`incident.ts:429`) | **No; severity claim false across pages** |
| Disputes | "N ago", open rows only (207-211) | OPEN border tint (colour only) | `createdAt asc` (`dispute.ts:590`) | Yes |
| Unhonoured | "ended … · flagged …" (201-203) | none | `detectedAt asc` (`fault.ts:299-301`) | Yes |
| Data requests | countdown pill + overdue border + overdue count (190-192, 252-269) | **Yes, text countdown** | `dueBy asc` (`data-subject.ts:289`) | Yes (by deadline) |
| Suggestions | "N ago" (202) | none | `createdAt desc` (`suggestion.ts:245`) | No |
| Payout accounts waiting | created date (270) | none | server order, unbounded | unknown |

Seven of nine queues show age only as relative text in muted meta; only data requests gives an age signal that is more than colour; none shows "oldest in this queue" on the queue page itself (only the dashboard does), none offers a sort control, none shows tab counts or a total (all say "N on this page"). Ages are frozen at render (S-10).

**Q-2 Filter patterns (7 implementations).** (A) Tabs for status + search form card (`Search` + `Clear` + "N on this page"): credentials, facilities, practitioners, disputes, unhonoured, data-requests (six near-identical copies, with an extra Select in three). (B) Status as a Select plus three more Selects, no tabs: incidents. (C) Tabs + clickable area bars, no search: suggestions. (D) Instant filters with no submit or busy cue: audit. (E) Debounced search inside the results card, rendered only after load: finance. (F) Search inside the card header, no pager: sanctions. (G) "Find a person / choose a facility" gate before any list: payouts, invoices. Pager: ten copies of cursor state + Previous/Page N/Next (`credentials:99-106,438-473`, `practitioners:305-327,947-984`, `facilities:57-64,264-299`, `incidents:69-76,277-312`, `disputes:51-58,222-257`, `unhonoured:46-53,220-255`, `data-requests:60-67,280-315`, `suggestions:47-70,221-256`, `audit:91-98,322-357` "Newer/Older", `finance:122-123,341-369`) plus a third style ("Show older", invoices).

**Q-3 List and detail patterns.** List: (1) row-as-`<button>` card, seven copies (practitioners:886-941, facilities:223-258, incidents:256-271, disputes:178-215, unhonoured:185-214, data-requests:227-273, suggestions:185-215); (2) expanded review cards with decisions inside the list (credentials:282-433, credentials-tab:112-236); (3) small bordered rows (payouts:261-276, 304-312); (4) tables (audit, finance, system, performance, sanctions, rate floors, holidays, invoice lines); (5) divided lists (levels); (6) card per grant (staff-manager). Detail: (1) full-page swap via `selected` state with back button, summary card and two tabs, six copies (facilities, incidents, disputes, unhonoured, data-requests, suggestions); (2) practitioners' variant of the same inline in a 987-line page with different tabs; (3) decisions in the list (credentials); (4) dialogs (void, pay, record transfer, withdraw, remove, erase, new facility, account review, staff role changes); (5) payouts' person page with a different back control. Evidence is viewed two ways (modal `DocumentDialog` vs inline `Evidence`). No `Sheet`/side panel is used anywhere in admin, and none of these keeps the list visible beside the detail.

**Q-4 Other queue gaps.** No ownership: incidents have "Take this case", disputes "Start reviewing", requests "I am working on it", but no screen shows who holds a case, and all staff share one role, so two people can work one row. Post-decision flow differs per queue: facilities, incidents (stays), credentials (row vanishes), disputes/unhonoured/requests/suggestions (back to list, no "next"). No bulk action, no keyboard shortcuts, no "N waiting" in the sidebar, no system-health dot in the shell. `placeholderData: previous` on every list keeps old rows (with live buttons on credentials) visible during a filter change with only the Search button spinner as a cue (not present on audit).

---

## A. Patterns repeated in 3+ places (candidate shared components)

| # | Candidate | Occurrences (file:line) |
|---|---|---|
| 1 | `useCursorPager` + `Pager` | credentials:99-106,438-473; practitioners:305-327,947-984; facilities:57-64,264-299; incidents:69-76,277-312; disputes:51-58,222-257; unhonoured:46-53,220-255; data-requests:60-67,280-315; suggestions:47-70,221-256; audit:91-98,322-357; finance:122-123,341-369 |
| 2 | `FilterBar` (search + Search + Clear + count + optional Selects) | credentials:182-246; practitioners:804-845; facilities:122-186; disputes:114-154; unhonoured:108-148; data-requests:125-194; incidents:117-227 |
| 3 | `QueueRow` (row button card) | practitioners:886-941; facilities:223-258; incidents:256-271; disputes:178-215; unhonoured:185-214; data-requests:227-273; suggestions:185-215 (+ payouts:261-276,304-312) |
| 4 | `QueueState` (skeleton / error with retry / empty / filtered-empty) | the same 8 pages; generic error string at credentials:255, facilities:199, incidents:240, disputes:163, unhonoured:161, data-requests:207, suggestions:174, practitioners:858 |
| 5 | `DetailShell` (back button, summary card, Tabs) | facility-detail:146-187; incident-detail:140-164; dispute-detail:158-194; unhonoured-detail:112-140; request-detail:200-235; suggestion-detail:121-149; practitioners/page:417-465 |
| 6 | `Timeline` + `useRecordHistory(entityId)` | facility-detail:403-415; incident-detail:333-345; dispute-detail:424-436; unhonoured-detail:274-286; request-detail:401-413; suggestion-detail:295-307 (also six `AuditEntry` interfaces and six identical `GET /api/v1/audit?…&entityId=…&limit=25` queries, all fired on mount) |
| 7 | `DecisionCard` (reason textarea, min length hint, action buttons) | credentials:349-430; credentials-tab:159-234; evidence-review:214-262; incident-detail:227-311; dispute-detail:253-320; unhonoured-detail:189-252, 397-429; request-detail:294-379; suggestion-detail:203-273; facility-detail:283-363; standing-panel:146-169, 236-256 |
| 8 | `ConfirmDialog` with reason (and step-up) | invoices:222-266, 267-344; payouts:363-407, 409-455; sanctions:168-208; request-detail:148-199; payout-account-panel:136-196; staff-manager:596-734 (x3); new-facility-dialog:129-291 |
| 9 | `MetricTile` | page:233-282; finance:187-205; system:139-144, 179-183; amount-figure:35-52 |
| 10 | `Pill`/`Chip` (use `Badge`) | practitioners:909-935; facilities:245-254; facility-detail:169-175; data-requests:253-268; request-detail:222-224; dispute-detail:188-190 |
| 11 | `QuoteBlock` (muted box + label) | credentials:341-346; credentials-tab:151-156; incident-detail:216-221; dispute-detail:209-214, 233-238; unhonoured-detail:176-181; request-detail:253-258, 283-288; suggestion-detail:157-159, 193-198 |
| 12 | `RadioCardGroup` | unhonoured-detail:197-225 (no ARIA); staff-manager:345-372, 442-470, 611-625; evidence-review:350-366 |
| 13 | `SelectField` (bound label) | 18 unbound sites in S-05; correct at new-facility-dialog:153-155 |
| 14 | `Avatar` (already exists) | bypassed at credentials:287-298; practitioners:134-153 |
| 15 | `CredentialReview` | credentials:349-430 vs credentials-tab:159-234 vs evidence-review:214-262 |
| 16 | `Disclosure` | practitioners:609-615; agreements:166-178; staff-manager:577-590, 807-819 |
| 17 | `lagosToday()` / month bounds | invoices:142,74-79; rate-floors:76; payouts:203 (correct); audit:59-65 |
| 18 | `ListRow` (title, muted line, trailing action) | levels:147-163, 222-240; staff-manager:533-570; payouts:261-276 |

## B. Top 10 findings

1. **[CRITICAL] Finance shows ₦0.00 and "Every issued invoice has been paid" when its data failed to load** (`finance/page.tsx:89-94,196-200,219-221,237-240`; S-01).
2. **[CRITICAL] The incident queue's "most serious first" is only true within a page of 20**; the server orders by newest and sorts per page, so an older death or severe case can sit on page 2+ (`incident.ts:418,429`; claims at `incidents/page.tsx:29,112`, `page.tsx:84`). `subjectHistory` is fetched and never shown (`incident-detail.tsx:86`).
3. **[CRITICAL] Decisions that return people to clinical work, suspend them, change pay or re-consent everyone are one click** (reinstate, clear flag, suspend via incident close, publish agreement, remove holiday, set floor, uphold dispute, replay events; S-03). Where a dialog exists, stale text survives Cancel, including a pre-armed "ERASE" (S-04).
4. **[IMPORTANT] Credentials and facilities queues are newest-first and facility age is creation date**, so the oldest waiting item advertised on the dashboard is on the last page and a resubmitted facility looks months old (`submission.ts:296`, `facility.ts:393`, `schema.prisma:722`; Q-1). Only data requests shows a text deadline.
5. **[IMPORTANT] Credentials review is implemented twice and disagrees on what is actionable**; the practitioner tab tests a status that does not exist (`credentials-tab.tsx:109` vs `credentials/page.tsx:279`, S-12).
6. **[IMPORTANT] Finance has no work queues**: invoices require choosing a facility, payouts require a name search, prepared-awaiting-release and released-awaiting-bank-record are unreachable as lists, and the one queue that exists (accounts waiting) fails silently (`invoices:405-410`, `payouts:79-104,254`).
7. **[IMPORTANT] Failures read as empty or generic**: one error sentence for 401/403/offline/5xx, no retry, no permission-denied state, a failed poll wipes System and Performance, and half a dozen panels fail silently (S-01, S-02).
8. **[IMPORTANT] No deep links and no focus management**: filter, tab, page and selected case are component state, Back leaves the section, focus falls to `<body>` on list-to-detail, and every tab is titled "Medilink" (S-07).
9. **[IMPORTANT] Form accessibility basics**: 18 unbound Select labels, no field-tied errors anywhere, reason gates enforced by unexplained disabled buttons, 22 info/warning Alerts announced as `role=alert`, toasts that dismiss errors after about 4 s (S-05, S-06, S-09).
10. **[IMPORTANT] Duplication drives the above**: ten pager copies, seven row copies, six history timelines and detail shells, at least ten hand-rolled reason dialogs, five radio-card builds, bypassed `Avatar` and `AmountFigure`, 99 literal query keys; one component each would fix most of items 7-9 once (section A).

Also worth fixing soon: invoice periods sent as 01:00 WAT (`invoices:151-152`, S-10); evidence-document POST re-fetched on focus writing repeated access records (`evidence-review.tsx:139-150`); invoice overtime/on-call minutes hidden (`invoices:442-448`); chart legend off and tooltips rounded to whole naira (`finance:224`, `money-charts.tsx:24`); `Detail` truncating the estimate caveat (S-08); bank account number stays unmasked (`payout-account-panel.tsx:228`); sidebar has no counts or health signal.

## C. `src/app/admin/page.tsx`: sections, data sources, and what the API returns

**Sections in order (all from one request `GET /api/v1/dashboard/platform`, key `['tile','platform-summary']`, `retry:false`, no polling, `page.tsx:143-147`)**
1. `PageHeader` "Good day, {first name}" (188-194): session name; description switches on summary state (190-193).
2. If no queue permission: explanatory Card (196-202): session permissions only.
3. Summary banner "N things are waiting on you · the oldest arrived X ago" (207-221): computed client-side from `queues[*].count` and `.oldest` for tiles the user may see (159, 166-170).
4. Tile grid, six tiles in this order (223-285): Credentials to review, Facilities to verify, Clinical incidents open, Disputes to adjudicate, Shifts awaiting fault, Suggestions untriaged (`TILES` 61-110), each `queues[key] = {count, oldest}`; stale border at 5 days (113, 229, 237).
5. Platform growth bar chart (287-316): `growth[]`, shown if `facility.read`, `practitioner.profile.read` or `audit.read` (150-155).
6. Two cards (318-417): "Open incidents by severity" (`incidentSeverity[]` + `worstIncident`, needs `incident.manage`), "Recently on the record" (`recent[]`, 8 audit actions, needs `audit.read`).

**What the API returns** (`app/api/v1/dashboard/platform/route.ts:24-53` calls `platformSummary(held)` in `modules/audit-compliance/application/platform-summary.ts:95-193`; each section only for callers holding the matching PLATFORM permission; 403 if none):
- `queues`: up to six keys `credentials | facilities | incidents | disputes | unhonoured | suggestions`, each `{count, oldest}`; counts by SQL: credentials = PENDING submissions, facilities = PENDING, incidents = status <> CLOSED, disputes = OPEN or UNDER_REVIEW, unhonoured = AWAITING_DECISION, suggestions = NEW (65-78); `oldest` = `min(created_at | reported_at | detected_at)`.
- `incidentSeverity[]` `{severity, count}`; `worstIncident` `{severity, category, summary, reportedAt}` (severity then oldest first); `growth[]` 24 months `{month, facilities, practitioners, usage}` (Lagos-month bucketing); `recent[]` 8 `{id, action, createdAt}`.

**Exists vs missing**

| Signal | Status | Notes |
|---|---|---|
| Queue age / oldest waiting | **Exists** for the six queues | A timestamp only: no item id or link; facilities age is creation date (no resubmit timestamp); incidents and disputes include rows already being reviewed (UNDER_REVIEW), so "oldest" is not "oldest unattended"; no SLA or target, one 5-day UI threshold. The destination queues for credentials/facilities are newest-first (Q-1). |
| Credentials and facility verifications | **Exists** (counts + oldest) | Missing: practitioner applications waiting (`/practitioners?application=waiting`), credentials in MORE_INFO_REQUESTED, flagged screening, unverified payout accounts (`/payout-accounts`). |
| Incidents and disputes | **Exists** | Incidents also give severity split and worst open. Missing: severe incidents still REPORTED (not taken), disputes split OPEN vs UNDER_REVIEW or by age. |
| Failed notifications | **Missing** from dashboard and from this API | Available elsewhere: `GET /api/v1/admin/system` (outbox pending/failed/dead-letter, texts failed in 24 h, accepted-then-failed, unconfirmed, problems[], jobs) shown only on `/admin/system`. |
| Reconciliation differences | **Missing** | Only `GET /api/v1/finance/reconciliation`, computed on opening Finance; nightly job failure surfaces on System health. |
| Privacy requests | **Missing** | `QueueKey` has no data-requests entry; the queue (`audit.read`) has a legal month deadline and a server `overdue` flag, but no tile. |
| System health | **Missing** | Only `/admin/system`; no indicator in the shell or sidebar. |
| Elevated-confirmation actions | **Missing** | No view of money/role/erasure actions or of whether the signed-in officer's step-up is fresh. `stepUpFresh` exists on `SessionState` (`session.tsx` interface) and `auth.step_up` is an audit label (`format.ts:206`), but nothing surfaces them; step-up appears only reactively after a 401 `step_up_required` (`step-up.tsx:123-147`). |

Also absent although the data exists elsewhere: payouts prepared/released awaiting action, draft invoices awaiting issue, pay floors with no floor in force (shifts cannot be published; `rate-floors:119-133`), statutory holiday gaps (`holidays:114-123`). These are health signals that block publishing or mis-price pay and are visible only on their own pages.
