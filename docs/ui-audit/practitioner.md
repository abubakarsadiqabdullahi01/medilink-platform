> **Detailed audit — practitioner screens.** Written by reading every file in scope, in full, against commit
> `7ad839c` (the base of this work). File and line references are to that commit unless a note says a
> shared primitive has since changed. Findings tagged `[fixed in WT]` or "adoptable" refer to
> shared components that were being built while this was written; the summary in
> [../ui-ux-audit.md](../ui-ux-audit.md) says what has actually been done about each. Nothing here is a
> change; it is the evidence behind the summary.

# Practitioner and onboarding UI/UX + accessibility audit

Read-only audit of `src/app/practitioner/**`, its client components, `src/app/(auth)/{login,register,forgot-password}`, and `src/app/facility/register`. Audience context: 390px Android phones on weak 3G/4G.

## 0. Method, baseline and legend

- Everything was read in full (no sampling). Nothing was run in a browser; layout statements marked "verify" are derived from the CSS and not measured. Bundle size was not measured.
- **Concurrent edits.** `git status` shows someone else's uncommitted work in the shared layer: `globals.css`, `page-shell.tsx`, `status-badge.tsx`, `badge.tsx`, `card.tsx`, `dialog.tsx`, `sheet.tsx`, `skeleton.tsx`, `tailwind.config.ts`, plus untracked `components/app/{field,states,confirm-dialog,success-screen,dashboard,money,timeline,data-table,filter-bar,queue-age}.tsx`. **No screen in scope imports any of the untracked components yet.** Shared-primitive line numbers below are from the HEAD content I read. Where the working tree already fixes something it is tagged `[fixed in WT]`. All screen files in scope are unmodified, so their line numbers are stable.
- **Type scale (important).** `tailwind.config.ts:89-91` (HEAD `:82-84`) remaps `text-xs` to 14px and `text-sm` to 16px (UXA-01). So `text-xs` is at the project's 14px floor, and `text-sm` and `text-base` render identically. The only sub-14px text in scope is `text-[10px]` at `components/app/notification-bell.tsx:79`. I have not counted `text-xs` as a defect, only where consequential copy is set in the muted secondary style.
- Priority: **[C]** blocks a task, unsafe or misleading, or fails WCAG 2.2 AA. **[I]** clear friction or inconsistency. **[P]** polish.
- State legend: **L** loading, **E1** first-use empty, **E2** filtered empty, **OK** success confirmation, **V** validation failure, **NF** network failure distinct from empty, **PD** permission denied, **SU** server unavailable, **AR** archived/completed record, **DC** destructive confirmation. Y / partial / N, with line refs for N and partial.
- There is no `<Table>` anywhere in scope, no clickable `div`/`tr`, no hover-only control (only a decorative `group-hover` border at `setup-wizard.tsx:311`), no emoji, and no hard-coded colour on any in-app screen. Only the auth desktop panels use `border-white/15 bg-white/10` (login:165,174; register:520,529,541,550,562,571). Dates all go through `formatWhen`/`formatDate`/`formatMinutes`/`formatNaira`. The exceptions are the device-clock `new Date()` comparisons (fine) and `download-my-data.tsx:27`, which names the file with a UTC `toISOString().slice(0,10)`, so a download made 00:00-00:59 WAT is dated the previous day [P].

---

## 1. Cross-cutting findings (referenced from the screens as X-n)

**X-1 [C] Every route has the same `<title>`.** `src/app/layout.tsx:6` is `title: 'Medilink'`. All practitioner pages, all three auth pages and `facility/register` are client components, so they cannot export `metadata`, and no route layout sets one. WCAG 2.4.2 (A). It affects browser history, the app switcher, and the screen-reader page-change cue.

**X-2 [C] Select and Combobox controls with no accessible label.** `<Label>` has no `htmlFor` and the trigger has no `id` at: `timesheets/page.tsx:319` (What is wrong), `profile-form.tsx:133` (Profession, required), `:149` (Specialty), `:213` (How far you will travel), `credentials-section.tsx:139` (Type), `availability-section.tsx:202` (Day), `facility/register/page.tsx:131` (Type), `suggestion-dialog.tsx:105` (What it is about). `evidence-fields.tsx:174` has a `<Label>` for the `DocumentUpload` button with no association. The correct pattern exists in the same codebase (`facility/register/page.tsx:147-152`, `profile-form.tsx:180-181,200-201` for the state/LGA comboboxes). WCAG 1.3.1, 3.3.2, 4.1.2.

**X-3 [C] A failed load is rendered as empty, first-use, "not recorded", or an enabled action.** Priority is set by the worst case, erasure.
- a. `profile-form.tsx:76,108-126`: `useProfile` rethrows non-404 errors (`practitioner.ts:54-67`), so `profile.data` is undefined, `exists` is false, and the form says "Create your profile" and "You have no profile yet".
- b. The same cause makes the dashboard SetupCard say "Create your profile to get started / Start setup" (`practitioner.ts:135`, `page.tsx:404-406,415`). A failed `availability` fetch shows "When you can work" as not done (`practitioner.ts:118-122,136`).
- c. Availability tabs "Free on a date" and "Away" have no error branch, so a failed fetch reads "No dates marked as free" and "Nothing blocked out" (`availability-section.tsx:399-407,490-493`). Someone on leave may think the leave was lost and re-enter it.
- d. Privacy tab: none of the four queries handle `isError` (`privacy-section.tsx:93-111`). Consent renders an empty card (`:162-227`). Agreements reads "Nothing published yet." (`:243`). **Erasure renders an empty warning Alert (`:306-309`, `whatErasureDoes` undefined) with "Ask anyway" still enabled (`:321-327`)**, so a person can request erasure without having seen what it does.
- e. `profile-summary.tsx:126-155`: a failed `my-verification` reads "Not recorded yet. An officer does this."
- f. `excusal-panel.tsx:77` returns `null` on error, which removes the explanation form and the "no check-in recorded" warning.
- g. `notification-bell.tsx:98-103`: error with no data reads "Nothing yet. Offers, decisions and reminders…" The bell is the only channel for offers (its own comment, `:32-33`).
- h. `offers/page.tsx:82-87`: an agreements failure hides the "you must accept X" banner while Accept stays enabled. `my-invitations.tsx:67-68` swallows its error silently.

**X-4 [C] Dialog close target is 16×16px.** `dialog.tsx:62-65` at HEAD: `<X className="size-4">` with no padding. WCAG 2.5.8 (24×24 minimum). Affects every dialog here: dispute, withdraw consent, read agreement, step-up, suggestion. `[fixed in WT: dialog.tsx now size-11]`. Keep as a regression check.

**X-5 [I] No recovery path from failure.**
- No in-page error state has a retry control (offers:140-144, shifts:168-172, timesheets:164-168, earnings:120-124, credentials-section:205-209, availability-section:260-264, my-payout-account:93-98, dashboard:275-281/294/322, amount-figure:36-37). The only "Try again" is `session.tsx:127-137` and `error.tsx`.
- The in-page alerts print fixed text and discard `queue.error`, so 403, 5xx and offline all read the same ("Your offers could not be loaded.").
- `api.ts:39-45` has no `AbortController` or timeout, so a stalled 3G request leaves the skeleton up indefinitely (React Query only retries after a rejection).
- `api.ts:130` returns "Something went wrong." for anything that is not an `ApiError`, which includes offline and timeout. `fieldMessages` prints raw field keys ("accountNumber: …", `api.ts:31-33`).
- No `navigator.onLine` handling and no service worker (`public/` holds only icons and the manifest), so the installed PWA offers nothing offline.
- Untracked `states.tsx` (`describeError`, `ErrorState`) already models forbidden / network / server. Not used.

**X-6 [I] Results and "what happens next" live only in a transient toast.** Sonner at default duration, `sonner.tsx:12-28`, no `closeButton`.
- Toast-only: `offers:99-102` ("the facility still has to confirm you"), `timesheets:113,126-128` ("The shift is on hold until they decide"), `excusal-panel:70`, `check-in-panel:57`, `profile-form:98` (just "Saved"), `photo-field:74,85`, `availability-section:141,153,169,180`, `privacy-section:117,128,138`.
- Persisted counterparts exist only for payout account (pending card), wizard submit (waiting card), credentials, excusal.
- Error toasts that carry the cause ("That did not work" plus detail) vanish on a slow connection. Untracked `SuccessScreen` exists, unused.

**X-7 [I] In-app forms are not `<form>` elements.** Enter and the Android keyboard "Go" do nothing. Auth pages, `my-payout-account` and `step-up` are forms. Everything else is not: `check-in-panel:94-118`, `excusal-panel:104-123`, `offers:229-270`, `profile-form` (button `:245`), `credentials-section:138-195`, `evidence-fields`, all four forms in `availability-section`, `timesheets:318-361` (dialog), `privacy-section:374-404`, `suggestion-dialog:101-137`, `facility/register:119-258`.

**X-8 [I] Disabled primary button with no stated reason.** 15+ sites: offers:265 (Decline needs a reason), check-in-panel:111 (<6 chars), excusal-panel:116 (min 10, no counter, unlike timesheets:343-347), timesheets:355, profile-form:245 (no profession), credentials-section:190, evidence ResupplyForm:348, availability-section:392 and 481, my-payout-account:193 (account number must be exactly 10 digits, `:71-74`, field allows `maxLength={13}`), privacy-section:391, **register:477** (data-sharing checkbox), login:111, facility/register:255, suggestion-dialog:134. This contradicts the stated principle at `register:350-353` ("a button that is dead until every field is right gives somebody nothing to press and no reason why").

**X-9 [I] Fields have no help/error wiring.** Zero `aria-describedby`, `aria-live`, `aria-busy` or `aria-required` in scope. Only `aria-invalid` appears: register/forgot/evidence-fields:163, and the `FieldError` role=alert paragraphs (register:92-99, forgot:57-64, step-up:96-100). Hints and errors are text next to the field, not attached. Dynamic messages with no live region: `photo-field.tsx:121`, `evidence-fields.tsx:165-169`, `register:408-412` ("another code is on its way"), `register:483-487`, `timesheets:343-347`. Untracked `Field` does all of this. Not used.

**X-10 [I] `Alert` is always `role="alert"`** (`alert.tsx:25`), so static banners are announced assertively on load. Examples: offers:125 (agreements), earnings:106-112 (explainer), timesheets:152-160, profile/page:115-162 (one at a time), one per credential row with a note (credentials-section:236-245), one per ended unattended shift (excusal-panel:84).

**X-11 [I] Heading structure.** `CardTitle` renders a `<div>` (`card.tsx:32-40`) and is used as the section title in ~20 places, so most pages expose only an h1. Dashboard, timesheets, profile tab, availability and privacy have no h2 at all. Real `h2`s are styled four ways: `text-sm font-medium` (earnings:116, credentials-section:201), `text-sm font-semibold` (shifts:110), `text-sm font-medium text-muted-foreground` (offers:280), `text-lg` (wizard:127). Offers has an h2 for "Already answered" but none for open offers. The dashboard h1 is a greeting ("Hello, …"), not a topic.

**X-12 [I] Status badge gaps.** `status-badge.tsx` has no entry for `PREPARED`, `RELEASED`, `SETTLED`, `FAILED` (earnings:64-67 uses them) or `NOT_SUBMITTED` (setup-wizard:425), so a paid and a failed payout both render grey `secondary`. The badge says "Settled / Released / Prepared" while the row text says "Received / Approved for payment" (earnings:139-143). `DECLINED` is red `destructive` (status-badge:29), so a practitioner's own decline looks like a failure. Attendance `CHECKED_OUT` is `info`, so an unsubmitted timesheet reads "Checked out" (timesheets:199). Badges now carry an icon `[fixed in WT]`.

**X-13 [I] Raw ids and a heavy reference blob.** `nameOf` falls back to `id.slice(0,8)` (`reference.ts:47`). Offers (`:111-116`), profile-summary (`:61-70`), credentials-section (`:225`) and returned-notice (`:51`) show UUID fragments if the reference fetch is slow or fails. `useReference` (all 774 LGAs and every vocabulary) is in memory only (`reference.ts:32-39`) and is fetched on every cold load by the dashboard, profile and offers.

**X-14 [I] Request volume and payload on 3G.**
- Every practitioner page, via the layout: `/practitioners/me` (`usePhoto`→`useProfile`, `practitioner.ts:77-89`), a POST `/photo-url` re-polled every 4 minutes, and the bell polling `/me/notifications` every 60 seconds (`notification-bell.tsx:51`).
- Dashboard: the layout's `/practitioners/me` runs in parallel with the bundle (which also carries `profile`, under a different key), so it is fetched twice. `/staff-invitations/mine` and `/reference` only start after the bundle resolves (page.tsx:74,89, then `:173` and `usePractitionerSetup`), which is a second waterfall step. If the bundle fails, `Overview` fans out to 6+ requests (`page.tsx:58-63`).
- Unbounded lists: timesheets loads every assignment ever with revisions (`timesheets:101`), offers loads all invitations and slices to 10 client-side (`offers:53,109`), payouts, credentials and shift tabs have no paging.
- Uploads: up to 10MB raw, no client resize, no progress, no abort (`photo-field:31,56-71`, `document-upload:12,63-104`). HEIC is accepted (`photo-field:30`) though most browsers cannot render it, so the avatar silently falls back to initials (verify).

**X-15 [I] Phone ergonomics.**
- `Button size="sm"` is 40px (`button.tsx:36`) and is used for row actions. Text links at `text-xs` are ~21px tall: login:91-96, register:387-406, forgot:207-226. These are raw `<button>`s, not `Button variant="link"`.
- `Card` is `p-6` (`card.tsx:26,60`) inside the shell's `p-4` (`console-shell.tsx:385`), so only ~310px of a 390px screen is content. There is no responsive padding.
- Header at 390px: hamburger, title, bell, A, A+, theme and avatar total ~377px against 358 available, so the title truncates (`console-shell.tsx:309-364`, `text-size-control.tsx:47-57`).
- `Detail` `dd` is `truncate` (`page-shell.tsx` Detail), so facility names and "Someone will supervise" (offers:188) cut off in the 2-column grid. `formatWhen` strings (~135px) are borderline in the 147px column.
- At the A+ setting (`globals.css`, root 118.75%) the effective width is ~328px. Verify the wizard stepper, header and tab bars there.

**X-16 [I] Internal jargon shown to practitioners.**
- "matcher": `profile-form:230`, `copy.ts:10,12`, `availability-section:270`, `practitioner.ts:242`.
- "The sweep will withdraw it shortly": `offers:223`.
- "rate card", "invoiced": `timesheets:223-250`, `earnings:74,108-110`.
- "ledger", "audit row": `privacy-section:289-290`.
- "Manually corrected" badge: `timesheets:199`.
- "storage": `evidence-fields:84`.
- Third-person copy ("why was this practitioner unavailable", `availability-section:468`).
- Vocabulary collisions: **invitation** (facility staff, my-invitations) vs **offer** (shift) vs "Invited" badge on an Offers page (offers:174); **credentials** (nav tab, "Submit a credential") vs **documents** (wizard step, dashboard step `practitioner.ts:157`, "A document was refused"); **availability** (tab) vs "When you can work" (step) vs "Weekly pattern/Away"; **profile** vs "Your details" (step and card title).
- Button voice mixes first person ("Send me a code", "Send my explanation", "Create my account") with imperative ("Submit", "Add", "Save changes").

**X-17 [I] Notification deep links.** `lib/ui/inbox.ts:29-31`: `credential.verified/rejected/info_requested` go to `/practitioner/profile` with no `?tab=credentials`, so the tap lands on the Profile tab or in the wizard.

**X-18 [P] Type hierarchy.** With the remap, consequential statements are set in the muted 14px secondary style: the acceptance consent line (offers:247-250 [I]), the check-in code lifetime (check-in-panel:121-126), the erasure paragraph (privacy-section:287-292), the account-name rule (my-payout-account:187-190). `text-[10px]` at notification-bell:79 is the one sub-floor item. The unread dot has `aria-label` on a role-less span (`notification-bell:113-116`).

**X-19 [P] Sticky header and focus.** `console-shell.tsx:309` (`sticky top-0 z-40 h-14`) could hide focused controls (WCAG 2.4.11). `[fixed in WT: globals.css scroll-padding-top 5.5rem]`. `credentials-section:272` uses JS `behavior:'smooth'`, which the new reduced-motion CSS does not override.

**X-20 [P] Loading is silent to screen readers.** `QueueSkeleton` (`page-shell.tsx` QueueSkeleton) and the page skeletons have no status text (Skeleton is now `aria-hidden` `[fixed in WT]`, which makes it silent rather than announced). Untracked `LoadingStatus` exists. Hand-rolled controls: raw checkboxes (availability-section:218-226,361-369; register:328-346,457-463, sizes `size-5` vs `size-4`), `Avatar` `alt={name}` duplicating the adjacent name (`avatar.tsx:66`, `console-shell:334-335`).

---

## 2. Screens

### S1. Dashboard — `/practitioner`
- Files: `practitioner/page.tsx` (461), `components/app/my-invitations.tsx` (109), `profile/returned-notice.tsx` (72), `lib/ui/practitioner.ts` (277). Audience: any practitioner opening the app. Task: "Am I eligible, is anything waiting on me, where am I next."
- **Data:** bundle `['practitioner-overview']` → `/api/v1/dashboard/practitioner` (retry:false, seeds profile/eligibility/availability/my-credentials/invitations/my-assignments; `:64-72,103-115`). Then `useEligibility ['eligibility']`, `usePractitionerSetup` (profile, eligibility, availability, my-credentials, reference), `['invitations']` (`:134-141`), `['my-assignments']` → `/api/v1/assignments?scopeType=SELF&status=CONFIRMED` (`:143-152`), `['staff-invitations','mine']` (my-invitations:38-42). Layout adds session (initialData), profile, photo-url POST (4-min poll) and inbox (60s poll). **Blocking:** `:74-87` replaces the body with two skeletons until the bundle returns, although `Overview` already has per-section skeletons (`:193,291,319`). No per-row queries and no queries in closed dialogs. Duplicate and waterfall: see X-14.
- **States:** L partial (blocking skeleton `:74`, then per-section). E1 Y (SetupCard; "Nothing to answer." `:307`; "Nothing confirmed." `:332`). E2 —. OK — (links only). V —. NF partial: eligibility Y (`:275`) and the two tiles say "Could not load" with no retry (`:294,322`); profile/availability/credentials failures are misread (X-3b); MyInvitations silent (my-invitations:67). PD N (bundle 403 falls through to hooks, each prints a generic failure). SU N (same as NF). AR —. DC N: MyInvitations Accept routes the person out to `/facility` and switches their console (my-invitations:47-56) with no confirm, though the copy says "Nothing changes until you accept."
- **Findings**
  - [C] X-3a/b: failure shows "Create your profile to get started".
  - [I][mobile] Phone order (grid stacks, `:177-285`): invitations → ReturnedNotice/SetupCard → eligibility card → "Offers waiting" → "Next shift". An ineligible user's blocker list pushes the two things people open the app for below the fold, and an approved user's "You can be offered shifts" card sits above them.
  - [I] `open = status === 'INVITED'` ignores `expiresAt` (`:161`), so the tile counts lapsed offers and offers "Answer them" (`:299-305`) for offers the Offers page shows as lapsed.
  - [I] "Next shift" (`:314-335`): no facility, address or link to My shifts, no check-in affordance, a badge that always reads "Confirmed". `endsAt > now` is computed at render (`:163`).
  - [I] Missing from the screen though the data exists elsewhere: timesheets ready to submit (timesheets:140-143), money owed (earnings), credential expiry (`expiryOf`), a shift happening now.
  - [I][a11y] The setup list's done/to-do difference is icon-only and link-vs-text (`:441-453`, icons `aria-hidden`), so a screen reader cannot tell done from not done. The progress bar has no `aria-valuetext`. The step links are 24px text rows and are the primary CTA per missing item.
  - [I][perf] See X-14 (blocking bundle gate, waterfall).
  - [I][copy] "These are the reasons, in full. Nothing is being withheld." (`:218`) reads defensive; blocker copy carries "matcher" (`practitioner.ts:242`). `Hello, ${fullName.split(' ')[0]}` (`:78,169`) greets "Dr" or "Pharm." for titled names [P].
  - [P] `CardTitle text-sm` (`:288,316`) is a div (X-11); "Could not load" without retry (X-5).

### S2. Offers — `/practitioner/offers`
- File: `offers/page.tsx` (320). Task: decide on an offered shift (accept or decline with reason).
- **Data:** `['invitations']` via `useQueue` → `/api/v1/invitations` (`:74-78`, shared key with dashboard); `useReference` (`:72`); `['agreements']` (`:82-86`) always fires, though it only gates Accept. No polling. No blocking page loader (QueueSkeleton `:139`).
- **States:** L Y (`:138-139`). E1 Y (`:145-150`). E2 partial: answered list capped at 10 plus a toggle (`:53,109,303-313`). OK partial: toast only (`:99-102`, X-6); the card moves to "Already answered" with its status. V partial: Decline disabled until a reason (`:265`) with no hint; label says "required" only for declining (`:230-235`), no `aria-required`. NF Y (`:140-144`) but no retry and message dropped (X-5). PD N. SU N. AR Y (`:283-302`). DC N: Decline is irreversible with only the reason box as friction; Accept commits time plus legal terms (`:247-250`) with no confirm.
- **Findings**
  - [I][mobile] Header badge cluster is `flex shrink-0 flex-wrap` beside a `min-w-0` text block (`:159-176`). With urgency, shift type and status badges (~220px) the profession, facility and "offered …" text column drops to ~75px (verify at 390px).
  - [I] The hierarchy buries what decides acceptance: the facility name is a muted 14px line under the profession (`:162`). Details use uppercase muted labels (`:196,204,211`). "Answer by" is absolute only (`:183`), with no time left. `lapsed` is computed once at render (`:154`) and never refreshes, and the lapsed copy says "The sweep will withdraw it shortly." (`:223`).
  - [I][flow] Accept is not disabled or explained while agreements are outstanding (banner `:125-136` vs buttons `:253-262`). The fix path is banner → Privacy tab → find Agreements card → Read → I agree → back (privacy-section:242-266,426-430). Agreements failure hides the banner (X-3h).
  - [I] The decline reason is in `reasons[id]` and is sent on Accept too (`:95-98`), so text typed then abandoned reaches the accept payload.
  - [I] `professionOf` shows UUID fragments before reference loads (`:111-116`, X-13).
  - [I][cons] The status badge says "Invited" on a page called Offers (`:174`); declined is red (X-12). The open-offers section has no heading while "Already answered" has an h2 (`:280`). The "Show all" button is not `col-span-full` (`:303-313`).
  - [P] A card is ~7 stacked blocks with Accept last (`:178-271`); decline `Textarea` sits between details and the primary action.

### S3. My shifts — `/practitioner/shifts` (+ `check-in-panel.tsx` 129, `excusal-panel.tsx` 126)
- File: `shifts/page.tsx` (196). Task: see confirmed shifts, check in or out with the ward's code, explain an absence.
- **Data:** `['my-shifts', status]` → `/api/v1/assignments?scopeType=SELF&status=…&include=attendance` (`:138-143`), 60s stale (check-in state can be a minute old; `timing.live` exists unused). **Per-row query:** `['my-excusals', id]` for every ended-unattended or NO_SHOW card (`excusal-panel:54-64`), which is N+1. No polling, no blocking loader.
- **States:** L Y (`:166`). E1 Y for Confirmed (`:173-182`); other tabs read "Nothing no show" (`:176`) with no description. E2 partial: "Nothing today." (`:104`), though the default range is `all` (`:136`). OK partial: toast "Checked in" (check-in-panel:57), then the badge updates. V partial: Check in disabled <6 chars (`:111`), server failure by toast "That code did not work" (`:62`), no inline error or `aria-invalid`. NF partial: list Y, no retry (`:168-172`); excusal silently null (`:77`). PD N. SU N. AR Y (tabs). DC N: Check out is one tap (`:110-117`).
- **Findings**
  - [I][flow] Check-in is not a form (`:94-118`, X-7); label reads "— or a scanned QR" (`:98`) but there is no scanner. `notYet` uses `Date.now()` at render (`:70`) with no timer, so at T-3h the panel keeps saying "Check-in opens …" until a refetch, for someone standing at the ward door.
  - [I] No address, ward or "what to bring" on a confirmed shift: the `Assignment` type (`page.tsx:24-35`) lacks what the offer carried (offers:46,44-45). The facility is a truncating `Detail` (`:56`, X-15).
  - [I][mobile] Four-tab status bar is ~380px (estimate) against 358 (`:156-164`), so "Cancelled" is clipped with no scroll cue. Two tab bars (`:95-101`, `:156-164`) have no `TabsContent`, so Radix `aria-controls` points at missing ids; they behave as filters.
  - [I][flow] Excusal is offered only while CONFIRMED and ended (`:68-70`, `canAsk` `:104`). After an officer marks NO_SHOW the practitioner cannot add their side. Min length 10 is invisible (`:23,116`, unlike timesheets:343-347). Panel returns `null` while loading (layout shift).
  - [I][a11y] A `role=alert` warning per ended shift (X-10).
  - [P] Description says "soonest first" (`:153`) but ended-unconfirmed shifts sort first (`agenda.ts:56-57`). "in 18 Oct 2026, 09:00" reads as a duration (check-in-panel:77-83). Attendance badge "Not started" on every future shift (`:75`). Default range `all` rather than Today.

### S4. Timesheets — `/practitioner/timesheets` (+ dispute dialog)
- File: `timesheets/page.tsx` (366). Task: submit worked hours, then accept or dispute the facility's decision.
- **Data:** one `['my-assignments-for-timesheets']` → `/api/v1/assignments?scopeType=SELF&include=timesheet` (`:97-103`), unbounded and carrying revisions (X-14). No per-row queries, no polling, no blocking loader. Invalidated by check-in-panel:60.
- **States:** L Y (`:162`). E1 Y (`:169-174`). E2 N: no filter or search, API order (`:136-138`). OK partial: toasts (`:113,126-128`); after a dispute opens the card is unchanged (`Assignment` has no dispute field, `:40-49`). V partial: dispute counter (`:343-347`, not live). NF Y (`:164-168`), no retry. PD N. SU N. AR partial: decided sheets keep "Dispute this" with no deadline (14-day rule only inside the dialog, `:313`). DC: Submit N (`:277-282`); dispute dialog Y but does not name the shift (`:311-315`).
- **Findings**
  - [C] X-2 `Label` at `:319` for the category Select.
  - [I][flow] One-tap "Submit ₦40,000.00" with no review (`:277-282`). The card has worked/break/billable but no check-in/out clock times to check them against (`:217-227`). The label implies a payment, while the page says it is not what is credited (`:221-223,245-251`).
  - [I][flow] No visible dispute state after opening; "Dispute this" stays active (`:285-296`) and the only record of "the shift is on hold" is a toast (`:127`). The dialog does not name which shift, and dismissing it discards typed text (`:307`, reset on open `:290`).
  - [I][cons] The badge shows attendance status, so an unsent sheet says "Checked out" (X-12) while the banner says "ready to submit" (`:152-160`). "revision N" is lowercase (`:193-197`).
  - [I][copy] Pricing is explained in three muted blocks plus a four-figure row, including "Night 0h Overtime 0h Holiday 0h" for every sheet (`:229-251`), with "rate card" and "invoiced" jargon (X-16). Facility is a muted line under the date (`:190-192`). Revision rows have no date or author (`:70-74,260-267`).
  - [P] No "submit all" though the banner counts N; the loading spinner is per row (`:278`).

### S5. Earnings — `/practitioner/earnings` (+ `my-payout-account.tsx` 206, `step-up.tsx` 152)
- File: `earnings/page.tsx` (158). Task: see what is owed and paid, and give a bank account.
- **Data:** `['my-earnings']` → `/api/v1/payouts?scopeType=SELF` (`:55-61`; default retry, so ~3s before an error shows; unbounded). `['my-payout-account']` → `/api/v1/me/payout-account` (my-payout-account:49-52). No polling, no blocking loader.
- **States:** L Y (AmountFigure skeleton `:82`, `:119`). E1 Y (`:125-130`). E2 N. OK: payout account toast plus a persistent pending card (my-payout-account:57-59,133-146). V partial: button disabled until bank≥1, name≥2, number=10 digits (`:71-74,193`), no messages, letters accepted. NF Y: "Could not load" tiles plus Alert (`:120-124`), no retry. PD N (nav gated by `invoice.read`, direct URL gives a generic failure). SU N. AR Y. DC: change account asks the password via step-up Y; the "payments keep going to the old account until verified" note appears only after saving (`:141`).
- **Findings**
  - [I][cons] X-12: payout badges are grey, `FAILED` is grey, and the wording differs from the row text. A failure reason (`:146-148`) comes with no next action.
  - [I][flow] A payment row does not say what it covers (shifts, facility, period) and does not link to timesheets (`:133-153`).
  - [I][flow] The bank account card sits after three tall figure cards and an explainer (`:77-114`), and a missing account (the blocker to being paid) is flagged only inside the card (my-payout-account:100-114).
  - [I][a11y] "Add your account" unmounts on click (`:86-90`), so focus is lost, and Cancel unmounts the form. Bank name is free text (`:158-166`) although a `Combobox` exists. `maxLength={13}` vs 10 required (`:173,74`). Masked bullets `••••••1234` are read aloud as bullets (`:120,137`).
  - [I][mobile] `text-3xl` amounts always with `.00` in a 3-column grid from `sm` (`earnings:77`, `amount-figure:42`): amounts of ₦1,000,000.00+ will wrap at 640-1100px (verify). Fine at 390 (one column).
  - [P] `Card mb-8` (my-payout-account:80) vs `mb-6` elsewhere; the info Alert has no icon (`:106`) unlike timesheets:154; h2 "Payments" (`:116`) follows a non-heading card; rows use `space-y-3` and `pt-5` where other lists use `gap-4`/`pt-6`.
- Step-up dialog (`step-up.tsx`): password field has no show toggle; the error `<p role=alert>` is not attached to the input (`:96-100`); focus starts on the password (`autoFocus` `:92`), which is correct.

### S6. My profile shell — `/practitioner/profile` (+ redirect routes `availability`, `credentials`, `privacy`, 6 lines each, which `redirect()` to `?tab=`)
- File: `profile/page.tsx` (214), `copy.ts` (17). Task: maintain details, documents, availability and privacy; or be walked through setup.
- **Data:** `usePractitionerSetup` → profile, eligibility, availability, my-credentials (no `retry:false`, `practitioner.ts:118-131`), reference. The `ready` latch waits for profile, availability and eligibility only (`practitioner.ts:200-202`), so `rejected` can be empty when `startedInSetup` is fixed (`page.tsx:58-60`) and CHANGES_NEEDED can be missed at first. Inactive tab content is unmounted by Radix, so each tab's queries fire when opened.
- **States:** L partial: body replaced by `Skeleton h-96` (`:70-80`); `Suspense` fallback has no header (`:43`). E1 Y (wizard). NF N (X-3a/b). The rest as per tab.
- **Findings**
  - [I] The wizard decision is a ref set once (`:58-60`); step index is not in the URL, so refresh or Back loses place. The banners (`:115-162`) duplicate dashboard SetupCard copy (P5).
  - [I][mobile] Two nested tab bars (`:164-181` and availability's own); sub-tab state resets on parent switch. The top bar is ~360px with attention dots, and the wrapper gives no scroll cue (`:167-168`).
  - [P] Attention dot is 6px with `sr-only` text (`:174-175`), fine. `needsAttention` ignores a rejected credential until profile exists (`:100`).

### S6a. Setup wizard — `profile/setup-wizard.tsx` (602)
- Task: first-time setup in 4 steps (details, availability, documents, review and submit).
- **Data:** reuses the sections' queries; no extra. **States:** NF/PD/SU N (see X-3, X-5). OK Y at the end (submitted card `:474-509`, persistent, says what happens next). V per step via disabled steps/notes. DC: Submit for approval is preceded by a checklist review (`:511-579`), which is good.
- **Findings**
  - [C][a11y] Phone `Stepper` buttons are named only by a digit: the label span is `hidden … sm:inline` (`:317-327`), so display:none removes it from the name; the only text is "(done)" (`:315`). Four anonymous circles on the device this is designed for.
  - [I][a11y/flow] `setStep` (`:135,137,148,149,165,166,178`) neither moves focus nor resets scroll. The focused Continue button unmounts (focus → body), and the next step appears at the clamped scroll position with its "Step N of 3" heading off screen.
  - [I][flow] Header promises "Everything you enter is saved as you go" (`:99`). It is not: step 1 saves only on "Create profile/Save changes" (`profile-form:245`) and **Continue just changes step (`:136-140`), discarding unsaved edits**. Document uploads count only on Submit. Step 1 auto-advances only on first create (`:135`), so later it needs Save then Continue (two primary buttons).
  - [I][flow] "Skip for now" is an outline button the same size as Continue (`:150,167,369`), with its consequence only in a muted note (`:151-153,168`).
  - [I][flow] Double-submit window: the mutation resolves before the profile refetch (`:464-472`), so on 3G the button is enabled again for seconds before `submittedAt` arrives (`:474`).
  - [P] `Sparkles`/`CircleAlert` lack `aria-hidden` (`:516,518`). `RequiredDocuments` (`:379-434`) duplicates the list below it. "An officer does not start reviewing until you do" appears 4× (`:53,527`, `page.tsx:132,410`).

### S6b. Profile tab — `profile/profile-form.tsx` (253), `photo-field.tsx` (164), `profile-summary.tsx` (202)
- Task: set profession, location, travel, photo.
- **Data:** `['profile']`, `['reference']`, `['photo-url']` POST (via `usePhoto`), `['my-verification']` (profile-summary:104-108, retry:false). **States:** L Y (`:108-109`). E1 Y (`:118-126`). OK partial: toast "Saved" only (`:98`). V N: button disabled when no profession (`:245`), no messages; server field errors surface as a raw toast. NF N (X-3a, X-3e). PD/SU N. DC: photo "Remove" has no confirm (`photo-field:147-159`, reversible).
- **Findings**
  - [C] X-3a, X-3e, X-2 (`:133,149,213`).
  - [I][flow] Changing profession does not clear specialty (`:134`, whereas state clears LGA `:189-194`), so a stale `specialtyId` is submitted (`:86`). Changing profession after credentials exist changes the required set with no warning.
  - [I][flow] State and LGA are optional but drive matching (explained in a muted note, `:229-232`); travel silently defaults to SAME_STATE (`:61`). No unsaved-changes guard or dirty indicator; save is at the bottom of a long form.
  - [I][a11y] `photo-field:121` error not announced. "Optional" is marked four ways (specialty placeholder `:154`, "(optional)" label `:235`). Specialty shows "None" when no profession is chosen (`:154`).
  - [I][perf] X-14 photo upload.
  - [I] `OnRecord` has no error branch (X-3e); "Changes needed" badge uses a `Clock` icon (`profile-summary:51`) [P].

### S6c. Credentials tab — `profile/credentials-section.tsx` (356), `evidence-fields.tsx` (206), `components/app/document-upload.tsx` (177)
- Task: submit a document or reference, answer a reviewer, check status.
- **Data:** `['my-credentials']` (shared with the setup hook: one fetch), `['reference']`. No per-row queries.
- **States:** L Y (`:203-204`). E1 Y compact (`:210-216`). E2 N (full history including superseded rejections). OK partial: toast "Submitted for review" (`:121`) plus a list row; no expected review time anywhere. V partial: NIN shape error appears while typing (`evidence-fields:94-101,165-166`); other cases only a disabled button (`:190`). NF Y (`:205-209`, "These could not be loaded.", no retry). PD/SU N. AR partial (below). DC —.
- **Findings**
  - [C] X-2 (`:139`, `evidence-fields:174`).
  - [I][mobile/flow] On a phone the list sits below the form (`:130-200`); a returner checking status scrolls past it. "Submit again" scrolls to page top (`:268-273`), but the form is below header, summary, banners and tabs, so top is not the form. Smooth scroll ignores reduced-motion (X-19) and focus is not moved.
  - [I] A stale REJECTED row keeps "Submit again" after a newer submission exists (`:259-278` vs `taken` `:89-93`). Clicking sets a disabled option as the selection (`:269`) and enables Submit; the server then refuses.
  - [I][flow] EXPIRED has no action button though it is an eligibility blocker (`practitioner.ts:251-255`), while REJECTED has one. There is no "expiring soon" signal; the date is a muted line (`:227-231`).
  - [I][a11y] The upload dropzone swaps to a "filename ✓ Remove" row (`document-upload:106-126`) with no announcement and focus lost; `CircleCheck` lacks `aria-hidden` (`:110`). Upload has no progress, cancel or retry (`:75-91`).
  - [I][copy] In the resupply form both fields read "optional" (`:338,344`, `evidence-fields:176-178`) but Send is disabled until one is given (`:329-332`), with no message. "It goes straight to storage." (`evidence-fields:84`).
  - [P] Form card title is a div while the list has an h2 (`:135` vs `:201`); generic "Submit" (`:194`).

### S6d. Availability tab — `profile/availability-section.tsx` (512)
- Task: set a weekly pattern, mark one-off free time, block leave.
- **Data:** one `['availability']` (`:93-97`, default retry), shared with the setup hook. No polling.
- **States:** L Y per tab (`:258,399,490`). E1 Y (`:265-271,401-407,492-493`). E2 partial: past one-offs hidden (`:102-104`), past blocks shown forever and unsorted (`:495-506`). OK partial: toasts (`:141,153,169,180`). V N/partial: no start<end, overlap or duplicate checks; block button disabled until reason ≥3 (`:481`); a thrown date error becomes a toast (`:156-164`). NF: pattern tab Y (`:260-264`); **dates and away tabs N (X-3c)**. PD/SU N. AR N. DC N: Remove is one tap, unnamed, no undo (`:292-300,419-427`).
- **Findings**
  - [C] **No way to remove an "Away" block**: `:495-506` renders blocks with no control, although `DELETE /api/v1/availability/blocks/[id]` exists (`src/app/api/v1/availability/blocks/[id]/route.ts`). A mistaken date range cannot be undone from the UI.
  - [C] X-3c, X-2 (`:202`).
  - [I][flow] "Every day" or "Monday to Friday" fires up to 7 parallel POSTs (`:130-139`); a partial failure leaves a partial pattern behind one error toast, and nothing guards duplicates.
  - [I] The three one-tap buttons commit immediately and only the first has `loading` (`:324` vs `:330,334`), so repeat taps create duplicates (verify server dedupe).
  - [I][a11y] Every row action is named just "Remove" (`:292-300,419-427`). Raw 20px checkboxes (`:218-226,361-369`).
  - [I][copy] Night hint "put the later time first" is confusing (`:252-254`). The away label is a long third-person sentence (`:465-471`). Time zone is stated on the dates tab (`:319`) but not on the datetime-local fields (`:447-461`).
  - [P] `id="from"`/`"to"` are generic (`:230,239`). Verbose ranges with years wrap (`:417,500`). Nested tab bar (`:185-190`).

### S6e. Privacy tab — `profile/privacy-section.tsx` (436)
- Task: manage consent, accept agreements, download or erase data.
- **Data:** on tab open: `['consent']`, `['agreements']` (shared with Offers), `['erasure']`, `['my-data-requests']` (`:93-111`). The erasure pre-check fires whether or not the person ever reaches that card.
- **States:** L Y (`:162-163,240-241,302-303`). E1 partial ("Nothing published yet." `:243`). OK partial: toasts (`:117,128,138`) plus a requests list. V partial (withdraw reason, disabled `:391`). **NF N (X-3d).** PD/SU N. AR —. DC: withdraw consent Y (names the purpose, consequence and reversibility, `:364-371`); **erasure N**.
- **Findings**
  - [C] X-3d (erasure offered with an empty explanation).
  - [I][flow] "Ask anyway" (`:321-327`) fires one-tap even when `canProceed` is false, can be raised repeatedly (the open request is not checked, `:333-354`), and its consequence is a toast (`:138`).
  - [I] Withdrawing consent requires a typed reason (`:391`), while granting is one tap (`:214-222`). Withdrawal should not be harder than giving.
  - [I][copy] Legalese in muted text (`:287-292`); monospace identifiers ("font-mono") in the agreements list and dialog (`:252-254,412`).
  - [I][mobile] The agreement dialog nests a `max-h-[50vh] overflow-y-auto` scroller inside the dialog's own 90dvh scroller (`:418`); the inner region is not keyboard-focusable.
  - [P] `CardTitle text-base` plus default `CardHeader` padding (`:155,233,277,298,336`) vs `pb-3` + `text-sm` elsewhere (identical type size after the remap, different spacing). Generic `id="note"` (`:375`).

### S7. Shell used by every practitioner screen — `console-shell.tsx` (392), `console-layout.tsx` (101), `notification-bell.tsx` (161), `text-size-control.tsx` (65), `suggestion-dialog.tsx` (162), `download-my-data.tsx` (38)
- Nav is a hamburger drawer on phones with focus trap and return-focus (`console-shell:166-207`), good. Five destinations, no bottom bar.
- [I] Bell polls every 60s (`:51`), swallows poll errors (`:53-54`) and, with no data, shows "Nothing yet" on failure (X-3g). `text-[10px]` badge (`:79`). A message with no mapped link is a `<button>` that only marks read (`:145-151`). Links: X-17.
- [I] Header crowding at 390px (X-15). `usePhoto` runs in the layout for every page (X-14).
- [I] `SuggestionDialog`: Select unlabelled (`:105`); Tabs without `TabsContent` (`:94-99`); "Loading…" and error are plain text (`:142-147`).
- [P] Account menu "Download my data" duplicates Privacy (`console-shell:354`); Sign out has no confirm (fine). `Avatar` `alt` duplicates the name (X-20).

### S8. Login — `/login` (`(auth)/login/page.tsx`, 187)
- Task: sign in with phone and password. **Data:** none on load; submit chains `POST login` then `GET session` (`:28-29`, two serial round trips on 3G).
- **States:** L n/a. V partial (button disabled `:111`, no hint). NF partial: server errors Y (`:59-74`); offline reads "Something went wrong." (X-5). OK redirect to console. PD —. DC —.
- **Findings**
  - [I][flow] The return URL is lost: `session.tsx:124,145` redirect to `/login` with no `next`, and login always goes to the console root (`:32`). A mid-form session expiry loses place and unsaved input.
  - [I] No show/hide password (`:98-104`), with a 10-character minimum elsewhere. "Forgot your password?" is a ~21px `text-xs` link on the lockout recovery path (`:91-96`).
  - [I][mobile] Everything that explains the product (`:159-184`) is `hidden` below `lg`; phones get four stacked link rows (`:119-152`) in mixed register.
  - [P] Two hard-coded white tints (`:165,174`); eyebrow "MEDILINK" `text-xs uppercase`.

### S9. Register — `/register` (`(auth)/register/page.tsx`, 604; `?as=facility|staff` variants)
- Task: create an account in 3 steps (details, code, password). **Data:** mutations only; the finish chain is `set-password` → `login` → `session` polled up to 8× at 1s (`:167-201`).
- **States:** L partial (button spinner; "Setting up your workspace" at `:483-487` not live). V Y per field (`FieldError` role=alert plus `aria-invalid`, no describedby, `:92-99`). NF partial: top Alert `start.error ?? verify.error ?? finish.error ?? resend.error` (`:203,264-269`) generic offline text. OK: redirect to console (`:196-199`), no confirmation. PD/SU —. DC —.
- **Findings**
  - [I][flow] The finish chain is not recoverable: if the network drops after `set-password` succeeds, Retry re-posts it with a spent token (verify server behaviour) and the person stays on step 3 with a generic error while the account exists.
  - [I] Consent bundling: "Create my account" is disabled until the data-sharing box is ticked (`:477`) while the copy says "You can withdraw it at any time" (`:467-469`) and the Privacy tab treats it as optional. Needs compliance review. It also contradicts the `:350-353` comment, and this checkbox is `useState` while the terms box is react-hook-form.
  - [I][a11y/flow] Step changes do not move focus; the code field has no `autoFocus` (`:368-376`). Progress `ol` circles show a `Check` with no `aria-hidden` or "completed" text, `aria-current` is on the span (`:237-259`); only the current step name is shown, at `text-xs` (`:260`).
  - [I] Resend: confirmation is a non-live `text-xs` line (`:408-412`), there is no cooldown, and "Send it again" / "Change the number" are ~21px raw buttons (`:387-406`). No support fallback if the SMS never arrives (`SupportContact` exists, unused here; login has a "Contact a person" link `:129-133`).
  - [I][mobile] "What happens next" (credentials review, "Nothing is hidden from you") lives in the `hidden lg:flex` panel (`:508-583`), so phones never see it. The new practitioner lands on the dashboard with no "account created" confirmation (the SetupCard acts as the next step).
  - [P] Optional marked "(optional)" (`:307`), placeholder carries an instruction (`:283`), password typed twice on a phone, terms links `target="_blank"` mid-flow with no cue (`:337-343`), stale comment "no way to reset a password from the interface yet" (`:437-440`).

### S10. Forgot password — `/forgot-password` (`(auth)/forgot-password/page.tsx`, 241)
- Task: phone → code + new password. **Data:** mutations only.
- **States:** V Y (`FieldError` role=alert, `aria-invalid`, `:57-64`). NF partial (generic offline text; combined `failure` precedence can show a stale error, `:103`). OK: `role="status"` then **auto-redirect after 2.5s** (`:95,128-132`). PD/SU —. DC —.
- **Findings**
  - [I] "Send it again" gives no feedback and has no cooldown (`:99-101,207-215`); both secondary actions are ~21px `text-xs` buttons (`:207-226`).
  - [I] The success message disappears after 2.5s (`:95`), too fast for slow readers and screen readers; the timer is never cleared.
  - [I] Step change has no focus management (`:133`/`:155`); no show-password toggle; the hint repeats the error text (`:188` vs `:49`); no support fallback.

### S11. Facility register — `/facility/register` (`facility/register/page.tsx`, 263)
- Task: a signed-in new facility owner registers the facility. **Data:** `['reference']`. Sits inside the facility console shell.
- **States:** L partial (reference not awaited: selects are empty while loading or failed, `:132-143,178-191`). E1 —. V N: disabled until thresholds (`:87-93,255`), no field messages, server errors via toast (`:84`). NF N. OK: toast then `router.push('/facility')` (`:70-83`), and the "nothing goes live immediately" Alert sits above the form (`:102-109`), which is good. DC —.
- **Findings**
  - [C] X-2 `:131` (Type) next to a correctly labelled select at `:147-152`.
  - [I] Not a form (X-7); button disabled with no reason (X-8); required fields unmarked.
  - [I][cons] "Telephone" (`:218`) vs "Phone number" (login:77); optional marked "(optional)" (`:229`), "— optional for now" (`:241`), placeholder "Optional" (`:202`).
  - [P] The form card is full width on desktop (no `max-w`, `:111-260`); `CardTitle` "Your details" duplicates the profile card title.

---

## 3. (a) Patterns repeated in 3+ places (candidate shared components)

| # | Pattern | Occurrences (file:line) | Candidate / note |
|---|---|---|---|
| P1 | Failed-load alert with no retry, fixed text | offers:140-144; shifts:168-172; timesheets:164-168; earnings:120-124; credentials-section:205-209; availability-section:260-264; my-payout-account:93-98; dashboard:275-281,294,322; amount-figure:36-37; suggestion-dialog:144-147 | `ErrorState`/`describeError` already exists untracked (`states.tsx`) |
| P2 | No error branch (failure reads as empty) | availability-section:399-407,490-493; privacy-section:162-227,240-269,302-329; profile-summary:126-155; notification-bell:98-103; excusal-panel:77; my-invitations:67-68; profile-form:108-126; offers:82-87 | same query-state wrapper |
| P3 | Label + control + hint + error wired together | every input in X-7's list; hand-copied error paragraphs: register:92-99, forgot:57-64, step-up:96-100, evidence-fields:165-169, photo-field:121, document-upload:169-174 | `Field` (untracked) |
| P4 | Select without label/id | X-2's 8 sites + evidence-fields:174 | `Field` + `SelectTrigger id` |
| P5 | Application-state banner copy | dashboard:372-390,396-459; profile/page:115-162; setup-wizard:474-509,511-579; returned-notice used at dashboard:179-181 and profile/page:113 | one `ApplicationStatus` component |
| P6 | Result only in a toast | offers:99-102; timesheets:113,126-128; excusal-panel:70; check-in-panel:57; profile-form:98; photo-field:74,85; availability:141,153,169,180; privacy:117,128,138 | `SuccessScreen` (untracked) or persistent inline result |
| P7 | Disabled primary with no reason | X-8's list (15 sites) | submit button with described-by hint, or enable and validate |
| P8 | Inputs outside a `<form>` | X-7's list (12 files) | `Form` wrapper |
| P9 | Multi-step flow with no focus/scroll handling | setup-wizard:135,137,148,149,165,166,178; register:142,157,400; forgot-password:82,220 | `StepFlow` that focuses the step heading |
| P10 | Card header, title left, `shrink-0` badge cluster right | offers:159-176; shifts:42-51; timesheets:187-200 | `RecordCard` with a wrapping header |
| P11 | One-tap destructive or irreversible action | availability:292-300,419-427; photo-field:147-159; privacy:321-327; check-in-panel:110-117; timesheets:277-282; offers:263-269 | `ConfirmDialog` (untracked) |
| P12 | Row action with no row context ("Remove") | availability:292-300,419-427; photo-field:147-159; document-upload:113-123 | `aria-label` including the object |
| P13 | Optional marked N ways | register:307; facility/register:202,229,241; evidence-fields:153,177,194; profile-form:154,235 | `Field optional` |
| P14 | Hand-rolled checkbox | availability:218-226,361-369; register:328-346,457-463 | shared `Checkbox` with 44px label |
| P15 | `nameOf` UUID fallback | offers:111-116; profile-summary:61-70; credentials-section:225; returned-notice:51 | `useNameOf` that blanks while loading |
| P16 | `Detail` with `truncate` for long values | offers:179-189; shifts:54-59; timesheets:217-227 | wrap, or label-over-value that breaks |

---

## 4. (b) Top 10 findings, ranked

1. **Failed loads read as empty, first-use or "not recorded", and erasure is offered without its explanation** (X-3). [C] Profile form, dashboard setup card, availability leave, privacy, verification, bell.
2. **"Away" leave blocks cannot be removed** (`availability-section:495-506`; the DELETE route exists). [C] Blocks a task for anyone who mistypes dates.
3. **Setup wizard on a phone: unnamed step buttons, no focus or scroll reset between steps, and "saved as you go" is false** (Continue discards unsaved details) (S6a). [C]/[I] This is the first-run path.
4. **Unlabelled Select/Combobox controls, including Profession** (X-2, 9 sites). [C]
5. **Every route is titled "Medilink"** (X-1). [C] Cheapest fix on the list.
6. **Offers screen: the decision data is poorly placed and the Accept path leaks** (S2). [I] Badge cluster squeezes the text on 390px, facility name muted, no time-left, Accept enabled while agreements outstanding with a 5-tap fix path, UUID fragments before reference loads.
7. **No recovery from failure anywhere** (X-5): no retry buttons, no timeout, no offline cue, generic "Something went wrong.", permission and server errors indistinguishable. [I]
8. **Money screens: one-tap timesheet submit with no review or clock times, no visible dispute state, grey payout badges, jargon** (S4, S5, X-12). [I]
9. **Result and next-step messages exist only as 4-second toasts** (X-6, P6), plus disabled buttons with no reason (X-8) and no Enter-to-submit (X-7). [I]
10. **Dashboard: blocking bundle gate, request waterfall, and the phone order that puts "Offers waiting" and "Next shift" below the eligibility card** (S1, X-14). [I]

(Dialog close target X-4 is [C] by WCAG but already fixed in the working tree, so it is not ranked. Remaining `[fixed in WT]` items: X-12 badge icons, X-19 scroll-padding, X-20 skeleton `aria-hidden`.)

---

## 5. (c) Dashboard anatomy — exact sections and data sources, in render order

Use this to reorder without losing anything. Every item below exists today; reordering is a layout change, not a data change.

**Shell above the page (from `console-layout.tsx` / `console-shell.tsx`, every page)**
1. Header (sticky, 56px): hamburger (below `lg`), "Practitioner" title (below `lg`), bell (`['inbox']`, 60s poll), text size A / A+ / A++ (A++ hidden on phones), theme toggle, account menu (Send a suggestion if `suggestion.submit`, Download my data, Sign out). Avatar uses `['profile']` + `['photo-url']` (POST, 4-min poll).
2. Nav (drawer on phone, sidebar on desktop): Today → Overview, Offers, My shifts; Getting paid → Timesheets, Earnings; Your account → My profile. Items are filtered by permission.

**Page (`practitioner/page.tsx`)**
3. **Pending phase** (`:74-87`, until bundle resolves): h1 "Hello, {first word of fullName}" + static description, two skeletons (`h-40`, `h-24`). Bundle `['practitioner-overview']` → `/api/v1/dashboard/practitioner` (retry:false). On error it falls straight into the next phase.
4. **PageHeader** (`:168-171`): h1 "Hello, {first name}"; description "Whether you can be offered work, what is waiting on an answer, and where you are next due."
5. **MyInvitations** (`:173`, `['staff-invitations','mine']`): zero or more cards "{facility} has invited you to join as {role}" with Decline and Accept (Accept signs the user into the facility console). Renders nothing when empty or on error.
6. **Grid** (`:177`, 3 columns at `xl`, one column on phone; main column spans 2):
   - 6a. **ReturnedNotice** (`:179-181`) when `setup.ready && state === 'CHANGES_NEEDED'`. Data: `['my-credentials']` rejected rows + `['reference']` for names. Lists each refused document with the reviewer's note, plus "Fix and resubmit" → `?tab=credentials`.
   - 6b. **SetupCard** (`:183-191`, `:355-461`) when `setup.ready` and state is not `APPROVED`/`CHANGES_NEEDED`:
     - WAITING: "Waiting for approval", submitted time, "View my profile".
     - READY: "Everything is in — submit it for approval", CTA "Review and submit".
     - DRAFT: "Finish setting up your profile" or "Create your profile to get started", "N of 3 steps done. Next up: …", CTA "Continue setup" or "Start setup".
     - DRAFT/READY also show a progress bar (`role=progressbar`) and a 3-item step list (Your details, When you can work, Your documents), each unfinished item linking to its tab.
     - Data: profile, eligibility, availability, my-credentials, reference.
   - 6c. **Eligibility card** (`:193-282`), data `['eligibility']`: skeleton / "You can be offered shifts" (success border) / "You cannot be offered shifts yet" with "Yours to do" (blockers with a link) and "Waiting on Medilink" (blockers without a link) and "Nothing in this second list is waiting on you." / destructive Alert "Your eligibility could not be loaded…" (no retry).
   - 6d. **Offers waiting** card (`:286-312`), `['invitations']`: skeleton / "Could not load" / count of `INVITED` rows (expiry ignored) with "Answer them" → `/practitioner/offers`, else "Nothing to answer."
   - 6e. **Next shift** card (`:314-335`), `['my-assignments']` (CONFIRMED only): skeleton / "Could not load" / start time, "until {end}", status badge / "Nothing confirmed." Earliest assignment whose end is in the future.
   - Side column (6d, 6e) is a 2-column grid at `sm`, one column at `xl`.

**Fetches behind the page (for the redesign's loading plan)**
- In the bundle: profile, eligibility, availability, credentials, invitations, confirmed assignments.
- Not in the bundle, fetched after it resolves: `['reference']`, `['staff-invitations','mine']`.
- Fetched by the layout in parallel with it: `['profile']` (so the profile is requested twice), `['photo-url']`, `['inbox']`.

**Not on the dashboard today:** timesheets ready to submit, amount owed or paid, credential expiry, check-in prompt for a shift happening now, facility or place for the next shift, any link from "Next shift" to My shifts, unread-notification summary beyond the bell badge.
