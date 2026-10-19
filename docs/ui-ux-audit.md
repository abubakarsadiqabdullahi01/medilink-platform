# Medilink UI/UX audit

**Status:** Phase 1 of the redesign. Written *before* any screen was changed; the shared design-system
work that came with it is listed in section 9 and marked as done or not.
**Baseline:** commit `7ad839c` (`main`), 2026-10-18. **Detailed evidence:** [practitioner](ui-audit/practitioner.md) ·
[facility](ui-audit/facility.md) · [operations](ui-audit/admin.md) — every file read in full, every finding
with a file and line.

## 0. How this was produced, and what could not be done

- Three reviewers each read every screen in one console, and every client component it imports, in full
  (about 24,000 lines under `src/app` and 7,200 under `src/components`). I re-read eight of the most serious
  claims in the code myself (listed in section 12) and they all held.
- The production build was run against the seeded demonstration world (`scripts/seed-demo.ts`) and every
  representative page was opened in a real browser at **390, 768 and 1440 px**, signed in as the person
  the page is for (`scripts/ui-screenshots.mjs`). The figures in sections 2 and 3 are measured, not read.
- **Two files named in the brief do not exist:** `docs/performance.md` and `docs/test-and-demo-access.md`.
  The equivalents used were `docs/testing-by-role.md` (accounts and flows), `docs/running-a-demo.md` and
  `scripts/page-budget.mjs` (the Slow-4G budget: dashboards at most 5 API calls; no route fetched more
  than twice; navigable within 2 s). `docs/blueprint/Medilink-Module-Reference-v3.md` records that the
  budget script is manual and not run in CI (`QAL-04`).
- Not measurable here: real Android devices, real 3G, a screen reader. Anything about those is marked
  "verify" in the detailed files and repeated in section 11.
- The type scale is **not** a finding. `tailwind.config.ts` remaps `text-xs` to 14 px and `text-sm` to 16 px
  (UXA-01), so nothing set with those classes is under the brief's floor. Measured: **no text under 14 px
  on any audited page** at normal size. The one exception in source is a 10 px unread-count in
  `notification-bell.tsx:79` (aria-hidden; the button carries the count in its name).

## 1. Summary

**What is already strong and must not be rebuilt.** Permission-aware navigation; one request per dashboard,
computed in the database; no per-row API calls except one (below); WAT dates and `formatNaira` used almost
everywhere; a 44 px default button; persistent labels; a skip link, a focus-trapped mobile drawer;
reduced-motion honoured in the Framer primitives; an A / A+ / A++ text-size control; sentence-case copy, Lucide
icons only and no hard-coded colours in the apps (one `emerald` in `reconciliation-card.tsx`). **No audited
page scrolls sideways at 390 px.** The foundations are good; the gaps are in the middle layer.

**What is wrong, in order of how much it matters.**

1. **A failed load is drawn as a true answer.** Finance shows ₦0.00 and "Every issued invoice has been paid"
   when its request failed; the practitioner dashboard says "Create your profile to get started" when the profile
   request failed; the privacy tab offers erasure with an empty explanation; dispute evidence reads "Nothing has
   been attached yet" on a failed load, and evidence can never be removed. No screen anywhere has a Retry
   button, and read errors never say whether it was a refusal, the network or the server.
2. **Consequential decisions are one click.** Reinstating a suspended practitioner, clearing a sanctions flag,
   closing an incident with "Suspend the practitioner", upholding a dispute, publishing a terms version that forces
   everyone to re-accept, removing a public holiday (which changes pay), withdrawing a dispute, approving or rejecting
   a timesheet, publishing a shift. Where a dialog exists it often does not name the object, the consequence or
   whether it can be undone, and typed text survives Cancel (including a pre-armed "ERASE").
3. **The dashboards answer "how many", not "what do I do now".** The facility "roster" tile is every CONFIRMED
   assignment of any date, labelled "due on the floor". The practitioner dashboard has no check-in, timesheet, earnings
   or credential-expiry signal. The operations dashboard has six queue counts but nothing on failed notifications,
   reconciliation, privacy-request deadlines or system health.
4. **Accessibility basics missing at scale.** About 40 Radix `Select`s have a `<Label>` that is not bound to them
   (the control's name is its current value); no field error is tied to its field (`aria-describedby` appears nowhere
   in the apps); no inline status has a live region; every one of ~50 pages has the same `<title>`; card titles are
   `<div>`s so most pages expose only an h1; `Alert` was always `role="alert"`, so notes were announced as errors.
5. **On a phone, the working screens do not fit.** The facility roster and shifts tables are 1,000–1,050 px wide
   inside a 358 px column, so attendance and cancel are off screen; the practitioner header is 377 px of controls in
   358 px; the facility and operations filter cards stay fully open and push the first result below the fold.
6. **Seven queues, seven filter bars, ten copies of the pager, seven row cards, six detail shells.** The same
   problem is solved differently on each page, which is why 1–5 recur.
7. **Some queues hide their own oldest item.** Credentials and facilities are newest-first, so the oldest waiting
   item the dashboard advertises is on the last page; the incident queue is "most serious first" only within
   each page of 20.
8. **Motion and media.** Charts animate for about 1.5 s regardless of `prefers-reduced-motion`; the sheet primitive
   opened in 500 ms with an 80%-black scrim; dialog close targets were 16 px.

## 2. Route and screen inventory

Audience and task are the person the screen is *for* and the one thing it is *for*; the detailed files carry
the data sources, states and findings per screen. "API calls on load" is measured at 390 px on a production build
with an empty cache, and includes the shell's session, inbox and photo calls.

| Route | Audience | Main task | File (lines) | API calls on load | Page height at 390px |
|---|---|---|---|---:|---:|
| **PUBLIC** | | | | | |
| `/` | Anyone deciding whether to trust Medilink | Understand the promise; register or sign in | `src/app/page.tsx` (609) | 0 | 6,295px |
| `/login` | Everyone with an account | Sign in with phone and password | `src/app/(auth)/login/page.tsx` (187) | 0 | 844px |
| `/register (?as=facility, ?as=staff)` | New practitioner; new facility owner; new facility staff | Claim a phone number, confirm a code, set a password | `src/app/(auth)/register/page.tsx` (604) | 0 | 936px |
| `/forgot-password` | Anyone locked out | Reset a password with a code | `src/app/(auth)/forgot-password/page.tsx` (241) | — | — |
| `/contact, /privacy, /terms` | Anyone | Read the policy or find a person | `src/app/contact/page.tsx` (29) | — | — |
| **PRACTITIONER (390px phones)** | | | | | |
| `/practitioner` | Practitioner | Am I eligible, is anything waiting on me, where am I next | `src/app/practitioner/page.tsx` (461) | 5 | 844px |
| `/practitioner/offers` | Practitioner | Accept, or decline with a reason, an offered shift | `src/app/practitioner/offers/page.tsx` (320) | 5 | 4,473px |
| `/practitioner/shifts` | Practitioner | See confirmed shifts; check in and out; explain an absence | `src/app/practitioner/shifts/page.tsx` (196) | 3 | 2,494px |
| `/practitioner/timesheets` | Practitioner | Submit worked hours; accept or dispute the decision | `src/app/practitioner/timesheets/page.tsx` (366) | 3 | 20,375px |
| `/practitioner/earnings` | Practitioner | See what is owed and paid; give a bank account | `src/app/practitioner/earnings/page.tsx` (158) | 4 | 1,584px |
| `/practitioner/profile` | Practitioner | Maintain details; or be walked through first-time setup | `src/app/practitioner/profile/page.tsx` (214) | 7 | 2,104px |
| `/practitioner/profile?tab=credentials` | Practitioner | Submit, resupply or renew a credential | `src/app/practitioner/profile/credentials-section.tsx` (356) | 6 | 1,991px |
| `/practitioner/profile?tab=availability` | Practitioner | Set weekly pattern, free dates and leave | `src/app/practitioner/profile/availability-section.tsx` (512) | 6 | 1,602px |
| `/practitioner/profile (newcomer)` | New practitioner | Create a profile and submit it for approval | `src/app/practitioner/profile/setup-wizard.tsx` (602) | 6 | 1,706px |
| **FACILITY** | | | | | |
| `/facility` | Facility owner or administrator | What needs me now | `src/app/facility/page.tsx` (296) | 5 | 2,090px |
| `/facility/shifts` | Ward manager / scheduler | Scan open shifts; publish; cancel | `src/app/facility/shifts/page.tsx` (519) | 4 | 2,257px |
| `/facility/shifts/[id]` | Ward manager / scheduler | Find candidates; offer; confirm acceptances | `src/app/facility/shifts/[id]/page.tsx` (498) | — | — |
| `/facility/roster` | Ward manager on the floor | See who is due; issue check-in codes; record attendance by hand | `src/app/facility/roster/page.tsx` (424) | 3 | 3,926px |
| `/facility/timesheets` | Owner / finance | Approve, reject or correct submitted hours | `src/app/facility/timesheets/page.tsx` (663) | 3 | 3,109px |
| `/facility/invoices` | Finance | How much do we owe, for which shifts | `src/app/facility/invoices/page.tsx` (207) | 3 | 9,099px |
| `/facility/rates` | Owner / administrator | Set night, holiday, overtime and on-call multiples | `src/app/facility/rates/page.tsx` (126) | — | — |
| `/facility/profile` | Owner / administrator | Check what Medilink holds; fix address, licence | `src/app/facility/profile/page.tsx` (375) | 3 | 1,473px |
| `/facility/staff` | Owner only | Invite colleagues; change role; remove access | `src/app/facility/staff/page.tsx` (47) | 4 | 844px |
| `/facility/incidents` | Ward manager | File a clinical incident; read outcomes | `src/app/facility/incidents/page.tsx` (311) | — | — |
| `/facility/disputes` | Owner only | Read a case; add evidence; withdraw | `src/app/facility/disputes/page.tsx` (330) | — | — |
| `/facility/register` | New facility owner | Register the facility | `src/app/facility/register/page.tsx` (263) | — | — |
| **OPERATIONS (desktop)** | | | | | |
| `/admin` | Any operations officer | Decide what to work first | `src/app/admin/page.tsx` (422) | 2 | 2,878px |
| `/admin/credentials` | Compliance | Verify, ask for more, or reject credentials | `src/app/admin/credentials/page.tsx` (476) | 3 | 4,891px |
| `/admin/practitioners` | Onboarding / compliance | Approve applications; record identity and registration | `src/app/admin/practitioners/page.tsx` (987) | 3 | 3,029px |
| `/admin/facilities` | Onboarding / compliance | Verify a facility's licence; register one | `src/app/admin/facilities/page.tsx` (302) | 3 | 844px |
| `/admin/incidents` | Clinical safety | Triage and close incidents | `src/app/admin/incidents/page.tsx` (315) | 2 | 1,228px |
| `/admin/disputes` | Operations | Adjudicate a disputed shift | `src/app/admin/disputes/page.tsx` (260) | 2 | 896px |
| `/admin/unhonoured` | Operations | Decide fault for a missed shift | `src/app/admin/unhonoured/page.tsx` (258) | — | — |
| `/admin/data-requests` | Privacy / support | Answer a data request within its deadline | `src/app/admin/data-requests/page.tsx` (318) | — | — |
| `/admin/finance` | Finance | Money overview and reconciliation | `src/app/admin/finance/page.tsx` (385) | — | — |
| `/admin/invoices` | Finance | Raise, issue, void and mark invoices paid | `src/app/admin/invoices/page.tsx` (545) | 2 | 888px |
| `/admin/payouts` | Finance | Prepare, release and settle payouts; review accounts | `src/app/admin/payouts/page.tsx` (600) | 2 | 1,232px |
| `/admin/audit` | Compliance | Answer "what happened to this record" | `src/app/admin/audit/page.tsx` (360) | 2 | 4,047px |
| `/admin/system` | Operations / engineering | Is the platform healthy; replay events | `src/app/admin/system/page.tsx` (296) | 2 | 4,889px |
| `/admin/performance` | Operations | Read platform performance | `src/app/admin/performance/page.tsx` (135) | — | — |
| `/admin/staff` | Super administrator | Grant and remove platform access | `src/app/admin/staff/page.tsx` (40) | — | — |
| `/admin/suggestions` | Product | Triage what the pilot is saying | `src/app/admin/suggestions/page.tsx` (259) | — | — |
| `/admin/sanctions` | Compliance | Maintain the sanctions list | `src/app/admin/sanctions/page.tsx` (392) | — | — |
| `/admin/levels` | Super administrator | Maintain professional levels and categories | `src/app/admin/levels/page.tsx` (282) | — | — |
| `/admin/rate-floors` | Super administrator | Set minimum pay | `src/app/admin/rate-floors/page.tsx` (279) | — | — |
| `/admin/holidays` | Super administrator | Maintain public holidays (they change pay) | `src/app/admin/holidays/page.tsx` (215) | — | — |
| `/admin/agreements` | Super administrator | Publish terms and notices | `src/app/admin/agreements/page.tsx` (276) | — | — |


Also in scope and measured: 404 and error pages (`src/app/not-found.tsx`, `error.tsx`, `global-error.tsx`) and
the three console layouts. `global-error.tsx` uses inline hex colours by necessity (it renders without the stylesheet).

## 3. Measured at 390 px (production build, seeded data)

| Measure | Result |
|---|---|
| Pages that scroll sideways | **0 of 30**. Not the same as "fits": several tables scroll *inside* their card, which is why the page does not overflow — the facility roster's Ends, Attendance and Cancel columns are cut off at 390 px (see the roster screenshot in section 8) |
| Text under 14 px | **0** |
| Controls under the 24 px WCAG 2.2 target-size floor (SC 2.5.8) | login "Forgot your password?" link (21 px), the register data-sharing checkbox, one availability checkbox, and **50 on the audit trail** (every record id is a `font-mono` button) |
| Controls from 24 to 43 px (below the 44 px aim) | 263 across 30 pages — mostly 40 px "sm" buttons, text links and row actions |
| Native inputs with no label | 1 each on facility shifts, facility profile, admin credentials, admin facilities; 3 on admin incidents (the Radix selects the agents found are not countable this way) |
| Failed requests on a normal visit | `/api/v1/practitioners/me` 404 for a newcomer (expected, handled); **`/api/v1/grants` and `/api/v1/staff-invitations` return 401** on every first visit to Staff before step-up (the lock card is by design; the two failing calls are not) |
| Most API calls on one page | 7 on `/practitioner/profile`; 5 on each dashboard (the budget is "at most 5") |
| Tallest pages at 390 px | practitioner timesheets **20,375 px** (every assignment ever, unpaged), facility invoices 9,099 px (every line of every invoice), practitioner offers 4,473 px |

First Load JS at baseline (`next build`): shared 103 kB; `/` 119 kB; `/practitioner` 150 kB; `/facility` 162 kB;
`/admin` 136 kB; `/login` 131 kB; `/register` 159 kB. Full table: `docs/ui-screenshots/before/` and section 10.

## 4. Findings by theme

Priority: **Critical** — misleads a person, loses data or money, is unsafe or irreversible without a gate, or fails
WCAG 2.2 A/AA outright. **Important** — clear friction, a misleading state, a structural a11y gap or an
inconsistency people will trip on. **Polish** — consistency, copy, small a11y. IDs refer to the detailed files.

### 4.1 Failure, empty and loading states

| Pri | Finding | Where |
|---|---|---|
| Critical | Failure drawn as zero / "all clear" / "nothing yet" | Finance totals, charts, "every issued invoice has been paid" (admin S-01); practitioner setup card, profile form, availability leave tabs, privacy tab, erasure, verification panel, notification bell (X-3); dispute evidence (facility DP-2); dashboard charts, incident shift picker, register reference lists (facility X2) |
| Important | No Retry anywhere; one generic sentence for 401, 403, offline, 5xx | Every list on every console (admin S-02, facility X2, practitioner X-5) |
| Important | A failed poll wipes System health and Performance; `retry:false` on dashboards but three retries on lists, so the same outage looks different per page | admin S-02, 2.13, 2.14 |
| Important | Blocking page skeleton although sections have their own | practitioner dashboard `page.tsx:74-87`; profile `Skeleton h-96`; facility profile `Skeleton h-64` |
| Important | Loading is silent to a screen reader; skeletons carry no status text | all consoles (practitioner X-20, admin S-09) |
| Important | No permission-denied screen; a direct URL to a forbidden page gets the generic failure | all consoles |
| Important | "Archived / decided" mis-signalled: upheld-in-your-favour is amber; VOID and PAID invoices are both grey; paid and failed payouts are both grey | facility DP-4, I-1; practitioner X-12 |

### 4.2 Irreversible and consequential actions

| Pri | Finding | Where |
|---|---|---|
| Critical | One-click decisions that change who may work, what is paid or what everyone must re-accept | admin S-03 (reinstate, clear flag, close-with-suspension, uphold, publish agreement, remove holiday, set floor, replay events, issue invoice, release payout); facility DP-1 withdraw dispute, T-2 approve/reject timesheet, S-2 publish shift, SD-5 confirm; practitioner "Ask anyway" erasure, offers Accept, timesheet Submit |
| Important | Confirmation dialogs that do not name the object, the consequence or reversibility; dialog text survives Cancel (including a pre-armed "ERASE") | admin S-04; facility S-3, R-4 |
| Important | Step-up confirmation re-runs the action without showing what it is about to do (amount, payee) | admin S-03 tail |
| Important | No review screen before publishing a shift, submitting hours, or sending money-affecting terms; a failed publish leaves a draft and a retry makes a second | facility N-1…N-6; practitioner S4 |
| Important | Silent defaults on the two most consequential fields: ₦5,000 and a pre-filled cancellation policy; incident severity pre-answered "Near miss" | facility N-2, IN-2 |

### 4.3 Accessibility

| Pri | Finding | Where |
|---|---|---|
| Critical | Radix `Select` with an unbound `<Label>`: name is the current value (WCAG 1.3.1, 3.3.2, 4.1.2) | 12 facility sites, 18 admin, 9 practitioner |
| Critical | Every route has `<title>Medilink</title>` (WCAG 2.4.2) | `src/app/layout.tsx:6`; all pages are client components with no metadata |
| Critical | Setup-wizard step buttons are named only by a digit on a phone (label is `display:none`) | practitioner S6a |
| Critical | "Remove all access now" is 3.32:1 in dark mode (`text-destructive`, not `destructive-text`) | facility ST-1 |
| Critical (fixed) | Dialog close target 16 × 16 px (SC 2.5.8) | shared `dialog.tsx` — fixed in Phase 2 |
| Important | No `aria-describedby`/`aria-invalid` tying an error or hint to its field; `Field` did not exist | all consoles |
| Important | No live region for saved / error / status changes beyond Sonner toasts, which dismiss errors in about 4 s | all consoles |
| Important | `Alert` always `role="alert"`: 22 of 64 admin alerts are static notes, a page of 25 issued invoices announces 25 | admin S-09 — fixed in Phase 2 (only `destructive` interrupts) |
| Important | No focus management on step change, list→detail, or when the acted-on row unmounts | admin S-07, facility X11, practitioner S6a/S9 |
| Important | Row actions share labels ("Cancel", "Approve", "Remove") and none names its row | facility X6, practitioner P12 |
| Important | `CardTitle` is a `<div>`: most pages expose one heading; sections in dialogs are `<p>`s | all consoles |
| Important | Tabs used as filters have no `TabsContent`; `aria-controls` points at nothing | admin S-13, facility X15, practitioner S3 |
| Important | Candidate / role / name-match toggles are `<button aria-pressed>` containing blocks, not radio groups | facility SD-6, ST-3; admin Q-3 |
| Important | Hidden-until-focus file input is a second tab stop, unnamed | facility U-1 |
| Polish | Status colour alone — **fixed**: every `StatusBadge`/`SeverityBadge` now has a shape per tone (the word was always present) | shared |
| Polish | `Detail` truncates values silently (the cut part is often the caveat) | admin S-08, facility X18, practitioner P16 |

### 4.4 Mobile (390 px)

| Pri | Finding | Where |
|---|---|---|
| Important | Tables with no stacked fallback: shifts (~1,050 px), roster (~1,000 px; attendance and cancel off screen), invoice lines (7 columns inside each card) | facility X7, R-1 |
| Important | Header: hamburger, title, bell, A, A+, theme, avatar = ~377 px in 358 px; the console title truncates ("Practiti…") and A++ is unavailable on phones | all consoles; measured |
| Important | Filters always open: search + selects + dates stack above the first result; no active count, no sheet | facility S-1, IN; admin Q-2 (seven implementations) |
| Important | Dashboard order on a phone: the eligibility card and invitations push "Offers waiting" and "Next shift" below the fold | practitioner S1 |
| Important | Offers card header: three badges squeeze the profession/facility column to ~75 px (verify) | practitioner S2 |
| Important | Charts: 26 weekly × 2 and 24 monthly × 2 bars in ~270 px, value-by-hover only; y-axis labels clipped ("000,000") — **measured** | facility D-6 |
| Important | `window.open` after an `await` is popup-blocked on iOS and many Android browsers (licence, dispute evidence) | facility X12 |
| Important | Card padding `p-6` inside a `p-4` shell: ~310 px of 390 is content | practitioner X-15 |
| Important | Phones never see "what happens next" at registration (it sits in a `hidden lg:flex` panel) | practitioner S9 |
| Polish | Native date inputs show `mm/dd/yyyy` in the test browser (device locale decides); sticky footers absent in long dialogs | facility N-11 |

### 4.5 Requests and blocking loaders

| Pri | Finding | Where |
|---|---|---|
| Important | **One per-row API call:** `['my-excusals', id]` for every ended-unattended or no-show card | practitioner `excusal-panel.tsx:54-64` |
| Important | Roster, timesheets and shift detail request `include=contact`; the server writes one "phone shown" audit row per visible row on every refetch, including focus-refetches, for numbers nobody asked for | facility X13 — **audit-trail behaviour; recorded, not changed** |
| Important | Document-access POST run as a `useQuery` with 4-minute staleness: every refocus re-fetches the identity document and writes another access record | admin `evidence-review.tsx:139-150` — recorded, not changed |
| Important | Dashboard waterfall: the bundle blocks the page, then `reference` and invitations start | practitioner S1, X-14 |
| Important | Unbounded lists: timesheets (every assignment ever), offers (all, sliced client-side), payouts, credentials; every invoice line expanded | practitioner X-14, facility I-3 |
| Important | Facility staff first visit makes two 401 calls before step-up | measured |
| Polish | Same query under two keys: `['facility', id]` and `['facility-profile', id]`; practitioner profile fetched by the layout and by the bundle | facility 2.8, practitioner X-14 |
| Polish | No timeout or abort on any request; a stalled 3G call keeps a skeleton indefinitely | practitioner X-5 |
| Polish | Recharts animates ~1.5 s regardless of reduced motion | measured (bars empty in a screenshot taken at 400 ms) |

### 4.6 Consistency

| Pri | Finding | Where |
|---|---|---|
| Important | Hand-rolled copies of shared components: avatars (3), pills instead of `Badge` (6), `Detail`, `AuditEntry` typed six times, `monthLabel` ×2, `AmountFigure` bypassed by Finance | admin S-11 |
| Important | Credentials review exists three times and **disagrees**: the practitioner tab tests `INFO_REQUESTED`, a status that does not exist (the enum is `MORE_INFO_REQUESTED`), so a submission awaiting information shows no controls there | admin S-12 — verified in `schema.prisma:666` |
| Important | Date and "today in Lagos" computed four ways; invoice periods sent as 01:00 WAT | admin S-10 — recorded; a billing rule |
| Important | Vocabulary drift: offer / invitation / invited; booking / assignment / shift; credentials / documents; profession / category; "matcher", "sweep", "ledger", "rate card" shown to practitioners | all consoles |
| Polish | Money formatted outside `formatNaira` in charts (whole naira, loses kobo) and in the rate-card example | facility D-6, RT-3 |
| Polish | Hard-coded colour: `emerald` once; `white/15` tints in the auth panels; the landing page used eleven hex literals (now tokens) | admin S-09; practitioner S8 |
| Polish | Heading sizes and spacing for the same role vary (`text-sm` / `text-base` render identically after the remap, so the split is naming drift) | all |

### 4.7 Workflow friction (the eleven flows named in the brief)

| Flow | Verdict | Biggest gap |
|---|---|---|
| Practitioner onboarding | Good bones: wizard, checklist before submit, persistent "waiting" card | "Saved as you go" is false — Continue discards unsaved details; unnamed steps on a phone; no focus reset between steps |
| Credential submit / return / renew | Works | Form sits below the list on a phone; "Submit again" scrolls to the top; no "expiring soon" signal; EXPIRED has no action |
| Facility registration + verification | Works | No review step; name and type become uneditable without saying so; dashboard banner contradicts the Staff page; no pointer to the licence upload |
| Create and publish a shift | Works | No review; silent ₦5,000 and policy defaults; no link to staff it afterwards; known `publishBlockers` not checked up front |
| Candidate matching and exclusions | Explainable engine | Explanations clipped; exclusions collapsed at the bottom; "Ready to confirm" is the last card |
| Offer / accept / confirm | Works | Accept and Confirm are one click; Accept enabled while agreements are outstanding |
| Attendance and manual fallback | Works | Manual record starts blank and does not show the scheduled window; the check-in code dialog does not say whose code it is |
| Timesheets | Works | Approver cannot see actual check-in/out; Approve/Reject one click; "Awaiting decision" mixes actionable and inert cards; practitioner submits with no review |
| Invoices, payout accounts, money | Works | Failure shown as ₦0.00 (Finance); no work queues; every line expanded |
| Disputes and incidents | Works | Withdraw is one click; failed evidence load reads as empty; severity pre-answered; no way for a facility to raise a dispute from the shift |
| Staff invite / role change / removal | Strong dialogs (name the person, consequence) | Three equal-weight removal buttons; no "this is you" warning; the administrator description omits invoices, rates and licence edit |

### 4.8 Found while auditing, outside the scope of a UI change

Recorded so they are not lost; none was changed, because each is a rule, an order or an audit trail.

- **Incident ordering.** The server orders by newest and sorts by severity within each page of 20, so "most serious first"
  is false from page 2 (`incident.ts:418,429`). The UI copy was corrected; the ordering is an API decision.
- **Queue order.** Credentials and facilities are `createdAt desc`; a resubmitted facility's age is its creation date.
- **Invoice periods** are sent as `T00:00:00.000Z` (01:00 WAT); shifts between 00:00 and 01:00 on a boundary may land in the wrong invoice.
- **Phone-reveal audit rows** on every refetch (4.5), and the repeated document-access record.
- **Facility licence expiry** is stored as UTC midnight, so a licence "expiring 31 March" blocks publishing from 01:00 WAT on 31 March.
- **`PLATFORM_FEE_BP`** is an environment variable outside the validated settings (already `CFG-12` in the Gap Reconciliation).

## 5. State coverage (summary)

Every data-driven screen was checked for: loading · first-use empty · filtered empty · success · validation failure · network
failure *distinct from empty* · permission denied · server unavailable · archived/completed · destructive confirmation.
Per-screen matrices are in each detailed file (operations has a single table, `ui-audit/admin.md` §1).

| State | Coverage today |
|---|---|
| Loading | Present nearly everywhere (skeletons). Silent to assistive technology. Two pages block on a whole-body skeleton. |
| First-use empty | Present on most; usually without a next step (the shared `EmptyState` had no action slot). |
| Filtered empty | Present where filters exist; no "Clear filters" action. |
| Success | Toast only on most screens; a persistent result on four (payout account, wizard submit, credentials, excusal). |
| Validation | Disabled-button-with-a-silent-rule is the pattern; errors are never tied to fields. `useZodForm` exists and no console form uses it. |
| Network failure | Generic, no cause, no retry; five places show it as empty (4.1). |
| Permission denied | Navigation hides what you may not use; a direct URL gets the generic failure. |
| Server unavailable | Same as network. |
| Archived / completed | Present as tabs and badges; tone wrong for money statuses (fixed) and for upheld disputes. |
| Destructive confirmation | Present for staff access and a few queue actions; absent for most of the decisions in 4.2. |

## 6. Mobile problems — see 4.4. Accessibility problems — see 4.3. Requests and loaders — see 4.5.

## 7. Information hierarchy and workflow, by console

- **Practitioner.** The dashboard is ordered by what the *system* knows (setup, eligibility reasons), not by what the person
  came for. Reorder: what needs me *now* (check in; an offer to answer; hours to submit) → what is next → money → readiness.
  The data for offers, next shift, credentials (with expiry) and availability is already in the one bundle request;
  timesheets and earnings are not (see Phase 4 notes on how they are added).
- **Facility.** A scheduler's morning question is "is tomorrow covered?" — today's coverage, open shifts, offers
  waiting, anyone not arrived — and the dashboard cannot answer it: `roster` is all-time, `published` is a count, offers and
  attendance are absent. Licence state is already fetched and not shown.
- **Operations.** The six counts are right; the missing parts are *which item* (the tile links to the queue, not to the oldest
  case), *what is urgent* (one 5-day threshold for every queue), and the health signals that block work (failed
  notifications, reconciliation differences, privacy-request deadlines, no pay floor in force).

## 8. Screenshots (before)

Captured from a production build of `7ad839c` against the seeded demonstration world (invented people and facilities; no real
data), top 2,400 px of each page. Full set and `metrics.json` in `docs/ui-screenshots/before/`.

**Landing page** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Landing page at 390px](ui-screenshots/before/landing-390.jpg) | ![Landing page at 768px](ui-screenshots/before/landing-768.jpg) | ![Landing page at 1440px](ui-screenshots/before/landing-1440.jpg) |

**Practitioner dashboard** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Practitioner dashboard at 390px](ui-screenshots/before/practitioner-dashboard-390.jpg) | ![Practitioner dashboard at 768px](ui-screenshots/before/practitioner-dashboard-768.jpg) | ![Practitioner dashboard at 1440px](ui-screenshots/before/practitioner-dashboard-1440.jpg) |

**Practitioner offers** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Practitioner offers at 390px](ui-screenshots/before/practitioner-offers-390.jpg) | ![Practitioner offers at 768px](ui-screenshots/before/practitioner-offers-768.jpg) | ![Practitioner offers at 1440px](ui-screenshots/before/practitioner-offers-1440.jpg) |

**Practitioner shifts** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Practitioner shifts at 390px](ui-screenshots/before/practitioner-shifts-390.jpg) | ![Practitioner shifts at 768px](ui-screenshots/before/practitioner-shifts-768.jpg) | ![Practitioner shifts at 1440px](ui-screenshots/before/practitioner-shifts-1440.jpg) |

**Facility dashboard** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Facility dashboard at 390px](ui-screenshots/before/facility-dashboard-390.jpg) | ![Facility dashboard at 768px](ui-screenshots/before/facility-dashboard-768.jpg) | ![Facility dashboard at 1440px](ui-screenshots/before/facility-dashboard-1440.jpg) |

**Facility shifts** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Facility shifts at 390px](ui-screenshots/before/facility-shifts-390.jpg) | ![Facility shifts at 768px](ui-screenshots/before/facility-shifts-768.jpg) | ![Facility shifts at 1440px](ui-screenshots/before/facility-shifts-1440.jpg) |

**Facility roster** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Facility roster at 390px](ui-screenshots/before/facility-roster-390.jpg) | ![Facility roster at 768px](ui-screenshots/before/facility-roster-768.jpg) | ![Facility roster at 1440px](ui-screenshots/before/facility-roster-1440.jpg) |

**Facility timesheets** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Facility timesheets at 390px](ui-screenshots/before/facility-timesheets-390.jpg) | ![Facility timesheets at 768px](ui-screenshots/before/facility-timesheets-768.jpg) | ![Facility timesheets at 1440px](ui-screenshots/before/facility-timesheets-1440.jpg) |

**Operations dashboard** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Operations dashboard at 390px](ui-screenshots/before/admin-dashboard-390.jpg) | ![Operations dashboard at 768px](ui-screenshots/before/admin-dashboard-768.jpg) | ![Operations dashboard at 1440px](ui-screenshots/before/admin-dashboard-1440.jpg) |

**Operations credentials queue** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Operations credentials queue at 390px](ui-screenshots/before/admin-credentials-390.jpg) | ![Operations credentials queue at 768px](ui-screenshots/before/admin-credentials-768.jpg) | ![Operations credentials queue at 1440px](ui-screenshots/before/admin-credentials-1440.jpg) |

**Operations audit trail** — 390 · 768 · 1440 px

| 390 px | 768 px | 1440 px |
|---|---|---|
| ![Operations audit trail at 390px](ui-screenshots/before/admin-audit-390.jpg) | ![Operations audit trail at 768px](ui-screenshots/before/admin-audit-768.jpg) | ![Operations audit trail at 1440px](ui-screenshots/before/admin-audit-1440.jpg) |


## 9. Proposed shared components, and status

A component was only created where the pattern occurs in three or more places. "Done" means built, unit-tested and
committed with this audit; "Applied" says where it is already in use.

| Component | Replaces | Occurrences | Status |
|---|---|---|---|
| Tokens: `brand-*`, `shadow-card/float`, global `:focus-visible`, `scroll-padding-top`, reduced-motion CSS | eleven hex literals; per-component focus rules | — | Done |
| `StatusBadge` / `SeverityBadge` with a shape per tone; money statuses (`ISSUED PAID VOID PREPARED RELEASED SETTLED FAILED`) | grey fallthrough | every list | Done |
| `Alert`: only `destructive` is `role="alert"` | 22 static notes announced as errors | admin 22, facility 8, practitioner 6 | Done |
| `PageHeader` with `breadcrumbs`, `meta`; `EmptyState` with `action` | hand-rolled back links; empty states with no next step | 7 detail shells | Done |
| `ErrorState` + `describeError`, `FilteredEmpty`, `ListSkeleton`, `TableSkeleton`, `LoadingStatus` | 10+ generic alerts, four skeleton idioms | all consoles | Done |
| `Field` (label, hint, error, `aria-describedby`, `aria-invalid`) | five hand-wired attributes per input; 39 unbound selects | every form | Done |
| `FilterBar` (search always visible; filters in a sheet on phones; active count; Clear filters) | seven filter implementations | 7+ | Done |
| `DataTable` (table at `md+`, stacked cards below, `action` as the foot of the card) | tables with no phone layout | shifts, roster, invoices, 8 admin tables | Done |
| `ConfirmDialog` (object, consequence, reversibility; focus on Cancel when destructive) | ~10 hand-rolled reason dialogs | 10+ | Done |
| `Timeline` (state in shape and words) | six audit-history lists; timesheet revisions | 6+ | Done |
| `QueueAge` (age in words; "getting old", "overdue") | muted relative text | 9 queues | Done |
| `MetricTile`, `MetricGrid`, `AttentionList`, `DashboardSection` | three dashboards' tiles | 3 dashboards + finance + system | Done |
| `SuccessScreen` ("what happens next") | toast-only results | 12+ | Done |
| `Money`, `SubmittedVsApproved` | money in muted text; timesheet figures | timesheets ×3, invoices | Done |
| `useMediaQuery` | — | filter bar, tables | Done |
| `useCursorPager` + `Pager` | ten copies of two arrays and three handlers | shifts, audit trail, credentials queue, practitioners directory, timesheets | Done; unit-tested (`Newer`/`Older` labels for time-ordered lists) |
| `SelectField` | unbound `Select` | 39 | Covered by `Field`; per-site adoption in Phase 7 |
| `ReasonDialog` (ConfirmDialog + reason + counter) | hand-rolled | 10 | Phase 7 |

## 10. Priority classification

**Critical (fix first):** 4.1 failure-as-answer; 4.2 one-click irreversible decisions; unbound selects and page titles; wizard step names;
the dark-mode contrast on "Remove all access"; the `INFO_REQUESTED` typo. **Important:** everything marked Important above, in the
order of the sections. **Polish:** consistency, copy and small a11y items.

## 11. What could not be verified here

Real devices on 3G; a screen reader; Windows high-contrast mode; the effect of the browser's locale on date inputs;
`window.open` behaviour on iOS; HEIC photo rendering. The detailed files mark each "verify".

## 12. Claims re-checked in the code before being relied on

| Claim | Result |
|---|---|
| Finance totals default to 0 when the request fails (`finance/page.tsx:89-94`) | Confirmed |
| Incident severity sort is per page (`incident.ts:418-432`) | Confirmed |
| `credentials-tab.tsx:109` tests `INFO_REQUESTED`; the enum has only `MORE_INFO_REQUESTED` | Confirmed |
| Away blocks are rendered with no remove control; `DELETE /api/v1/availability/blocks/[id]` exists | Confirmed |
| `['my-excusals', id]` is a per-row query | Confirmed |
| `aria-describedby` does not appear in `src/` apps | Confirmed (0 in `.tsx` outside new components) |
| Sheet opened in 500 ms over `bg-black/80`; dialog close was 16 px | Confirmed (fixed) |
| The ~1,000 px roster table | Confirmed in the 390 px screenshot: Practitioner, Starts and part of Ends are visible; Attendance and Cancel are inside the horizontal scroll area |

## Appendix A. Content on the landing page that needs the owner's approval

The landing page claims only what the product does today. These statements are nevertheless *public statements* about the
pilot, verification, privacy and price, and should be approved by whoever owns them before launch:

1. "Medilink is being piloted." and "The product is still changing…" (pilot status).
2. "There is no published price. The platform fee on invoices is currently zero, and the revenue model has not been settled." — true of the code today
   (`PLATFORM_FEE_BP`, the Finance page's own note); a public statement about money.
3. "A fee would not be hidden. If one is introduced it will be its own line on the invoice, not folded into a rate." — a **commitment**, not a current fact.
4. "Practitioners are checked before they are offered work: identity, professional registration and credentials" — describes the officer review that exists;
   the blueprint records that four of five professions have no credential requirements seeded yet (Gap Reconciliation `CRE-` series). Legal/product to confirm the
   wording is not broader than what is true for every profession on launch day.
5. "A facility sees a practitioner's phone number only when it asks for it, and each time is recorded." — the code does this on the paths audited, but
   the facility console currently requests `include=contact` on three pages (4.5), which records a showing per visible row. The sentence is accurate about
   intent and the audit trail, and should be re-read against that behaviour before launch.
6. "Credential documents are opened only by authorised Medilink staff, and each opening is recorded." — see `credential.document_accessed`.
7. The FAQ answers (who can register, how checks work, offline check-in, contact).
8. No statistics, testimonials, partner logos, payment claims or regulator approvals appear anywhere on the page, because none exist to cite. The NDPC registration
   and data-protection-officer status are "not started" in the Gap Reconciliation; nothing on the page implies otherwise.
