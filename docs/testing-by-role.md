# Testing it yourself, role by role

A hands-on test plan. Every account, every console, and what you should see at
each step — written so somebody who has never opened this product can work
through it and know whether it is behaving.

[demo-walkthrough.md](demo-walkthrough.md) is the tour ("what is in here").
This is the checklist ("does it work").

---

## Before you start

```bash
docker compose up -d
docker compose exec web pnpm db:seed                    # vocabularies, once
docker compose exec web pnpm tsx scripts/seed-demo.ts   # the pilot, re-runnable
```

<http://localhost:3000/login>. One password for every demo account:
`Medilink-demo-2026`. A phone number works in either form — `+2348031200021`
or `0803 120 0021`.

> **After you change any source file, restart the container before testing it.**
>
> ```bash
> docker compose restart web      # and `worker` too, if you changed a handler
> ```
>
> Windows bind mounts do not deliver the file-change events Next's dev server
> watches for, so an edit is invisible to the running container until it is
> restarted. The symptom is the old behaviour persisting after a correct fix,
> which is maddening if you do not know it.

**To get back to a clean picture**, re-run `scripts/seed-demo.ts`. It clears its
own work first, so you can break things freely.

---

## Registration: where the SMS code comes from

Locally there is no SMS gateway. `.env` sets `SMS_PROVIDER=console`, and that
adapter **prints the whole message, code included, to the web container's log**.
It is the only way to read a code locally, and it is deliberately fenced: the
adapter throws on startup if `APP_ENV` is anything but `local`, so a
misconfigured staging deploy cannot quietly write every signup code into a log
aggregator.

**Register through the UI:**

1. <http://localhost:3000/register> → enter a name and a phone number, submit.
2. In a terminal, read the code:

```bash
docker compose logs web --tail 20 | grep -A1 "sms:console"
```

You will see exactly this:

```
web-1  | [sms:console] to=+2348055550001
web-1  | 501552 is your code to verify your Medilink number. It expires in 10 minutes. Do not share it.
```

3. Type those six digits into the verify step, then set a password, then sign in.

Codes expire in **10 minutes**; "Resend code" issues a fresh one and prints it
the same way. **Password reset** uses the identical path — request the reset,
read the code out of the same log.

Use a phone number outside `0803 120 0xxx`, which the seed owns. `0805 555 xxxx`
is free and on the platform's prefix allow-list.

> **Going live needs an adapter written.** `SMS_PROVIDER` also accepts `termii`
> and `africastalking`, but both are placeholders that throw
> `SmsNotConfiguredError` — the interface is there and the implementation is
> Stage 4.7. Nothing else has to change when one lands: every caller goes
> through `smsAdapter()`.

**What a fresh registration gets you:** an account with status `UNDER_REVIEW`,
the practitioner role, and no profile. That is correct — see the onboarding
walk below for how it becomes able to work.

---

## 1. Practitioner — `/practitioner`

### 1a. Somebody who can work

Sign in as **Amina Yusuf**, `+2348031200021`.

| Do this | You should see |
| --- | --- |
| Land on the dashboard | "You can be offered shifts", offers waiting, next shift |
| **Offers** | Open invitations with rate, hours and facility; Accept and Decline |
| Decline one, *with a reason* | It leaves her list — and the reason lands in the platform's suggestion log (sign in as operations later and look) |
| **My shifts** | A shift in progress right now — she is checked in and not yet out |
| **Timesheets** | One shift ready to submit, with an info banner saying nothing is paid until she does. Submit it |
| **My profile → Credentials** | Six verified documents, each with the reviewer's decision |
| **My profile → Availability** | A weekly pattern plus one booked block of leave |
| **My profile → Privacy** | The 2026 privacy notice shown as **not yet accepted** — accept it, and the badge clears |

Then sign in as **Blessing Okoro**, `+2348031200022`: a shift starting within
the hour, and one timesheet already submitted and waiting on the hospital. Her
privacy notice is already accepted — that asymmetry with Amina is deliberate,
so you can see both states.

### 1b. Everybody who cannot work, and why

Each of these should tell the person *which requirement* is missing, not merely
that they are ineligible.

| Sign in as | Phone | Expect |
| --- | --- | --- |
| Tunde Bakare | `+2348031200023` | Credentials submitted, awaiting review (3 blockers) |
| Ibrahim Lawal | `+2348031200024` | One document queried, one rejected and resupplied |
| Grace Adeyemi | `+2348031200025` | No profile yet — the first thing to do is create one |
| Emeka Nwosu | `+2348031200026` | Blocked by a sanctions screening match |
| **Kelechi Umeh** | `+2348031200027` | **Sign-in refused.** This is correct: he is suspended |
| Yetunde Afolabi | `+2348031200028` | Practising licence lapsed (2 blockers) |
| Samuel Garba | `+2348031200029` | NIN name does not match the account |
| Rukayat Adebisi | `+2348031200030` | NMCN registration expired |

### 1c. The whole onboarding walk (worth doing once)

1. Register a new practitioner (above) and sign in.
2. Create a profile — category, specialty, years, home state/LGA, how far they
   will travel.
3. Set availability.
4. Submit credentials. Some types want a **document** (upload a PDF), some want
   a **reference number** — the form asks for whichever the type requires.
5. Sign in as **compliance** (`+2348031200003`) and: verify their identity,
   record their professional registration, approve each credential.
6. They are still `UNDER_REVIEW` until the activation sweep runs. It runs
   hourly; to not wait:

```bash
docker compose exec -T db psql -U medilink -d medilink \
  -c "update audit.scheduled_jobs set next_run_at = now() - interval '1 minute' where key = 'practitioner.activation_sweep';"
```

7. The worker picks it up on its next poll — about a minute — and promotes them
   to `ACTIVE`. Confirm it ran:

```bash
docker compose logs worker --tail 20 | grep practitioner.activation_sweep
docker compose exec -T db psql -U medilink -d medilink   -c "select key, last_status, last_run_at, run_count from audit.scheduled_jobs where key = 'practitioner.activation_sweep';"
```

   The worker logs `scheduled job succeeded` with the `jobKey` every time,
   whether or not it changed anything; a sweep that *did* something logs its own
   line as well (`practitioner activation sweep ... activated: 1`). If you are
   waiting on a log line, grep for the job key rather than the prose.

That step-6 trick works for **any** sweep: `screening.sweep`,
`credential.expiry_sweep`… see `docs/scheduled-jobs.md` for the full list.

---

## 2. The hospital — `/facility`

All four accounts below belong to **Aso Garden Specialist Hospital**, which
carries most of the seeded history.

> **The facility roles merged.** There used to be a scheduler, an accounts
> officer and an administrator with three different slices of the job. There
> are now two roles: **facility administrator**, who does all of it, and the
> **owner (MD)**, who does that plus adding staff and answering disputes.
> The four accounts below still exist and still have their own phone numbers
> — Hauwa, Babatunde and Chinedu simply all hold `facility_administrator` now
> and see the same console. Signing in as two of them and finding the same
> screens is the point.

### 2a. Hauwa Abdullahi — `+2348031200013` (facility administrator)

The person who runs the rota. This is the richest console.

| Do this | You should see |
| --- | --- |
| **Shifts** | Thirteen published, one draft, one marked EMERGENCY for tonight |
| Open a published shift → **Find candidates** | A ranked list *with reasons*: specialty, proximity, availability, fatigue, reliability |
| Look at the excluded list | Every exclusion is explained. One practitioner is on leave, so she reads "blocked", not "does not work that day" |
| Select two and **Offer** | Invitations created; the practitioners see them under Offers |
| When somebody accepts → **Confirm** | An assignment. The request closes to FILLED once headcount is met |
| **Roster** | Who is on. Issue a **check-in code** for a shift |
| Hand that six-digit code to the practitioner | They present it; attendance moves to CHECKED_IN. Do it again at the end for CHECKED_OUT |
| Network down? **Record attendance manually** | Requires a written reason, and is marked `MANUALLY_CORRECTED` so nobody mistakes it for a code-backed check-in |

### 2b. Babatunde Salami — `+2348031200014` (facility administrator)

| Do this | You should see |
| --- | --- |
| **Timesheets → awaiting decision** | Submitted shifts with worked hours, night premium and the amount |
| **Approve** one | The assignment completes; the money becomes payable |
| **Reject** one | A reason is required — without it the practitioner has nothing to correct |
| **Correct the hours** | Ask for the corrected figures and a reason; the original stays readable as a revision |
| **Timesheets → approved** | ~170 completed shifts, fifty to a page, with Previous/Next |
| **Invoices** | This hospital's invoices, draft through paid |

### 2c. Owner / MD — `+2348031200011` (Ngozi Okonkwo-Bello)

Everything above, plus:

- **Rates** — two rate cards. The 2026 one was superseded in July, so June's
  invoice and September's are priced on different terms. Create a third and
  watch the current one become SUPERSEDED.
- **Incidents** — report one against a shift; it lands in compliance's queue.
- **Staff** — grant a colleague `facility_administrator`. An owner can grant
  any role they themselves hold, and is refused anything more — try granting
  a platform role and you should be told you cannot escalate. `role.grant` is
  the owner's and not the administrator's, so this screen is the one thing
  Hauwa and Chinedu cannot do.

### 2d. Chinedu Eze — `+2348031200012` (facility administrator)

Deliberately narrow: facility details, staff, and a read-only view of shifts.
**The test here is what is *absent*** — no Publish, no Cancel, no New shift, no
Find candidates. If you see a button this role cannot use, that is a bug.

---

## 3. The platform — `/admin`

> **The platform roles merged too.** Operations, compliance and finance are
> one **administrator** role. Adaeze, Musa and Ifeoma keep their numbers and
> now see the same console — twenty-one permissions between onboarding,
> verification, casework and money, including appointing other staff.
>
> The only thing a super administrator has that they do not is
> `config.manage`: the controlled vocabularies and the rate floors. That one
> key is also what stops an administrator promoting themselves, and it is
> worth testing deliberately — sign in as Musa, re-enter your password when
> asked, and try to grant somebody `super_administrator`. You should be told
> **"You cannot grant a permission you do not hold yourself."** Granting
> `administrator` to the same person succeeds. Nothing hard-codes that rule;
> it falls out of `grantRole` refusing to hand out what the granting actor
> has not got.
>
> The same holds in reverse. Open **Staff** as Musa and try to revoke
> Olufemi's `super_administrator` grant: **"You cannot revoke
> super_administrator at platform scope - it carries permissions you do not
> hold yourself."** Revoking another *administrator* works, because they are
> peers - and removing an equal is not an administrator's to do either:
> **"they hold exactly what you hold... ask a super administrator."** Only a
> super administrator can remove a platform administrator.
>
> An administrator *can* still revoke a practitioner, even though a
> practitioner holds `timesheet.submit` and no administrator does - the rule
> only applies to PLATFORM grants, because that is where authority lives;
> below it, those are capabilities over somebody's own record.
>
> One more worth trying as the super administrator: revoke the *other* super
> administrator, which works, and then try to revoke yourself. You should be
> stopped - **"This is the only account left that can appoint another."**
> Without that, two super administrators could remove each other down to
> zero and the platform would need a database edit to recover.

### 3a. Musa Ibrahim Danjuma — `+2348031200003` (administrator)

The dashboard opens with what is waiting and how long it has been waiting.
Every tile clicks through to the queue behind it, and the count should match.

| Queue | Seeded with | Do this |
| --- | --- | --- |
| **Credentials** | 5 pending | Approve one, reject one with a reason, ask for more information on a third |
| **Facilities** | 1 awaiting verification | Verify Crystal Diagnostics, or refuse it with reasons |
| **Clinical incidents** | 2 new, 1 under review | Begin a review, then close it with an outcome. Closing with `PRACTITIONER_SUSPENDED` suspends the account — check they can no longer sign in |
| **Unhonoured shifts** | 6, one with an excusal pending | Decide fault: practitioner, facility or neither. A granted excusal cannot be practitioner-fault |
| **Data requests** | 2 open | Complete an access request; try the open erasure one and see the blockers it reports |
| **Audit trail** | ~24,500 rows | Filter it. Every row was written by the code that did the thing |
| **Practitioners** | 39 | Open one and read their eligibility blockers, credentials and verification |

### 3b. Adaeze Nwachukwu — `+2348031200002` (administrator)

- **Disputes** — six, covering every status the product has. Begin a review,
  then resolve one as upheld and one as dismissed. Both need an outcome *and*
  notes; "resolved" with no outcome tells the loser nothing, and is refused.
- **Suggestions** — the written ones plus every decline reason a practitioner
  gave. Triage them. Marking one DONE or DECLINED **requires a response**;
  moving it along the queue does not.
- **Facilities** — onboard a new one.

### 3c. Ifeoma Chukwuemeka — `+2348031200004` (administrator)

- **Invoices** — generate one for a facility and a month, issue it, record
  payment. Each step writes balanced double-entry ledger rows.
- **Payouts** — prepare a practitioner's payout, then release it. The gateway
  is a stub and says so in the log: `[payments] STUB — no money moved`.
- Look up a practitioner by name to pay them — that lookup is why this role
  holds `practitioner.profile.read`.

### 3d. Super administrators — `+2348031200001` and `+2348031200005`

There are three (the seed also makes one at `+2348031100003`), and the number
is deliberate. Only a super administrator may remove a super administrator,
and `revokeGrant` refuses to remove the last holder of `config.manage` — so
with two, removing either leaves a survivor who cannot themselves be replaced
if they lose their phone. Three is the smallest number where somebody can
leave, be removed, and there is still a spare.

Holds everything. Useful as a control: if a page is broken for this account, it
is broken for everyone, not a permission problem.

---

## 4. Scope isolation — the tests worth doing deliberately

These are the ones that matter most, because a failure here is a data breach
rather than an inconvenience.

1. **One hospital cannot see another's work.** Sign in as the Lagos owner
   (`+2348031200041`) and confirm you see only Adeola Memorial's shifts,
   assignments, invoices and incidents — never Aso Garden's.
2. **One practitioner cannot see another's.** Amina must not be able to reach
   Blessing's timesheet, attendance or profile. *(Closed on 2026-09-29 — it was
   possible by naming another person's assignment id; there are now four
   regression tests in `tests/integration/timesheets.test.ts`.)*
3. **A suspended account cannot sign in** — `+2348031200027`.
4. **A facility that is not verified cannot publish.** Sign in as
   `+2348031200045` and confirm the reason is visible and accurate.
5. **A refused facility is told why** — `+2348031200046`.
6. **Nobody can grant what they do not hold.** As a facility owner, try to
   grant a platform role.

The automated versions of all of this:

```bash
docker compose exec web pnpm test              # 525 unit
docker compose exec web pnpm test:integration  # 431 integration, separate database
```

---

## 5. Known gaps — do not chase these

Not bugs to report; they are not built yet.

- **No real SMS, NIMC or payment gateway.** All three are stubs by design until
  credentials exist.
- **Documents are blank one-page PDFs.** Credential evidence is somebody's
  medical record; the demo must not contain anything resembling a real one.
- **The on-call multiplier cannot be set below 1.0×.** Pricing treats on-call as
  a fraction of the rate, the rate-card rule floors every band at par. Which is
  right is a pricing decision still to be made.

Closed since this list was first written, and worth testing once:

- **Screening flags** are answered on the practitioner's page in
  **Practitioners** → *Sanctions screening*: compare the matched entry, then
  clear it with a reason. Emeka Nwosu is the seeded case.
- **A queried credential can be answered.** After *Ask for more*, the
  practitioner's credential card offers *Send what the reviewer asked for*.
- **Staff** pages exist in both consoles (owner: *Staff*; platform: *Staff*),
  each behind a password re-check.
- **Excusals** are asked for from the practitioner's *My shifts* (on a shift
  that ended with no check-in) and decided on the unhonoured shift's page.
- **Suspensions** are lifted from the practitioner's page in **Practitioners**.
- **Terms and notices** are published from *Terms and notices* (super
  administrator); hospital staff accept facility terms from their dashboard.
- **Staff sign-ups** (`/register?as=facility`, `/register?as=staff`) no longer
  receive the practitioner role.
