# Walking the demo

A guided tour of the seeded pilot, console by console. Every account below is
real, every number was read back out of the database after seeding, and every
screen named here has been opened as the person it is for.

If you only want the commands, they are in "Running it" in
[interfaces.md](interfaces.md). This page is about what to look at once it is
running, and what each thing is there to demonstrate;
[testing-by-role.md](testing-by-role.md) is the checklist version, with the
things to *do* as each role and what should happen.

```bash
docker compose up -d
docker compose exec web pnpm db:seed                    # vocabularies, once
docker compose exec web pnpm tsx scripts/seed-demo.ts   # the pilot
```

Sign in at <http://localhost:3000/login>. Every demo account shares the
password `Medilink-demo-2026`, and a number works in either form —
`+2348031200021` or `0803 120 0021`.

> The seed is re-runnable and clears its own work first, so you can always get
> back to this picture. It refuses to run unless `APP_ENV=local`.

> After editing any source file, `docker compose restart web` (and `worker`, if
> you touched a handler). Windows bind mounts do not propagate the file-change
> events Next's dev server watches for, so an edit is invisible to the
> container until it is restarted. This costs everybody an afternoon exactly
> once.

## The accounts

**Platform — `/admin`**

| Phone | Who | What they are for |
| --- | --- | --- |
| `+2348031200001` | Olufemi Adebayo-Cole | Super administrator; every permission |
| `+2348031200002` | Adaeze Nwachukwu | Operations: onboarding, disputes, suggestions |
| `+2348031200003` | Musa Ibrahim Danjuma | Compliance: credentials, facilities, incidents, audit |
| `+2348031200004` | Ifeoma Chukwuemeka | Finance: invoices, payouts |

**Aso Garden Specialist Hospital — `/facility`**

| Phone | Who | What they are for |
| --- | --- | --- |
| `+2348031200011` | Ngozi Okonkwo-Bello | Owner (Medical Director); everything, including adding staff |
| `+2348031200012` | Chinedu Eze | Administrator: facility details and staff |
| `+2348031200013` | Hauwa Abdullahi | Scheduler: shifts, matching, check-in codes |
| `+2348031200014` | Babatunde Salami | Accounts officer: timesheet approval, invoices |

**Practitioners — `/practitioner`**

| Phone | Who | The state they are in |
| --- | --- | --- |
| `+2348031200021` | Amina Yusuf | Cleared A&E doctor; **a shift in progress right now** |
| `+2348031200022` | Blessing Okoro | Cleared ICU nurse; a shift starting within the hour |
| `+2348031200023` | Tunde Bakare | Credentials submitted, awaiting compliance |
| `+2348031200024` | Ibrahim Lawal | One document rejected and resupplied, one queried |
| `+2348031200025` | Grace Adeyemi | Registered, no profile yet |
| `+2348031200026` | Emeka Nwosu | Sanctions screening match — blocked |
| `+2348031200027` | Kelechi Umeh | Suspended after a severe incident — **sign-in is refused** |
| `+2348031200028` | Yetunde Afolabi | Practising licence lapsed |
| `+2348031200029` | Samuel Garba | NIN name does not match the account |
| `+2348031200030` | Rukayat Adebisi | NMCN registration expired |

Twenty-nine more practitioners fill the pool from `+2348031200101` onwards, and
four more facility owners hold the other hospitals: `+2348031200041` (Adeola
Memorial, Lagos), `+2348031200043` (Dala Road General, Kano), `+2348031200045`
(a facility still awaiting verification) and `+2348031200046` (one that was
refused, with the reason on the record).

## What is in there

Sixteen weeks of a working hospital, built through the application layer rather
than inserted — the audit rows exist because the code that writes them ran, and
the ledger balances because `assertBalanced` refused anything that did not.

| | |
| --- | --- |
| Facilities | 3 verified, 1 awaiting verification, 1 refused |
| Practitioners | 39, of whom 34 are cleared to work |
| Shifts posted | 245 filled, 22 expired unfilled, 13 published, 5 cancelled, 1 draft |
| Offers | 271 accepted, 91 declined, 13 withdrawn, 11 still open |
| Assignments | 228 completed, 30 confirmed, 8 cancelled, 2 no-show |
| Attendance | 224 approved, 8 submitted, 5 checked out, 3 disputed, 1 checked in |
| Credentials | 87 verified, 5 pending, 2 expired, 1 queried, 1 rejected |
| Money | 5 invoices paid, 4 issued, 3 draft; 33 payouts settled, 7 prepared |
| Casework | 6 disputes (every status), 7 incidents, 6 unhonoured shifts, 2 excusals |
| Compliance | 2 suspensions (1 lifted, 1 standing), 5 data-subject requests |
| Underneath | 220 match runs, 481 check-in events, ~24,500 audit rows |

The flagship, Aso Garden Specialist Hospital in Abuja, carries 225 of the
shifts and 213 of the assignments. It runs ten departments — A&E, medical
wards, paediatrics, labour ward, theatre, ICU, pharmacy, laboratory, radiology
— across doctors, nurses, pharmacists, laboratory scientists and radiographers.
The other two hospitals exist so that scope isolation is something you can see
rather than something you take on trust.

## A tour, in the order that makes sense

### 1. The practitioner, because that is where the work starts

Sign in as **Amina Yusuf** (`+2348031200021`).

Her dashboard says she can be offered shifts, shows three offers waiting and
names her next shift. She is **checked in to a shift right now** — the seed
starts one three hours before you run it — so the scheduler can issue her
check-out code while you watch.

- **Offers** — real invitations with the rate and the hours, and a decline box.
  A decline with a reason becomes a suggestion; that is why the suggestion log
  has more rows than anybody typed.
- **Timesheets** — one shift is checked out and waiting for her to submit.
  Nothing is paid until she does, and the page says so.
- **My profile → Credentials** — six verified documents, each with the reviewer's decision.
- **My profile → Privacy** — she has deliberately *not* accepted the revised 2026 privacy
  notice, so the outstanding-agreement path is visible. Blessing has.

Then sign in as somebody who cannot work: **Emeka Nwosu** (`+2348031200026`)
sees a screening block, **Yetunde Afolabi** (`+2348031200028`) a lapsed
licence, **Grace Adeyemi** (`+2348031200025`) an incomplete profile. Each is
told which requirement is missing, not merely that they are ineligible.
**Kelechi Umeh** (`+2348031200027`) cannot sign in at all — that is a suspended
account behaving correctly, not a broken login.

### 2. The hospital

Sign in as the **scheduler**, Hauwa Abdullahi (`+2348031200013`).

- **Shifts** — thirteen published, one draft, and a shift for tonight marked
  EMERGENCY with offers out to the three best-ranked candidates.
- Open a shift and run **Find staff**. The matcher ranks by specialty,
  proximity, availability, fatigue and reliability, and — more usefully — it
  explains every exclusion. One practitioner is on annual leave that week, so
  she comes back "blocked" rather than "does not work Tuesdays".
- **Roster** — who is on, and the check-in codes. Issue one for Amina's shift
  in progress and watch the attendance record move.

Then the **accounts officer**, Babatunde Salami (`+2348031200014`): the
Timesheets queue holds submitted shifts with hours, night premium and the
amount, and the Approve / Reject / Correct actions behind them. Reject one and
it comes back with the reason attached; correct it and the revision is kept.

Then the **owner**, Ngozi Okonkwo-Bello (`+2348031200011`): invoices for the
hospital, two rate cards (the 2026 one was superseded in July, so June's
invoice and September's are priced on different terms), and the incidents the
hospital has filed.

Worth trying: sign in as the **administrator** (`+2348031200012`) and notice
how much less of the console exists for them. That is the permission filter,
not a loading failure.

### 3. The platform

Sign in as **compliance**, Musa Ibrahim Danjuma (`+2348031200003`).

The dashboard opens with what is waiting and how long it has been waiting —
five credentials to review, a facility to verify, three open clinical incidents,
two shifts awaiting a fault decision. Everything on it is clickable through to
the queue behind it.

- **Credentials** — a real queue, including one practitioner who was asked for
  a better scan and sent one back.
- **Facilities** — Crystal Diagnostics is waiting; Goodlife Clinic was refused
  because the name on the CAC certificate did not match the operating licence,
  and the reason is on the record where its owner can read it.
- **Clinical incidents** — four closed, one under review, two new. One closure
  suspended a practitioner and the suspension stands; another suspended
  somebody, found the fault was a storage-and-labelling problem rather than
  theirs, and reinstated them. Both halves are on the record, which is the
  point.
- **Unhonoured shifts** — six shifts nobody attended, four with fault decided,
  one with the practitioner's excusal awaiting an answer, one untouched so the
  queue is not empty.
- **Audit trail** — around 24,500 rows, every one written by the code that did
  the thing.

Then **finance** (`+2348031200004`) for invoices and payouts, and **operations**
(`+2348031200002`) for disputes and the suggestion log. The disputes cover every
status the product has: open, under review, upheld, dismissed, withdrawn, and
one raised by the hospital rather than the practitioner.

## What is deliberately not there

- **The sanctioned-entry list is fictional.** Two entries exist purely so that
  screening has something to match: one is a genuine folio match that stays
  flagged, and one is a name-only collision that a compliance officer cleared
  in writing. `prisma/seed.ts` still ships an empty real list, because an
  invented one that reports "clear" is worse than none.
- **No external provider is called.** SMS, NIMC identity checks and payments
  are stubs; the seed records verification as an officer doing it by hand,
  which is the path that exists.
- **Documents are blank single-page PDFs.** Credential evidence is somebody's
  medical record, so the demo must not contain anything resembling one.
- **Screening flags have no console yet.** The rule works and the flag is
  raised, but there is no screen for an officer to answer it from, so the
  flagged practitioner stays flagged. It is the one queue in the product with
  no surface.
