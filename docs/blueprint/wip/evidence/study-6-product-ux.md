# Study 6 — User-facing product, quality and docs (fact sheet)

Repo: `/home/user/medilink-platform`, HEAD `5c199c1` (2026-10-13). Read-only study; nothing in the repo was modified or run
(no DB, no app, no tests executed). Everything below is from reading code/docs at HEAD, except contrast ratios, which I
computed from the CSS tokens (method in section 4.5). Convention: **as built** facts first, **GAP** items marked separately.
Paths are relative to the repo root unless absolute.

Contents: 1 Consoles and roles · 2 Journeys · 3 Public pages · 4 Accessibility/readability · 5 Quality (tests, CI) ·
6 Docs inventory · 7 Demo seed · 8 Verification of the redesign-doc claims · 9 Gaps the redesign doc did not mention ·
10 v2.9 spec vs code (appended addendum)

---

## 1. The three consoles, the five roles, navigation

### 1.1 Entry, routing and shells

- One sign-in at `/login` (`src/app/(auth)/login/page.tsx`). Where the user lands is decided by grants, not by the link:
  `consoleFor()` in `src/lib/ui/session.tsx:44-54` — any `PLATFORM` grant → `/admin`; any `FACILITY` grant → `/facility`;
  no grants at all → `/facility` (so a staff account nobody has added yet sees the "not attached" notice); otherwise `/practitioner`.
- All three consoles use one shell, `src/components/app/console-shell.tsx`: fixed 256px sidebar from `lg` (`:213`), off-canvas drawer
  below `lg` (`:225-246`), 56px top bar (`:250`) holding a theme toggle (`:265`) and a user menu with "Send a suggestion" (only if
  the user holds `suggestion.submit`, `:284`) and "Sign out". No notification bell, no inbox, no help link, no language switch.
- Nav is built from **permissions** (`item.permission`, filtered with `session.permissions.includes`, shell `~:100-110`). The permission
  list is flat and **scope-blind** (`src/modules/auth/application/session-state.ts:34-43` dedupes permissions across scopes).
- No `middleware.ts`/`proxy.ts` exists in `src/`. Each console's `layout.tsx` calls `sessionState()` server-side but passes `null`
  through if signed out (`src/app/practitioner/layout.tsx:13-16`, same in facility/admin); the **client** `SessionProvider` redirects a 401
  to `/login` (`src/lib/ui/session.tsx:120-125`). Page HTML for `/admin` is served to anyone; the API is the control (e2e confirms the
  API answers 403, `tests/e2e/auth.spec.ts:107-115`).
- Active nav item = exact path match (`console-shell.tsx:179`), so a nested route (`/facility/shifts/[id]`) highlights nothing.
- `ScreenTransition`/motion honours `prefers-reduced-motion` (`src/components/app/motion.tsx`, `useReducedMotion`).

### 1.2 The five roles (`src/lib/authz/permissions.ts:185-220`)

| Role | Console | Permissions held (code) | Notes |
|---|---|---|---|
| `practitioner` (`:116-122`) | `/practitioner` | availability.read/write; practitioner.profile.read/write; credential.submit; credential.document.read; service_request.read; attendance.record; timesheet.submit; invoice.read; payout.account.change; dispute.manage; suggestion.submit | All at `SELF` scope. |
| `facility_administrator` (`:140-147`) | `/facility` | availability.read; facility.read/write; facility.user.manage; service_request.read/publish; assignment.confirm/cancel; attendance.record; timesheet.approve; invoice.read; **payout.manage**; incident.report; suggestion.submit | Merge of the retired scheduler + finance officer + administrator (`:234-235`). Cannot add staff (no `role.grant`). |
| `facility_owner` (`:199`) | `/facility` | facility_administrator + `role.grant` + `dispute.manage` | `role.grant` is step-up gated (`:77-83`). `dispute.manage` has **no facility screen**. |
| `administrator` (`:172-183`) | `/admin` | user.read/suspend; role.grant; practitioner.profile.read; credential.review/document.read; facility.read/write/verify; availability.read; service_request.read; assignment.confirm/cancel; invoice.read; payout.manage; dispute.manage; sanction.apply; incident.manage; audit.read; suggestion.submit/triage (21 keys) | Merge of retired operations/compliance/finance officers (`:231-233`). No `config.manage`. |
| `super_administrator` (`:219`) | `/admin` | all keys, incl. `config.manage` | Only difference from `administrator` is `config.manage` (and therefore the "Terms and notices" page, `src/app/admin/console-layout.tsx:121`). |

Role → pages seen (derived from nav permission keys):
- practitioner: all 6 nav items.
- facility_administrator: Dashboard, Shifts, Roster, Timesheets, Invoices, Rates and allowances, Report an incident (not Staff).
- facility_owner: the above + Staff.
- administrator: every admin item except "Terms and notices".
- super_administrator: every admin item.
- Because nav filtering is scope-blind, a practitioner who types `/admin` would be shown nav entries gated by keys they hold at SELF
  (`dispute.manage` → "Disputes", `invoice.read` → "Finance Overview"); the API then refuses. (GAP, see section 9, G7.)

### 1.3 Practitioner console — `/practitioner` (`src/app/practitioner/`)

Nav (`console-layout.tsx:27-70`): **Today** — Overview (no permission), Offers (`service_request.read`), My shifts (`service_request.read`);
**Getting paid** — Timesheets (`timesheet.submit`), Earnings (`invoice.read`); **Your account** — My profile (`practitioner.profile.read`).

| Route | Purpose / main actions |
|---|---|
| `/practitioner` (`page.tsx`) | Dashboard, one request (`/api/v1/dashboard/practitioner`). Setup card (DRAFT/READY/WAITING), "returned" notice (CHANGES_NEEDED), eligibility card listing every blocker split "Yours to do" (links) / "Waiting on Medilink" (`:218-262`), tiles "Offers waiting" and "Next shift". |
| `/practitioner/offers` | Open invitations (profession, facility name, urgency, shift type, start/end, hourly rate, answer-by). Accept; Decline (reason required, enforced client-side `offers/page.tsx:196`; reason goes to suggestion log without name). Banner says accepting is not being confirmed. Answered history (10 recent, "show all"). Lapsed offers shown as such. |
| `/practitioner/shifts` | Tabs Confirmed / Completed / No show / Cancelled. Per shift: end, facility, type, rate; **CheckInPanel** (6-digit code from the ward, opens 3 h before start, `check-in-panel.tsx:33`, check in then check out); **ExcusalPanel** for a shift that ended with no check-in (explanation ≥10 chars, status + officer reply). |
| `/practitioner/timesheets` | Per shift: worked/break/billable/amount-at-base-rate, night/overtime/holiday minutes, revisions. Submit; "Dispute this" on APPROVED/REJECTED (category + reason ≥20 chars, `timesheets/page.tsx:80,269-290`). |
| `/practitioner/earnings` | Owed (ledger balance) / on its way / paid; list of payouts with status and reference. No per-shift earnings breakdown. |
| `/practitioner/profile` (`?tab=`) | While setup is needed: **4-step wizard** (`setup-wizard.tsx`): Your details → When you can work → Your documents → Review and submit. Afterwards four tabs: **Profile** (photo upload, profession, specialty, years, state, LGA, travel preference, bio), **Credentials** (submit by type; NIN needs 11 digits + photo of slip, licence needs number + photo, certificates need document; resubmit when queried; status + reviewer note), **Availability** (weekly slot add/remove; time-away blocks add — no remove), **Privacy** (consents with withdraw, agreement acceptance, data export download, erasure assessment/request, my data requests). |
| `/practitioner/availability`, `/credentials`, `/privacy` | Server redirects into the matching profile tab (`availability/page.tsx:3-5` etc.). |

### 1.4 Facility console — `/facility` (`src/app/facility/`)

Nav (`console-layout.tsx:30-86`): **Overview** — Dashboard; **Staffing** — Shifts (`service_request.read`), Roster (`attendance.record`);
**After the shift** — Timesheets (`timesheet.approve`), Invoices (`invoice.read`), Rates and allowances (`facility.write`), Report an incident
(`incident.report`); **Your facility** — Staff (`role.grant`). Guard (`:103-125`): no FACILITY-scoped grant → "not attached" notice
with a "Register a facility" button. A `FacilitySwitcher` ("Acting for") shows only with ≥2 facilities, choice kept in `localStorage`
(`src/lib/ui/facility.ts:~50-77`).

| Route | Purpose / main actions |
|---|---|
| `/facility` | Dashboard (`/api/v1/dashboard/facility`): status banner PENDING/REJECTED(with compliance note)/SUSPENDED (`page.tsx:159-185`), outstanding terms to read-and-accept (`facility-agreements.tsx`), tiles Shifts published / Confirmed on roster / Timesheets to approve, charts staffing-vs-need by week and invoiced-vs-paid by month. |
| `/facility/register` | Hospital self-registration (name, type, CAC number, state, LGA, address, phone, email, **licence number text only**). Created PENDING; owner granted `facility_owner` immediately. Outside the guard so it works before a grant exists. Not in the nav. |
| `/facility/shifts` | Table with tabs Published/Filled/Draft/Cancelled/Expired, filters (profession, search, date range), cursor paging (20). **Publish a shift** dialog (create DRAFT then publish): profession, specialty, start/end, day/night, urgency, headcount, hourly rate (naira; **pre-filled 5000**, `new-shift-dialog.tsx:55`), cancellation terms, notes. Publish a stuck DRAFT; Cancel with reason. Button visibility keyed to `service_request.publish` only — not to facility verification. |
| `/facility/shifts/[id]` | **Find candidates** (match run): ranked list with 4 factor bars + detail text (`:368-386`, detail clipped `w-28 truncate` at `:381`), select several and **Offer**; "Offered" list auto-refreshes every 15 s while any offer is open (`:151`); **Confirm** accepted offers; "Confirmed" list shows name **and phone** (`:262-264`); "N excluded, and why" disclosure. The match payload carries `practitionerPhone` for ranked and excluded rows (`:52,59`), though only names are rendered there. |
| `/facility/roster` | Tabs Confirmed/Completed/No show/Cancelled, search by name/phone, date range, paging. On Confirmed: **AttendancePanel** — "Code to check in/out" (6-digit code shown once in a dialog, 5 min, 5 attempts) and "Record by hand" (times, break, reason ≥10 chars → MANUALLY_CORRECTED). Phone shown permanently (`roster/page.tsx:245`). |
| `/facility/timesheets` | Tabs "awaiting decision" (CONFIRMED) / "approved" (COMPLETED), practitioner and date filters, 50 per page. Approve; Reject (reason ≥10 chars); Correct the hours (break/on-call/in/out + reason → revision kept). Amounts are base-rate; premiums apply at invoicing (said on the card). |
| `/facility/invoices` | Issued (non-draft) invoices, shift-by-shift lines, Outstanding/Paid totals from server. Read-only; no pay or dispute control. |
| `/facility/rates` | Rate cards (night/holiday/overtime/on-call multipliers); New rate card, Edit active. |
| `/facility/incidents` | List with status/severity/category filters; **Report an incident** dialog (naming a practitioner is optional; a chosen shift names the practitioner on it); detail dialog shows outcome once closed; cannot be edited. |
| `/facility/staff` | `StaffManager` (`src/components/app/staff-manager.tsx`): find a colleague by phone, grant `facility_administrator` or `facility_owner`, revoke with reason; every call behind a re-typed password (step-up). |

### 1.5 Operations console — `/admin` (`src/app/admin/`)

Nav (`console-layout.tsx:33-123`), permission in brackets:
**Overview** Dashboard · **Onboarding** Practitioners (`credential.review`), Credentials (`credential.review`), Facilities (`facility.verify`) ·
**Casework** Clinical incidents (`incident.manage`), Disputes (`dispute.manage`), Unhonoured shifts (`sanction.apply`) ·
**Money** Overview (`invoice.read`), Invoices (`payout.manage`), Payouts (`payout.manage`) ·
**The pilot** Suggestions (`suggestion.triage`), Data requests (`audit.read`), Audit trail (`audit.read`) ·
**Platform** Staff (`role.grant`), Performance (`audit.read`), Terms and notices (`config.manage`).

| Route | Purpose / main actions |
|---|---|
| `/admin` | Tiles per queue with count + age of oldest item (credentials, facilities, incidents, disputes, unhonoured, suggestions), incident severity, worst incident, growth chart (facilities, practitioners, usage per month), recent audit activity; one request `/api/v1/dashboard/platform`. |
| `/admin/practitioners` | Queues "Waiting for approval" (submitted, longest first) / "Not submitted yet" / "Everyone"; search; detail (`?user=` deep link) with tabs **Identity and registration** (eligibility blockers in officer language, record identity [NIN last-4 + name match], record registration [regulator, folio, status, expiry]) and **Credentials**; **EvidenceReview** (read photo beside number then confirm identity/registration *from the submission* in one click, or ask for more); **StandingPanel** (clear a sanctions-screening flag with ≥20-char reason; view/lift suspension with ≥20-char reason). |
| `/admin/credentials` | Status tabs + search; open the document (signed URL); Approve / Reject (reason) / Ask for more information. NIN/licence items link to the practitioner page to be confirmed there. |
| `/admin/facilities` | Status tabs; detail with Details/History tabs (audit rows filtered to the facility); view licence document (if one exists); **Verify** / **Reject** with notes. **No create-facility screen.** |
| `/admin/incidents` | Queue, most serious first; Begin review; Close with an outcome (SYSTEM_ISSUE first; PRACTITIONER_SUSPENDED suspends). |
| `/admin/disputes` | Queue; Begin review; Resolve upheld/dismissed (outcome + notes both required); evidence tab is **view-only**. |
| `/admin/unhonoured` | Shifts nobody attended: record fault (practitioner/facility/neither, each option states its consequence); decide excusal requests. |
| `/admin/finance`, `/admin/invoices`, `/admin/payouts` | Finance overview (two charts + invoice table); generate invoice for facility+period, issue, record payment (no gateway); find practitioner, prepare payout, release (stub reference `stub-…`, banner says no provider configured, `payouts/page.tsx:105-111`). |
| `/admin/suggestions`, `/admin/data-requests`, `/admin/audit` | Triage (response required for DONE/DECLINED); start/close data-subject requests; read-only audit trail (no filter by actor, by design `audit/page.tsx:68`). |
| `/admin/staff`, `/admin/performance`, `/admin/agreements` | Appoint/remove platform staff (step-up); route-timing report since server start; publish a new version of a terms/notice document (super administrator only). |

Detail views (disputes, incidents, facilities, unhonoured, suggestions, data requests) are **component state**, not routes
(`src/app/admin/disputes/page.tsx:49,80-83`); only `/admin/practitioners` deep-links (`?user=`).

---

## 2. End-to-end journeys as the UI supports them (NO SCREEN = marked)

### 2.1 Practitioner
1. **Register** — `/register` three steps: details (name, phone, optional email) → 6-digit OTP (resend, change number) → password (≥10, typed twice) + required consent tickbox "show my verified credentials and profile to hospitals" (`register/page.tsx:413-435`); then auto-login, waits up to 8 s for the baseline grant from the outbox worker (`:170`). **OTP delivery**: only the console adapter works (local only); `termii` and `africastalking` throw `SmsNotConfiguredError` (`src/lib/sms/index.ts:105-108`).
2. **Onboarding wizard** — details → availability → documents → review (`setup-wizard.tsx`). Required documents come from reference data; seeded requirements exist **for doctors only** (`prisma/seed.ts:127-150`), so for nurse/pharmacist/lab/radiographer the wizard says "No documents are required for your profession right now" (`setup-wizard.tsx:399-401`).
3. **Submit for approval** — `POST /practitioners/me/submit` (`ReviewStep`); button disabled until all three steps done. States: DRAFT → READY → WAITING → APPROVED, or CHANGES_NEEDED when a required document is rejected (`src/lib/ui/practitioner.ts`). Officer side: `/admin/practitioners` "Waiting for approval" → EvidenceReview/credentials. "Approved" shows once eligible; the stored status moves to ACTIVE on the **hourly activation sweep** (`docs/testing-by-role.md:134-153`), with no screen for the practitioner to see the difference.
4. **Availability** — Profile → Availability: weekly recurring slots (add/remove) and time-away blocks (add). **NO SCREEN**: remove a block (route `DELETE /availability/blocks/:id` has no UI caller); create a one-off slot (UI only posts `RECURRING_WEEKLY`, `availability-section.tsx:94`); state a rate or ask price; publish availability to facilities.
5. **Offers** — `/practitioner/offers`. **NO NOTIFICATION** that an offer exists (only handler is "assignment confirmed", `src/worker/handlers.ts:20`). The offer card shows rate/hour, times, facility name, urgency — **not** location/address, ward notes, cancellation terms, premiums or total pay (`src/modules/matching/application/assignment.ts:793-802` selects none of them).
6. **Accept** — Accept ≠ confirmed (said on page and in toast). Decline needs a reason. **NO SCREEN**: browse open shifts, apply to a shift, counter on price (one-way marketplace).
7. **Shift** — appears under My shifts → Confirmed after the facility confirms. **NO SCREEN**: withdraw/cancel a confirmed shift (only the post-hoc excusal path; `assignments/:id/cancel` has no UI caller).
8. **Check-in/out** — code from the ward, 6 digits, from 3 h before start; QR payload can be pasted into the same field (`check-in-panel.tsx:24-26`); no camera/QR scanner in the app (no scanner library; `Permissions-Policy: camera=(self)` is set in `next.config.mjs` but nothing uses it). Offline: none.
9. **Timesheet** — worked out when checked out; practitioner submits; facility decides; reject → correct → resubmit; "Dispute this" after a decision.
10. **Earnings** — `/practitioner/earnings` (owed, in flight, paid, payout list). Credited at invoicing, not approval (said on page). **NO SCREEN**: payout bank account (no bank model), per-shift earnings statement, tax statement.

### 2.2 Facility
1. **Register** — `/register?as=facility` (same OTP flow, no practitioner consent box) → `/facility/register` form → account holds `facility_owner` immediately while the facility is PENDING.
2. **Verification** — dashboard banner "Waiting for verification"; officer verifies in `/admin/facilities`. **NO SCREEN**: upload a licence/CAC document (route `POST /facilities/:id/licence-upload-url` has no UI caller; the form takes a licence *number* only and the officer can only *view* a licence if one exists, `facility-detail.tsx:205`); edit facility details (`PATCH /facilities/:id` no UI caller); facility profile page; reply to a rejection (banner says "Reply to Medilink with the corrected documents", `facility/page.tsx:175`, but there is no reply/upload path and REJECTED is terminal per `docs/stage-5-10-facility-verification.md:117`).
3. **Staff/roles** — Staff page (owner only): grant `facility_administrator`/`facility_owner` to a colleague who has registered with `/register?as=staff`; terms accept on the dashboard.
4. **Publish request** — Shifts → "Publish a shift". Publishing gate (verified facility, licence not lapsed) is enforced server-side; the button is shown to an unverified facility, fails with a toast and leaves a DRAFT (`new-shift-dialog.tsx:72-100`). Shift type is chosen by hand, not derived. **NO SCREEN**: edit a published shift, clone/repeat a shift, rota/calendar, recurring templates.
5. **Matches/invites** — shift detail: Find candidates → factor bars → select → Offer; auto-refresh until answered; Confirm accepted offers (headcount fills, others withdrawn). **NO NOTIFICATION** to the practitioner.
6. **Roster** — Roster page. **NO SCREEN**: cancel/release a confirmed practitioner (`POST /assignments/:id/cancel` unused by any screen), mark no-show (sweep + admin decide).
7. **Attendance code** — Roster → "Code to check in/out" → read aloud (dialog, 5 min); "Record by hand" fallback.
8. **Approve timesheet** — Timesheets → approve/reject/correct.
9. **Invoices** — Invoices page (read-only, issued only). **NO SCREEN**: pay an invoice or raise funds (ops records payment, `admin/invoices/page.tsx:308-309` says there is no gateway); respond to a dispute (owner holds `dispute.manage`, no `/facility/disputes`); download/print invoice.
10. Also: incidents (report), rates (rate cards).

### 2.3 Operations
- **Verification queues**: `/admin/facilities` (verify/reject), `/admin/practitioners` (waiting for approval). **NO SCREEN**: create a facility on a facility's behalf (`POST /api/v1/facilities` has no UI; `docs/testing-by-role.md:281` still says "onboard a new one"), suspend a facility (no route), edit reference data/rate floors (`config.manage` has only the Terms page).
- **Credential review**: `/admin/credentials` (approve/reject/ask more; open document) and `/admin/practitioners` → Credentials tab.
- **Evidence confirmation**: `/admin/practitioners` → EvidenceReview (identity, registration), plus screening clearance and suspension lift.
- **Disputes**: `/admin/disputes` take → resolve. **NO SCREEN**: facility response; evidence upload by either party (`/disputes/:id/evidence/upload-url` unused); withdraw (`/disputes/:id/withdraw` unused); a facility cannot raise a dispute in the UI.
- **Incidents**: `/admin/incidents` review → close (suspension via closure). **NO SCREEN**: direct suspend; notify the facility of the suspension.
- **Finance**: `/admin/finance`, `/admin/invoices` (generate → issue → record payment), `/admin/payouts` (prepare → release; stub). **NO SCREEN**: bank accounts, credit notes/reversals, reconciliation, VAT/WHT.
- **Suggestions**: `/admin/suggestions` triage + response (author cannot read it).
- **Audit**: `/admin/audit` (read-only), `/admin/data-requests`.

---

## 3. Public pages: present vs missing

| Page | Status | Evidence |
|---|---|---|
| Landing `/` | Present | `src/app/page.tsx`; sections Workspaces / How it works / For facilities / For practitioners / Trust and safety; static, `metadata` at `:40`. |
| Sign in `/login` | Present | `(auth)/login/page.tsx` (contains developer text, see section 8). |
| Create account `/register` (`?as=facility`, `?as=staff`) | Present | `(auth)/register/page.tsx`. |
| Pricing | **Missing** | No route; no mention of price/free anywhere on the landing page. |
| Terms of use | **Missing as a public page** | Terms are shown only inside consoles (agreement dialogs: `practitioner/profile/privacy-section.tsx`, `facility/facility-agreements.tsx`) after sign-in. |
| Privacy notice | **Missing as a public page** | `/practitioner/privacy` is only a redirect to a signed-in tab (`practitioner/privacy/page.tsx`). |
| Contact / support | **Missing** | No phone, email, WhatsApp, address, FAQ anywhere in `src` (grep). Error strings say "Contact support." with no contact (`src/modules/auth/domain/errors.ts:52`). |
| Forgot / reset password | **Missing screen; API exists** | `src/app/api/v1/auth/password/reset-request/route.ts`, `reset-confirm/route.ts` have no UI caller; the lockout message says "reset your password" (`errors.ts:27`); register page admits "no way to reset a password from the interface" (`register/page.tsx:395`). |
| About, sitemap.xml, robots.txt, OG/social image | **Missing** | none under `src/app` (only `icon.svg`, `layout.tsx`, `page.tsx`, `not-found.tsx`, `error.tsx`, `global-error.tsx`). |
| 404 / error pages | Present | `not-found.tsx`, `error.tsx`, `global-error.tsx`. |
| Footer links | Only in-page anchors + Sign in + Create account | `page.tsx:451-470`. |
| Mobile menu on landing | **Missing** | anchor nav `hidden … lg:flex` (`:159`); header "Sign in" `hidden … sm:inline` (`:178`); on phones only the "Create account" button is in the header (hero repeats "Sign in"). |

---

## 4. Accessibility and readability facts

### 4.1 Type sizes
- Root font size is the browser default (16px): `src/app/globals.css` sets no `font-size`; `src/app/layout.tsx:21` body classes have no text size. `<html lang="en-NG">` (`layout.tsx:20`).
- Content is overwhelmingly `text-sm` (14px): **291 occurrences on 290 lines in 73 `.tsx` files** (245 lines in `src/app`, 44 in `src/components`). Primitives set 14px: Button (`button.tsx:20`), Label (`label.tsx:9`), Table (`table.tsx:12`), Tabs (`tabs.tsx:31`), Alert (`alert.tsx:6,40`), Select (`select.tsx:19`), Textarea (`textarea.tsx:8`), CardDescription (`card.tsx:50`), PageHeader description (`page-shell.tsx:20`), `Detail` value (`page-shell.tsx:100`).
- `text-xs` (12px): **272 lines in 72 files** (248 in `src/app`, 24 in `src/components`); **206 of those lines also carry `text-muted-foreground`**. Small Button is `text-xs` (`button.tsx:36`), Badge is `text-xs` (`badge.tsx:6`), `Detail` labels are `text-xs uppercase` (`page-shell.tsx:99`).
- `text-[0.7rem]` (11.2px): 10 uses in 6 files (nav section headings `console-shell.tsx:174,215`; auth pages' "Medilink" eyebrow; admin practitioners/facilities/dispute chips).
- `text-base` (16px) is used on 13 lines; Input is 16px below 768px and 14px from `md:` up (`input.tsx:11`).
- Money prints with `.00` on whole amounts (`src/components/app/format.ts` `minimumFractionDigits: 2`).

### 4.2 Control sizes and focus
- Button: default `h-9` = 36px (`button.tsx:35`), `sm` `h-8` = 32px (`:36`), `lg` `h-10` = 40px (`:37`), `icon` 36×36 (`:38`). Input, Select trigger, Tabs list: 36px (`input.tsx:11`, `select.tsx:19`, `tabs.tsx:16`). Sidebar link = 36px (`py-2` + 20px line). Textarea min 72px.
- Focus ring: Button and Input `ring-1` (1px, no offset) (`button.tsx:20`, `input.tsx:11`); Select trigger `focus:ring-2` (`select.tsx:20`); Tabs trigger and Textarea `ring-2` (`tabs.tsx:32`, `textarea.tsx:9`); Badge/admin queue cards `ring-2 ring-offset-2`. Ring colour is `hsl(184 82% 30%)` (4.35:1 on the page background).

### 4.3 Whole-product facilities
| Facility | Present? | Evidence |
|---|---|---|
| Larger-text / font-scale switch | **No** | grep for `larger text|font-scale|text-size` finds nothing. |
| Projector / presentation mode | **No** | none. |
| Dark mode | Manual toggle only, console only | `console-shell.tsx:136-146,160-166` (reads `localStorage` in `useEffect`, so first paint is light; `prefers-color-scheme` never consulted). Public pages are light only. |
| Reduced motion | Yes | `motion.tsx` honours `useReducedMotion`. |
| Skip-to-content link | **No** | none; `<main>` has no id (`console-shell.tsx:311`). |
| Mobile nav | Yes (console) | off-canvas drawer, `role="dialog" aria-modal`, Escape closes (`:148-156,225-246`); **no focus trap / focus return / scroll lock**. Landing page has none (section 3). |
| Alerts announced | Every `Alert` is `role="alert"` (`alert.tsx:25`), including static info banners; field errors in register/step-up also `role="alert"`. |
| Image alt text | Hero has descriptive alt (`page.tsx:193`); avatars/photos use alt or empty alt. |
| i18n / Hausa | **None** | no i18n library in `package.json`; strings inline in ~all `.tsx`; `lang="en-NG"` only; Hausa appears only in a demo bio (`scripts/seed-demo.ts`). Formatting is `en-NG`/Africa/Lagos (`format.ts`). |
| PWA manifest | Present but **icons empty** | `public/manifest.webmanifest:9` `"icons": []`; `display: standalone`, `theme_color #01696f`, `background_color #f7f6f2`. Only a 32×32 SVG favicon via Next convention (`src/app/icon.svg`). No 192/512 PNG, no apple-touch icon. |
| Service worker / offline | **None** | no `serviceWorker`, workbox, next-pwa, `navigator.onLine`, IndexedDB anywhere in `src`/`public`/`next.config.mjs`. Nearest thing: "Could not reach Medilink — try again" screen when the session request fails (`src/lib/ui/session.tsx:127-137`). `docs/interfaces.md:140-141` lists offline capture as not built. |
| Notification bell / inbox | **None** | header has theme toggle + user menu only (`console-shell.tsx:264-295`); no notifications API route. |

### 4.4 Other small facts
- `Detail` (record-detail primitive) is `truncate` (`page-shell.tsx:100`) and is used **86 times in 18 files** (all queue detail panels, offers, shifts, timesheets). 28 other `truncate` uses in `src/app`.
- Heading structure: each page has one `<h1>` (`PageHeader`); cards use `CardTitle` (div-based `text-sm`).
- Providers (React Query, framer-motion `LazyMotion`, Sonner `Toaster`) wrap **every** page including the public landing (`layout.tsx:22`, `src/lib/ui/providers.tsx`). Charts are `dynamic`-imported (`facility/page.tsx:27-34`).
- Unused shadcn components still shipped: `sidebar.tsx`, `sheet.tsx`, `breadcrumb.tsx`, `tooltip.tsx` (0 imports); `use-mobile` hook has 1 import.

### 4.5 Contrast (computed from `src/app/globals.css` tokens; alpha tints blended over card white/dark card; WCAG relative luminance)
| Pair | Light | Dark |
|---|---|---|
| `muted-foreground` on background / on card / on `muted` | 4.57 / 4.76 / **4.19** | 7.02 / 6.50 / 5.36 |
| Input border (`--input`) vs background | **1.31:1** | 1.58:1 |
| Card/sidebar border vs background | 1.25:1 | 1.46:1 |
| Badge **warning** text on its 15% tint (PENDING, NEW, OPEN, SUBMITTED, UNDER_REVIEW, AWAITING_DECISION, REQUESTED, REPORTED all map to `warning`, `status-badge.tsx:38-59`) | **3.01:1** (3.57 on plain card) | 5.27 |
| Badge success text on tint | 4.37 | 5.05 |
| Badge destructive text on tint | 4.86 | **3.42** |
| Badge info / default | 4.92 / 6.25 | 4.52 / 6.22 |
| Solid button text: primary / destructive / success / info | 7.30 / 5.70 / 4.98 / 5.67 | 7.96 / **4.00** / 6.31 / 5.59 |
| `warning` fill with white text (not a Button variant) | 3.57 | — |
Script: `scratchpad/contrast.py`. Landing white-opacity text on the dark hero/footer solid colours is 6.3–8.8:1 (image scrim not measured).

---

## 5. Quality: tests and CI

### 5.1 Counts (regex over `it(`/`test(` declarations; `it.each` expands further)
| Layer | Files | `it`/`test` declarations | Notes |
|---|---|---|---|
| Unit (`vitest.config.mts`: jsdom, `src/**/*.test.ts(x)`) | **40** | **473** (+9 `it.each` blocks) | All domain/lib pure-function tests plus `src/components/app/format.test.ts` and `src/lib/ui/api.test.ts`. **No component/UI test files**, although `@testing-library/react` is a dev dependency and `tests/setup.ts` loads `jest-dom`. No axe/a11y tests anywhere. |
| Integration (`vitest.integration.config.mts`: real Postgres `medilink_test`, serial) | **31** (+ `support/`) | **534** (+1 `it.each`) | Per-module suites, audit coverage, outbox recovery, authorization, dashboard summaries. Largest: assignments 36, credential-verification 28, facility-verification 28, disputes 26, consent 24. |
| E2E (Playwright, `playwright.config.ts`) | **10** spec files | **44** declarations (~56 at runtime with loops: 3 sign-ins, 12 mobile page-fits) | One worker, serial; project `journeys` (Desktop Chrome) then `mobile` (Pixel 5, only `mobile.spec.ts`, `:41-53`). |
| Total declarations | | **1,051** | The redesign doc states "about 1,050 by grep" in §5 and "about 1,500" in §1; `docs/testing-by-role.md:328-329` still says 525 unit / 431 integration. |
Also: `scripts/e2e.py` — 45 HTTP-level checks (`check(` calls; `docs/end-to-end.md:30`), not in CI.

### 5.2 CI (`.github/workflows/ci.yml`, the only workflow)
Triggers: push to `main`/`develop`, every PR; concurrency cancels superseded runs. Env: Node 22, pnpm 9.
1. **quality** — `prisma generate`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (`:24-40`).
2. **migrations** — Postgres 16: `migrate deploy`; `migrate reset --skip-seed` then `deploy` (down/up/up); `pnpm db:seed` (`:42-74`). (The step name says "assert row counts"; the seed prints counts, it does not assert.)
3. **integration** — needs quality; `pnpm test:integration` (`:76-107`).
4. **security** — `pnpm audit --audit-level high`; gitleaks (`:109-130`).
5. **e2e** — needs quality; Postgres + MinIO started by hand, `migrate deploy` + `db:seed`, Playwright Chromium, `pnpm build`, `pnpm start` + `pnpm worker` in background, `pnpm test:e2e`; uploads report/logs on failure (`:131-185`); `retries: 1` on CI (`playwright.config.ts:25`).
Not in CI: `scripts/page-budget.mjs` (Slow-4G budget, manual), `scripts/load-test.ts`, `scripts/backup-drill.sh`, `e2e.py`, coverage thresholds, accessibility checks, image build/deploy (no deploy job), dependabot/PR template.

### 5.3 What the e2e journeys cover (`tests/e2e/*.spec.ts`)
| Spec | Declarations | Journey |
|---|---|---|
| `auth` | 6 | Practitioner 3-step signup with real OTP read from the console-SMS outbox, lands in `/practitioner`; wrong OTP; admin/scheduler/practitioner sign in to the right console; wrong password; signed-out `/admin` → `/login`; practitioner refused by API (403). |
| `onboarding` | 12 | Profile built; wizard resume; review step; old URLs → tabs; NIN with photo + malformed NIN refused; licence with photo; document upload to storage; duplicate type blocked; **submit for approval**; officer finds it under "waiting"; officer confirms NIN/licence from evidence and asks for more; practitioner reads the note. |
| `staffing` | 4 | Scheduler publishes a shift → ranks → offers → nurse accepts → scheduler confirms → nurse sees booking. |
| `attendance` | 3 | Ward issues code; nurse checks in; wrong code refused; check-out. |
| `after-the-shift` | 5 | Manual record, nurse submits, facility rejects-needs-reason then approves, nurse disputes, admin takes and decides. |
| `money` | 5 | Admin invoices + issues; hospital sees what it owes; payment recorded; nurse sees owed; finance pays; earnings say so. |
| `oversight` | 3 | Admin verifies a waiting facility; ward reports an incident; admin closes with finding. |
| `multisite` | 2 | Facility switcher with two hospitals / none with one. |
| `mobile` | 3 (13 runtime) | `/`, `/login`, `/register` and 9 practitioner pages fit a Pixel 5 (no sideways scroll) + drawer opens. |
| `health` | 1 | `/api/v1/health`. |
**Not covered by any e2e**: facility self-registration form, `/facility/register`, facility staff page, rates, unhonoured/excusal, suggestions, data requests, audit, agreements, performance, practitioner privacy tab actions, availability form entry, any facility/admin page at phone width, any keyboard/a11y behaviour.

---

## 6. Docs inventory and staleness (HEAD code is truth)

README (`README.md:4`) says "Companion documents: **System Documentation v2.9** and **Implementation Plan v1.2**". **Neither is in the repo**:
`find /` for `*System*Documentation*` / `*Implementation*Plan*` returns nothing; `git log --all` shows no such path; the only references are
`README.md:4`, `docs/CONTRIBUTING.md:3` ("Implementation Plan §2.1"), `docs/adr/0004-prisma-data-access.md:7`, `docs/scheduled-jobs.md:14`
("Implementation Plan §2.9"), `tests/integration/outbox.test.ts:10`, `tests/integration/audit-coverage.test.ts:54`.
(Code also cites "Section 8.8", "step 4.5", "step 9.4" etc. of those documents.) **CONFIRMED absent.** The v2.9 text was supplied separately for this study (section 10).

Dates are last-commit dates (`git log -1`); most files were committed in 2026-09 batches and the 10-13 batch touched several.

| File | Date | State vs code |
|---|---|---|
| `README.md` | 10-04 | Mostly current; names two absent companion docs; says "eighteen modules" (module-map lists 18; folders = 19 incl. `config`). Quick-start lists `seed-demo.ts` correctly. |
| `docs/interfaces.md` | 10-13 | **Partly stale.** Roles table (`:7-11`) uses pre-merge wording ("operations and compliance officers", "schedulers and ward managers"). "What is not wired up" (`:125-141`) is wrong on three of five: credential-document upload exists (`src/components/app/document-upload.tsx`, used by `profile/evidence-fields.tsx`; e2e uploads), earnings/facility-invoices pages exist (`practitioner/earnings`, `facility/invoices`), facility switching exists (`facility/facility-switcher.tsx`). Still true: gateway stub, offline. `:3` "75 API routes" (now 110 `route.ts`). `:156` "thirty-nine practitioners" (seed now 40). |
| `docs/end-to-end.md` | 10-04 | Stale in places: `:66-70` "fifty-three accounts across four platform roles, four facility roles and ten named practitioners" (now 5 roles, 55 accounts, 11 named); spec table (`:176-186`) lists 9 files, repo has 10 (`health.spec.ts` missing) and `onboarding.spec` now covers submit-for-approval + evidence confirmation; "45 checks" still correct. |
| `docs/testing-by-role.md` | 10-13 | **Internally inconsistent.** `:165-172` says the facility roles merged, yet `:214-218` (Chinedu "deliberately narrow… no Publish… that is a bug") still describes the old role (seed gives Chinedu `facility_administrator`, `scripts/seed-demo.ts:2992-2993`). `:281` "Facilities — onboard a new one" has no screen. `:328-329` test counts (525/431) are stale (473+9 / 534+1). `:124-157` onboarding walk omits the new "submit for approval" step. SMS notes (`:74-78`) are correct. |
| `docs/demo-walkthrough.md` | 10-13 | Account labels (`:34-50`) use retired role names (operations/compliance/finance, scheduler, accounts officer); `:150-152` "administrator… how much less of the console exists" is wrong now; `:196-199` "Screening flags have no console yet… the one queue with no surface" **is false** — `admin/practitioners/standing-panel.tsx` clears flags; counts (`:79-91`) say 39 practitioners (code: 40, 11 named). |
| `docs/operations-console.md` | 10-04 | **Largely stale.** `:3` "first interface… seventy-five endpoints"; `:24-27` "Not covered: the practitioner and facility journeys… a facility still cannot publish one from a browser" is false (both consoles exist); page table (`:12-21`) lists 7 pages, console has 16; `:59` cites `src/components/ui/primitives.tsx` which **does not exist**; compliance-officer bundle story refers to a retired role. |
| `docs/running-a-demo.md` | 10-13 | Current (dashboard endpoints, `scripts/demo.ps1`). |
| `docs/database-refresh-2026-10-07.md` | 10-13 | Current as a dated note (baseline `20261007000000_baseline` + `…010000_query_indexes`; `prisma/migrations` also now has `20261012*`, `20261013*`). Contains a local Windows backup path (`:14`). Says "five current roles" ✓. |
| `docs/CONTRIBUTING.md` | 09-10 | Technically fine; cites absent Implementation Plan §2.1. |
| `docs/redesign-recommendations-2026-10-13.md` | 10-13 | Dated recommendation; verified in section 8; says its own counts disagree (1,500 vs 1,050). |
| `docs/module-map.md` | 09-14 | Current numbering (repo numbering, differs from v2.9 for 10–16; see 10.14). Status column outdated ("Create, verify, licence" for facilities; scheduling "list lives in matching"). |
| `docs/verification-providers.md` | 10-13 | New; matches `src/lib/verification/index.ts` (`none|sandbox|live`). |
| `docs/scheduled-jobs.md` | 09-12 | Current job keys match `src/worker/jobs.ts` (6 keys); cites absent Plan §2.9. |
| `docs/stage-3-gate-checklist.md` | 09-14 | All gate rows "Not started" incl. NDPC registration (3.4), legal opinion (3.2), agreement template (3.8). |
| `docs/stage-4-2-auth.md` | 09-08 | `:92` "no route requires [step-up] yet" **stale** — `guarded-handler.ts:102` enforces it (`role.grant`, `payout.account.change`). |
| `docs/stage-4-3-4-4-authorization.md`, `stage-4-5-audit-coverage.md`, `stage-4-6-outbox-recovery.md`, `stage-4-8-step-up.md` | 09-07/08/13 | Not individually re-verified. |
| `docs/stage-5-1-practitioner-profiles.md` | 10-13 | `:140-145` "no route lets [officers] read another profile… credentials not built yet" **stale** (`/api/v1/practitioners` list + credentials module exist). |
| `docs/stage-5-10-facility-verification.md` | 09-10 | **Stale** `:23,:104` "no self-service facility signup" (exists), `:55,:105` "scheduled-job mechanism does not exist" (it does: `src/worker/scheduler.ts`), `:102` staff management "not built" (built). `:117` REJECTED terminal — still true. |
| `docs/stage-5-2…`, `5-3/5-4/5-5…`, `5-6…`, `5-8/5-9…` | 09-10 | `5-8/5-9:131` "Stage 6 matching, not built yet" stale. `5-6:67` no compliance tool for the sanctions list — still true. |
| `docs/stage-5-clinical-incidents.md`, `stage-6-*.md`, `stage-7-*.md`, `stage-9-5-suggestion-log.md` | 09-10…13 | Not individually re-verified. |
| `docs/stage-8-disputes.md` | 09-13 | `:142-147` "Modules 11 and 12 do not exist… when billing lands" **stale** (billing exists). |
| `docs/adr/0001-0004` | 09-07 | Decisions; ADR 0003 (Flutter) accepted, no Flutter code exists. ADR 0004 cites absent Plan. |

---

## 7. `scripts/seed-demo.ts` — what it builds (3,013 lines; local only)

- **Refuses to run unless `APP_ENV=local`**; re-runnable (clears its own tagged work first); everything goes through application-layer functions (not raw inserts) except dates (`scripts/seed-demo.ts:1-41`). History window `HISTORY_DAYS = 112` = **16 weeks** (`:173`). Shared password printed on the login sheet (not reproduced here).
- **Facilities: 5** (`:1805-1860`): Aso Garden Specialist Hospital (Abuja, flagship, uses matching, verified), Adeola Memorial (Ikeja, Lagos, verified), Dala Road General (Dala, Kano, verified), Crystal Diagnostics & Imaging Centre (Port Harcourt, **pending**), Goodlife Clinic (Enugu, **rejected** with reasons). **No Gombe record exists in the seed** (Gombe appears only in the state/LGA reference data, `prisma/data/nigeria.ts`).
- **Practitioners: 40** (11 named + 29 pool): 21 doctors, 12 nurses, 3 pharmacists, 2 lab scientists, 2 radiographers; states FCT 27, Lagos 4, Kano 4, Nasarawa 3, Niger 2 (counted from the `PRACTITIONERS` array, `:401-~500`). Named states: cleared doctor mid-shift, cleared ICU nurse, awaiting review, queried document, no profile, sanctions-flagged, suspended (sign-in refused), lapsed licence, NIN name mismatch, expired NMCN, **changes needed** (an 11th named account not described in the docs).
- **Platform accounts: 5** (`scripts/seed-demo.ts:371-388`): 1 + 1 spare `super_administrator`, 3 `administrator` (the docs still call them operations/compliance/finance). **Facility accounts: 10** — flagship: owner + 3 `facility_administrator` (docs call them administrator/scheduler/accounts officer); Lagos: owner + scheduler; Kano: owner + scheduler; pending and rejected facility: one owner each. Total accounts = 5 + 10 + 40 = **55** (derived from code; the seed was not run).
- **Roles represented**: all five roles in `ROLE_PERMISSIONS`; roles are given by `grantRole` through the same code the console uses.
- **History per its own docs** (`docs/demo-walkthrough.md:79-91`, not re-counted): 245 filled shifts + expired/cancelled/draft/published; offers accepted/declined/withdrawn; ~228 completed assignments; invoices in every state; payouts settled/prepared; 6 disputes (every status); 7 incidents (one suspension, one lifted); 6 unhonoured shifts, 2 excusals; 5 data-subject requests; ~24,500 audit rows; two rate cards (one superseded in July); two published agreement versions (`:704-707`); fictional sanctions list (2 entries).
- Related scripts: `bootstrap-demo.ts` (3 accounts for `e2e.py`, phones `+23480311000xx`), `e2e-world.ts` (Playwright world, tagged `e2e.medilink.test`/`RC99`), `seed-performance.ts`, `load-test.ts`, `reset-to-superadmin.ts`, `page-budget.mjs`, `backup-drill.sh`, `simulate.py`, `smoke-auth.ps1`, `demo.ps1`.

---

## 8. Verification of the redesign-doc claims (at HEAD)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Body text 14px; ~270 `text-xs` | **PARTLY**: root/body is 16px; *content* is 14px via `text-sm`; the `text-xs` count is **CONFIRMED (272 lines/72 files)** | no root size set (`globals.css`, `layout.tsx:21`); `text-sm` 291×, `text-xs` 272 (206 also muted); §4.1 |
| 2 | Buttons 36px high | **CONFIRMED** | `button.tsx:35` (`h-9`); sm 32px `:36`; icon 36px `:38`; Input/Select/Tabs also 36px |
| 3 | Larger-text / projector mode absent | **CONFIRMED** | no such code; only a dark-mode toggle (`console-shell.tsx:265`) |
| 4 | Manifest has no icons | **CONFIRMED** | `public/manifest.webmanifest:9` `"icons": []` (only `src/app/icon.svg` favicon) |
| 5 | No forgot-password screen | **CONFIRMED** | API routes exist, no page/link; `register/page.tsx:395`; `errors.ts:27` |
| 6 | No pricing/terms/privacy/contact pages | **CONFIRMED** | section 3 |
| 7 | Developer text on login page naming seed script/doc | **CONFIRMED** | `(auth)/login/page.tsx:119-122` ("Locally, `seed-demo.ts` creates every demo account… See `docs/interfaces.md`") |
| 8 | No Hausa/i18n | **CONFIRMED** | no library, `lang="en-NG"` only (`layout.tsx:20`) |
| 9 | No service worker/offline | **CONFIRMED** | no SW/workbox/`navigator.onLine`/IndexedDB in `src`/`public` |
| 10 | Record-detail component truncates values | **CONFIRMED** | `page-shell.tsx:100` (`truncate`), 86 call sites |
| 11 | No skip-to-content link | **CONFIRMED** | none; `console-shell.tsx:311` `<main>` has no id |
| 12 | Practitioner cannot see/browse shifts or publish priced availability | **CONFIRMED** | nav = Offers (invited only) + My shifts (confirmed only); availability = weekly slots + blocks, no rate (`availability-section.tsx:40-100`); `ONE_OFF` kind unused in UI |
| 13 | Facility profile page missing; no licence upload screen | **CONFIRMED** | no `/facility/profile`; `PATCH /facilities/:id` and `licence-upload-url` have no UI caller (script diff of 110 routes vs UI strings); register form takes a licence number only (`facility/register/page.tsx:210-224`) |
| 14 | No inbox/notification bell | **CONFIRMED** | shell header (`console-shell.tsx:250-297`); no notifications route |
| — | Input border ~1.3:1 | **CONFIRMED** | 1.31:1 light (§4.5) |
| — | Status colours (pending/new/submitted/open) 3.0–3.3:1 | **CONFIRMED** | warning badge 3.01:1 (§4.5) |
| — | Focus rings 1px | **PARTLY** | 1px on Button/Input only; 2px on Select/Tabs/Textarea (§4.2) |
| — | 11px headings ×10 | **CONFIRMED** | `text-[0.7rem]` (11.2px) ×10 |
| — | New-shift rate pre-filled ₦5,000 | **CONFIRMED** | `facility/shifts/new-shift-dialog.tsx:55` |
| — | Static alerts announced on mount | **CONFIRMED** | `alert.tsx:25` always `role="alert"` |
| — | Dark-mode flash / ignores system setting | **CONFIRMED** | `console-shell.tsx:136-146` |
| — | Naira shown with `.00` | **CONFIRMED** | `format.ts` `minimumFractionDigits: 2` |
| — | Drawer lacks focus trap | **CONFIRMED** | `console-shell.tsx:225-246` |
| — | Heavy providers on the landing page | **CONFIRMED** | `layout.tsx:22` |

---

## 9. Gaps the redesign doc did not mention (all verified in code)

- **G1. Facility notes and cancellation terms never reach the practitioner.** The shift dialog collects "Notes for the practitioner — ward, who to report to, anything to bring" and "Cancellation terms — what a dispute turns on" (`new-shift-dialog.tsx:236-260`), but the invitation/assignment list queries return only facility name, category, shift type, rate, urgency, times (`src/modules/matching/application/assignment.ts:793-802`), and no practitioner screen renders notes/terms/address. (Doc mentions location/total pay/travel on offer cards, not notes or terms.)
- **G2. No screen for a facility or officer to cancel/release a confirmed assignment** (`POST /assignments/:id/cancel` has no UI caller); the seed does it through the application layer (`seed-demo.ts` `cancelAssignment`). Doc covers API cascade and practitioner withdrawal, not the missing facility/ops control.
- **G3. Availability UI is narrower than the API:** blocks can be added but not removed (`availability-section.tsx:276-297`, no delete button; `DELETE /availability/blocks/:id` unused); only `RECURRING_WEEKLY` slots can be created (`:94`) although the domain supports `ONE_OFF` (`src/modules/availability/domain/availability.ts:26`).
- **G4. Facility rejection banner instructs an impossible action** ("Reply to Medilink with the corrected documents", `facility/page.tsx:175`) — no reply or upload path exists (doc notes REJECTED is a dead end, not that the UI tells the user to do something it cannot do). Likewise **ops cannot create a facility from the console** although `docs/testing-by-role.md:281` tells testers to.
- **G5. Admin case views are not addressable.** Dispute/incident/facility/unhonoured/suggestion/data-request details are component state (`admin/disputes/page.tsx:49,80-83`); no URL to hand to a colleague, browser Back leaves the queue. Only `?user=` exists on `/admin/practitioners`.
- **G6. Nav highlighting is exact-match** (`console-shell.tsx:179`) and breadcrumbs exist as a component but are unused, so deep pages (`/facility/shifts/[id]`) show no "you are here".
- **G7. Console access is client-side only, and the menu is scope-blind.** No middleware; protected pages' HTML is served to anyone and redirected by script (`session.tsx:120-125`). Nav filtering uses a flat permission set (`session-state.ts:34-43`), so a practitioner opening `/admin` sees "Disputes" and "Finance Overview" entries (they hold `dispute.manage`, `invoice.read` at SELF). API remains the control (e2e checks only the API, `auth.spec.ts:107-115`).
- **G8. Unverified facility can open the Publish dialog** (shown on `service_request.publish` alone, `shifts/page.tsx:109,189`); failure arrives after a DRAFT is created (`new-shift-dialog.tsx:72-100`). No pre-check or disabled state.
- **G9. Admin Staff page copy promises "the reference lists and the minimum pay rates"** to super administrators (`admin/staff/page.tsx:26`) but no screen edits either (doc lists a config admin screen as P1 but not that UI text already promises it).
- **G10. Demo/pilot data mismatch:** the seed contains no Gombe facility or practitioner (Abuja/Lagos/Kano/Port Harcourt/Enugu; FCT/Nasarawa/Niger/Lagos/Kano) while the pilot and the meeting are in Gombe.
- **G11. No UI tests and no automated accessibility checks.** Zero component tests (RTL installed but unused), no axe, mobile e2e covers only the practitioner console + public pages; facility and operations consoles are never exercised at phone width. (Doc discusses readability, not test coverage of it.)
- **G12. Doc/test-count drift:** redesign §1 "about 1,500" vs §5 "about 1,050" vs HEAD 1,051 declarations vs `testing-by-role.md` 956 (525+431).
- **G13. Dead UI weight:** `sidebar.tsx` (large), `sheet.tsx`, `breadcrumb.tsx`, `tooltip.tsx` have zero imports.
- **G14. CI step mislabelled:** "seed and assert row counts" (`ci.yml:73`) only runs `db:seed`; and CI `migrations` runs seed after migrate, not "by migration alone" as its comment claims — matters for v2.9 §11.2 (section 10).

---

## 10. v2.9 spec vs code (addendum)

Source: `scratchpad/v29/v29.md` (v2.9 "Enhanced", dated September 2026; read as data). Status key: IMPLEMENTED / PARTLY / MISSING / DIVERGES. Spec line numbers refer to `v29.md`.

### 10.1 §6 Stakeholders and roles (spec `:175-186`; code `src/lib/authz/permissions.ts`)
| Spec role | Status | Evidence |
|---|---|---|
| Practitioner | IMPLEMENTED | `practitioner` bundle `:116-122`. |
| Facility Owner ("ultimate account holder, facility or group") | IMPLEMENTED | `facility_owner` = administrator + `role.grant` + `dispute.manage` (`:199`); multi-facility via grants + switcher. |
| Facility Administrator (profile, branches, departments, staff) | DIVERGES | `facility_administrator` is the whole facility operation (`:140-147`); **cannot** manage staff (no `role.grant`, `:199`); branches/departments not built (`docs/stage-5-10-facility-verification.md:14`); no profile-edit UI (section 2.2). |
| Facility Scheduler | DIVERGES (no such role) | retired → `facility_administrator` (`:234`). |
| Facility Finance Officer | DIVERGES (no such role) | retired → `facility_administrator` (`:235`); facility role holds `payout.manage` (`:145`); no funding/payment-approval screen. |
| Medilink Operations Officer | DIVERGES | merged into `administrator` (`:172-183`, `:231`). |
| Medilink Compliance Officer | DIVERGES | merged (`:232`); spec's "only a Compliance Officer may apply/vary/lift a sanction" (`v29.md:578`) now = any `administrator` (`sanction.apply`, `:180`). |
| Medilink Finance Officer | DIVERGES | merged (`:233`); same person can raise, mark paid, prepare and release (no maker-checker). |
| Super Administrator | IMPLEMENTED | `:219`; differs only by `config.manage` (`:203-218`). |
Net: spec 9 roles → code 5 (`ROLE_LABELS :239-260`); `RETIRED_ROLES :230-236` records the mapping.

### 10.2 §5 Core workflow (spec `:135-155`)
| Item | Status | Evidence |
|---|---|---|
| 1. Verified facility publishes request | IMPLEMENTED | `facility/shifts/new-shift-dialog.tsx`; gate on verified facility. |
| 2. Eligible practitioners identified and invited | IMPLEMENTED | `facility/shifts/[id]/page.tsx` match + invite; pure eligibility/matching engine. |
| 3. Practitioners "apply or accept"; facility reviews and confirms | PARTLY | accept + confirm exist; **apply is missing** (practitioner cannot browse or apply, section 2.1 #6). |
| 4. Attendance and hours recorded | IMPLEMENTED | code/QR-payload/manual fallback (`attendance-panel.tsx`, `check-in-panel.tsx`). |
| 5. Both practitioner and facility approve the timesheet | PARTLY | practitioner *submits*, facility approves/rejects/corrects; no practitioner approval step of the facility's corrections beyond resubmission. |
| 6. Medilink calculates amount due and settles via licensed provider | PARTLY | calculation + ledger + invoices implemented; **provider settlement is a stub** (`src/modules/billing-settlement/infrastructure/gateway.ts`, `admin/payouts/page.tsx:105-111`). |
| 7. Full transaction available for reporting/dispute | PARTLY | audit trail + disputes yes; no exportable reports (dashboards only). |
| Design correction: not first-to-accept; facility confirms recommended practitioner | IMPLEMENTED | engine ranks, "nothing is offered until you click" (`shifts/[id]/page.tsx:405`), accepting ≠ confirmed. |
| Figure 2 excusal path: practitioner asks the **facility** to release them | DIVERGES | practitioner asks (`practitioner/shifts/excusal-panel.tsx`), but the decision is made by a platform officer on `sanction.apply` at PLATFORM scope (`src/app/api/v1/excusals/[id]/decide/route.ts:19-21`, `admin/unhonoured/unhonoured-detail.tsx:348`); no facility screen. |

### 10.3 §7 Technology stack (spec `:190-203`)
| Layer | Status | Evidence |
|---|---|---|
| Next.js (TypeScript), single codebase UI + API | IMPLEMENTED | `package.json` next ^15.5.25, React ^19.3.0; `src/app/api/v1` 110 route files. |
| PostgreSQL | IMPLEMENTED | Prisma + Postgres 16 in CI (`ci.yml`). |
| Payments: Paystack / Remita | MISSING | `PAYMENT_PROVIDER` accepts `paystack|remita` (`src/lib/env.ts:44`) but only a stub exists (`gateway.ts`); no adapter code. |
| Notifications: email, SMS, push, WhatsApp | PARTLY | SMS interface + local console adapter only; `termii`/`africastalking` throw (`src/lib/sms/index.ts:105-108`); no email, push, WhatsApp, in-app inbox; one event handler (`src/worker/handlers.ts:20`). |
| Hosting: cloud VM / managed Postgres | PARTLY | `Dockerfile` + `docker-compose.yml`; no deploy pipeline in `.github/` (redesign §1 item 10). |
| Background: queue/worker with Postgres outbox | IMPLEMENTED | `src/worker/*`, `src/lib/outbox.ts`; 6 scheduled jobs (`src/worker/jobs.ts`). |
| Mobile: Flutter | MISSING | only ADR 0003; no Flutter/Dart code in repo. |
| Object storage: Tigris, signed URLs | IMPLEMENTED | `src/lib/storage/tigris.ts`; `document-upload.tsx` uploads direct to signed URL. |

### 10.4 §8.11 Recommended codebase layout (spec `:300-303`)
- `src/app/{(auth),practitioner,facility,admin,api}` — IMPLEMENTED (`src/app` listing).
- `src/modules/…` — PARTLY/DIVERGES: 19 folders; names differ (`rates-contracts` vs `contracts`; `billing-settlement` vs `billing`+`payments`; `audit-compliance` vs `compliance`); extra `clinical-incidents`, `cancellations-sanctions`, `suggestions`, `config`; `scheduling` is a stub with only `permissions.ts`/`routes.ts` (`src/modules/scheduling`, `docs/module-map.md:28-33`); no `payments` module (stub lives in `billing-settlement/infrastructure/gateway.ts`).
- `src/infrastructure/{database,payments,messaging,storage,background-jobs}` and `src/shared/{authorization,validation,errors,audit,types}` — DIVERGES: absent; their content lives in `src/lib/` (`db.ts`, `storage/`, `sms/`, `authz/`, `audit.ts`, `outbox.ts`, `http/`) and `src/worker/`.
- §8.1 module shape (`domain/ application/ infrastructure/ presentation/ permissions.ts routes.ts tests/`) — IMPLEMENTED structurally (e.g. `src/modules/auth`), but each module's `tests/` dir is mostly `.gitkeep`; tests are co-located in `domain/` or under `tests/integration/`.

### 10.5 Module 26 Customer Support (spec `:712-714`, launch condition `:946`)
| Requirement | Status | Evidence |
|---|---|---|
| Staffed phone line + WhatsApp from day one (launch condition) | MISSING (no surface) | no phone/WhatsApp/email anywhere in `src` (grep); landing, login, register, footer, consoles list none; errors say "Contact support." with no contact (`src/modules/auth/domain/errors.ts:52`); facility banners say "Contact Medilink" (`facility/page.tsx:179`). Operational condition, but the product gives users nowhere to find the number. |
| Helpdesk ticketing, knowledge base/FAQ, SLA tracking, complaint escalation | MISSING | no tickets/FAQ; closest: "Send a suggestion" with a `SUPPORT / Getting help` category (`src/components/app/suggestion-dialog.tsx:36`), signed-in only, author cannot read the reply. |

### 10.6 Module 27 Low-bandwidth and mobile (spec `:716-742`)
| Bullet | Status | Evidence |
|---|---|---|
| Responsive, PWA-capable Next.js delivery | PARTLY | responsive consoles; mobile e2e for practitioner pages; manifest present but `icons: []` (`public/manifest.webmanifest:9`), no service worker → not installable/offline. |
| Small page payloads | PARTLY | charts `dynamic`-imported, one-request dashboards (`/api/v1/dashboard/*`), `LazyMotion`; Slow-4G budget script `scripts/page-budget.mjs` (manual, not CI); but React Query/Toaster/motion providers load on the public landing (`layout.tsx:22`). |
| Compressed uploads | MISSING | `document-upload.tsx` checks type and 10 MB cap only; no resize/compress (no canvas/compression code). |
| Retry logic for failed requests | PARTLY | React Query retries non-4xx up to 2× for queries (`src/lib/ui/providers.tsx:37-41`, `session.tsx:102`); mutations `retry: false` (`providers.tsx:42`); no queued/idempotent write retry. |
| Draft-saving forms | PARTLY | profile wizard saves each step server-side (`setup-wizard.tsx` header comment); other forms (new shift, timesheet, incident) keep state in memory only; `localStorage` holds only theme and chosen facility (`console-shell.tsx:139,164`, `lib/ui/facility.ts`). |
| SMS notifications | PARTLY | only "shift confirmed" message, only via the local console adapter; times printed in UTC (`src/modules/notifications/application/handlers.ts` `formatShift`). |
| Clear network-status feedback | PARTLY | per-section "Could not load" and the "Could not reach Medilink — you are still signed in" retry screen (`session.tsx:127-137`); no online/offline indicator (`navigator.onLine` unused). |

### 10.7 Module 28 Flutter client (spec `:726-742`)
MISSING — no mobile client; ADR 0003 records the decision (`docs/adr/0003-flutter-mobile-client.md`). API is versioned `/api/v1` (§8.10 IMPLEMENTED). The ADR's server prerequisite "accept idempotent replays" is not met (redesign §5 attendance: no idempotency). Spec itself sequences Flutter in Phase 2 / "P1 module" (`:742`, `:948`).

### 10.8 §10.3 Usability (spec `:911-915`)
| Requirement | Status | Evidence |
|---|---|---|
| Interface for varied digital literacy | PARTLY | plain-language blockers, wizard, stated consequences on buttons; but 14px/12px text, 36px controls, no larger-text mode (sections 4.1-4.3). |
| Comprehensive in-app help and documentation | MISSING | no help pages, tooltips (component unused), FAQ or contextual help beyond inline hints. |
| Multilingual support (later phases) | MISSING (not yet required) | no i18n; English only; Hausa templates/screens absent. |

### 10.9 §11 Delivery phases (spec `:917-948`)
Phase 1 — Safe MVP:
| Item | Status | Evidence |
|---|---|---|
| Registration | IMPLEMENTED | OTP flow (SMS delivery local-only). |
| Facility verification | IMPLEMENTED | `/admin/facilities`; no licence upload UI. |
| Practitioner credentialing | PARTLY | submit/review + identity/registration confirmation work; requirements seeded for doctors only (`prisma/seed.ts:127-150`). |
| Availability | PARTLY | weekly pattern + blocks; no listing/price. |
| Service requests | IMPLEMENTED | create/publish/cancel; no edit/clone. |
| Matching | IMPLEMENTED | ranked, explainable, hand-reviewed. |
| Scheduling | PARTLY | list of assignments (spec itself allows a list, `:940`); no calendar/conflict UI (`module-map.md:28-33`). |
| Timesheets | IMPLEMENTED | submit/approve/correct/revisions. |
| Agreed rates | IMPLEMENTED | rate floors + rate cards (`facility/rates`), band pricing. |
| Payment-provider integration | MISSING | stub only. |
| Notifications | PARTLY | SMS only, one handler, console adapter. |
| Audit logs | IMPLEMENTED | `/admin/audit`. |
| Disputes | PARTLY | practitioner raises from timesheets; officer resolves; no facility/evidence UI. |
Phase 2: recurring shifts MISSING; replacement management MISSING (no replacement search; unhonoured flow only decides fault); ratings MISSING (reliability ratio only); enhanced attendance PARTLY (token + QR payload + manual; no GPS/photo); analytics PARTLY (dashboards, finance charts, performance page; no exports); tax statements MISSING; **credential-expiry automation IMPLEMENTED already** (`credential.expiry_sweep`, `registration.expiry_sweep`, `src/worker/jobs.ts`); multiple practitioner categories PARTLY (5 categories seeded, requirements/specialties/floors only for doctor/nurse). Phase 3: none.
"What must not be deferred": identity/credential verification IMPLEMENTED; fault field IMPLEMENTED (`/assignments/:id/fault`, admin Unhonoured page); audit record IMPLEMENTED. "Contracts: one fixed template" — IMPLEMENTED beyond (versioned agreements, `src/modules/audit-compliance/application/consent.ts:346`, `/admin/agreements`) but not enforced (redesign §5).

### 10.10 §11.1 Launch operating model (spec `:950-958`)
| Item | Status | Evidence |
|---|---|---|
| One state first | MISSING (no mechanism) | no state restriction; no `feature_flags` table (spec §8.9) anywhere in `prisma/schema.prisma`/`src`. |
| Recruit/verify ≥50 practitioners before facilities | PARTLY | verification queues exist; nothing gates or counts cohorts. |
| First fifty engagements hand-matched | PARTLY | by design "an engine ranks; a person chooses" (`docs/interfaces.md:67-69`, `shifts/[id]/page.tsx:98`); no counter/flag for the first fifty. |
| Fill-rate threshold ~70% before second state; first-month signals (fill rate, publish→confirm time, approval→paid time, verification turnaround, repeat practitioners/facilities) | MISSING at platform level | platform dashboard has queue counts/oldest age, incident severity, monthly growth, recent audit (`src/modules/audit-compliance/application/platform-summary.ts:35-43`); a per-facility weekly needed-vs-filled chart exists (`facility-summary.ts:22`). |

### 10.11 §11.2 Seed data before first registration (spec `:960-964`; `prisma/seed.ts`, `prisma/data/nigeria.ts`)
| Item | Status | Evidence |
|---|---|---|
| Professional categories | IMPLEMENTED | 5 (doctor/MDCN, nurse/NMCN, pharmacist/PCN, lab scientist/MLSCN, radiographer/RRBN) `seed.ts:36-42`. |
| Regulators | PARTLY | a text column on category and facility type, not a regulators list (`seed.ts:36-42,195-201`). |
| Specialties / subspecialties | PARTLY | 12 doctor + 3 nurse specialties (`seed.ts:73-77`); none for pharmacist, lab, radiography; no subspecialties. |
| Credential types | PARTLY | 6 types, all MDCN/doctor-flavoured (`seed.ts:100-107`); no NMCN/PCN/MLSCN/RRBN licence types. |
| (Requirements, implied) | PARTLY | doctor only: licence, NIN, MBBS (`seed.ts:127-150`). |
| States and LGAs | IMPLEMENTED | 37 states (36 + FCT) and 774 LGAs, counts asserted (`nigeria.ts:29-30`, `seed.ts` header). |
| Public holidays, current + following year | PARTLY | six fixed 2026 dates only; none for 2027; moveable holidays absent (`seed.ts:253-262`). |
| Facility and ownership types | PARTLY | 7 facility types (`seed.ts:194-201`); no ownership type list; no pharmacy/maternity type. |
| Rate floors | PARTLY | 4 placeholder rows: doctor and nurse × day/night (`seed.ts:273-282`). |
| One engagement agreement template | MISSING from seed | `prisma/seed.ts main` (`:301-312`) loads none; template created by super administrator via `/admin/agreements` or by the demo seed (`scripts/seed-demo.ts:704-707`). Gate checklist 3.8 "Not started". |
| Notification templates | MISSING | no template store; message text is hard-coded in `notifyAssignmentConfirmed` (`handlers.ts`); schema has only `NotificationMessage` (`prisma/schema.prisma:1151`). |
| Every list has a named owner and review date | PARTLY | owner strings (`seed.ts:19-23`, e.g. `'compliance-officer'`, roles that are now retired) yes; no review-date field. |
| Loaded through versioned migrations | DIVERGES | loaded by idempotent upserts via `pnpm db:seed` (`seed.ts:3-4`), run after migrate in CI (`ci.yml:73-74,168`); migrations contain no seed `INSERT`s for these lists. |

### 10.12 §9.7 Minimum safe pilot scope (spec `:816-820`)
| Element | Status | Evidence |
|---|---|---|
| Practitioner and facility registration | IMPLEMENTED | `/register`, `/register?as=facility`; (ops-created facility API-only). |
| Identity and credential verification | PARTLY | manual officer path works (providers `none` by default, `src/lib/verification/index.ts:20`); no automated NIN/MDCN provider; no selfie match. |
| Facility-created shift requests | IMPLEMENTED | |
| Assisted matching | IMPLEMENTED | |
| Assignment confirmation | IMPLEMENTED | |
| Attendance and timesheets | IMPLEMENTED | |
| Basic invoice and payment-provider settlement | PARTLY | invoices/ledger/payout prepare-release yes; provider stub. |
| Audit logs | IMPLEMENTED | |
| Operational administration | IMPLEMENTED | `/admin` (16 pages). |
| Cancellation and fault recording | PARTLY | fault + excusal + unhonoured sweep yes; no UI to cancel a confirmed assignment; no sanction ladder. |
| Dispute intake | PARTLY | practitioner-initiated from timesheets only. |
| Customer support through phone and WhatsApp | MISSING (no surface) | see 10.5. |
| Safety-critical controls enforced in system: verified identity, unexpired credentials, facility verification, audit trail, rate acceptance, timesheet approval, payout controls, fault recording | PARTLY | identity/credentials/facility gate/audit/timesheet approval/fault IMPLEMENTED; rate acceptance shows hourly rate only, premiums hidden on offer (`offers/page.tsx:151`); payout controls = prepare then release by the same `payout.manage` holder, no maker-checker. |

### 10.13 §12 Key risks (spec `:966-978`)
| Risk → spec mitigation | Status | Evidence |
|---|---|---|
| Unqualified practitioners → mandatory verification; auto-suspension on expiry | PARTLY | pure eligibility + expiry sweeps; mandatory requirements seeded for doctors only (`seed.ts:127-150`). |
| First-to-accept matching → multi-factor + facility confirmation | IMPLEMENTED | engine + confirm step. |
| Wallet exposure → ledger + licensed provider | PARTLY | ledger yes (balanced, kobo); provider settlement not built. |
| Data protection → privacy/audit module (spec says "Module 16", heading is 17) | PARTLY | audit trail, consent, agreements, export, erasure *assessment* (`privacy-section.tsx`); NDPC registration "Not started" (`docs/stage-3-gate-checklist.md:12`). |
| Connectivity → OTP/QR/manual check-in + SMS-first notifications | PARTLY | check-in fallbacks implemented; SMS-first not (console adapter only). |
| Schema/tech mismatch → single Postgres | IMPLEMENTED | |
| Impersonation → NIN via provider, register check, selfie match, one identity one account | PARTLY | NIN hash unique (`prisma/schema.prisma:669-675`), name-match flag, manual register check; no provider by default; **no selfie matching**. |
| No-shows → fault, graduated sanctions, reliability, excusal | PARTLY | fault + excusal + reliability ratio; **no sanction ladder**; excusal decided by officer not facility. |
| Unfair sanctions → only Compliance Officer applies/lifts | DIVERGES | any `administrator` (`permissions.ts:180`). |
| Flutter divergence → same API, no business rules | MISSING | no client; API is versioned `/api/v1`. |

### 10.14 v2.9 module number ↔ repo module mapping
Repo numbering is `docs/module-map.md:7-26`; it **splits v2.9 Module 9 into attendance + timesheets (confirmed, `:17-18`)**, shifting repo numbers by +1 for v2.9 modules 10–15; **v2.9 Module 16 has no repo module and is folded into the `/admin` console** (confirmed: no `administration` module folder or module-map row; `docs/interfaces.md:7-9` assigns operations work to `/admin`); numbers 17 and 18 coincide again.
| v2.9 # | v2.9 module | Repo folder (module-map #) | Note |
|---|---|---|---|
| 1 | Authentication and Access Control | `auth` (1) | |
| 2 | Practitioner Management | `practitioners` (2) | also holds identity, registration, screening, eligibility, application review |
| 3 | Credential and Compliance Verification | `credentials` (3) | identity assurance sits in `practitioners` |
| 4 | Healthcare Facility Management | `facilities` (4) | |
| 5 | Practitioner Availability | `availability` (5) | |
| 6 | Service Request and Shift Management | `service-requests` (6) | |
| 7 | Matching and Assignment | `matching` (7) | assignments, invitations, conflict list |
| 8 | Scheduling and Calendar | `scheduling` (8) | **stub** (`permissions.ts`, `routes.ts`); schedule list lives in `matching` |
| 9 | Attendance and Timesheet Management | `attendance` (9) **+** `timesheets` (10) | split in two |
| 10 | Rates, Contracts and Engagement Terms | `rates-contracts` (11) | agreements live in `audit-compliance` |
| 11 | Billing, Payments and Settlement Ledger | `billing-settlement` (12) | payments = stubbed `infrastructure/gateway.ts` |
| 12 | Cancellation, No-Show, Fault and Sanctions | `cancellations-sanctions` (13) | |
| 13 | Dispute and Case Management | `disputes` (14) | |
| 14 | Clinical Incident Reporting | `clinical-incidents` (15) | |
| 15 | Notifications and Communication | `notifications` (16) | |
| 16 | Administration and Operations | **none** | folded into `/admin` pages + `audit-compliance` summaries, `auth` grants |
| 17 | Security, Privacy and Audit | `audit-compliance` (17) | plus `src/lib/{audit,authz,outbox}.ts`, step-up in `auth` |
| 18 | Suggestions and Product Feedback | `suggestions` (18) | |
| 19–25, 29–36 | P1/P2 modules (ratings, rostering, reports, CPD, tax, preferred pools, fraud, telemedicine…) | none | |
| 26 | Customer Support | none | see 10.5 |
| 27 | Low-Bandwidth and Mobile | none (cross-cutting; `src/lib/ui`, manifest) | see 10.6 |
| 28 | Mobile Application (Flutter) | none | see 10.7 |
| — | (reference data, §8.6/§11.2) | `config` (not in module-map) | `src/modules/config/{reference,nigeria.test}.ts` |
Confusion risks: (a) repo docs/code say "Modules 11 and 12" for rates/billing (`docs/stage-8-disputes.md:142`), which are v2.9 modules 10 and 11; (b) v2.9 itself cites "Module 16" for privacy/retention (`v29.md:618`, §12 risk row) although its own heading is 17; (c) `src/lib/authz/permissions.ts:49` calls suggestions "Module 18" (matches v2.9 and the repo).
