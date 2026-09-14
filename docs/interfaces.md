# The three consoles

Until Stage 9 this repository had 75 API routes and one page. It now has
three consoles, one per job, because the three jobs are genuinely different:
operations works queues, a facility creates work, a practitioner does it.

| Console | Path | Who |
| --- | --- | --- |
| Operations | `/admin` | Compliance and operations officers, at `PLATFORM` scope |
| Facility | `/facility` | Schedulers and ward managers, at `FACILITY` scope |
| Practitioner | `/practitioner` | Everybody else, at `SELF` scope |

Which one somebody can use is decided by the grants on their account, not by
which link they follow. Every page behind them refuses a caller who does not
hold the permission — the console hides a control as a courtesy, never as a
control.

## How it is put together

**shadcn/ui, hand-written rather than CLI-generated**, because the generator
wants network access to a registry and the components are small enough to own.
`components.json` records the configuration so `npx shadcn add` works later.

**The palette is warm rather than slate.** These pages sit under a lot of
clinical white, and a cold grey next to white reads as an unfinished
wireframe. `--success`, `--warning` and `--info` are named for what they mean
rather than what they look like, so a badge and a chart cannot disagree.

**`StatusBadge` maps a status word to a colour in one place.** Every module
has its own enum and several share words — `APPROVED` means one thing in
credentials and another in timesheets — but they always mean the same *kind*
of thing. A reader scanning three queues should not relearn the palette on
each.

**React Query, with retry off for anything the server refused on purpose.**
Retrying a 403 three times does not turn it into a 200; it makes a queue feel
broken and puts three refusals in the audit log instead of one.

**Skeletons rather than spinners.** A queue that flashes "Loading…" and then
jumps to eight cards is a queue that moves under the cursor.

## What the interface says that the API cannot

The API refuses; only a screen can explain. These are deliberate and are the
reason the pages are not a generic CRUD skin:

- **Eligibility lists every blocker by name.** It is the only question that
  matters to a practitioner not being offered work, and "ineligible" alone
  makes support the only way to find out why.
- **Accepting an offer is not being confirmed**, said on the card. A
  practitioner who thinks they have a shift when they do not is how a ward
  ends up short at 6am.
- **A decline reason reaches the platform without the practitioner's name**,
  said next to the box. Otherwise the honest answer — "the rate is too low" —
  is the one nobody gives.
- **Night and holiday hours carry no premium yet**, said on the timesheet.
  Somebody reading a night figure will reasonably expect it to be worth more.
- **The three fault options each carry their consequence**, and only one marks
  a practitioner's record. An officer clicking through a queue should not have
  to hold that in their head.
- **`SYSTEM_ISSUE` is the first incident outcome offered**, and near miss the
  first severity. A blame-first process never reaches either, and a form that
  demands a practitioner's name teaches people to find one.
- **Match candidates show their factors**, not just a score. Step 9.4 requires
  every match reviewed by hand for the first fifty engagements, and a reviewer
  given only "82" has nothing to review.
- **Correcting a timesheet says what it does before you do it** — the previous
  figures become a revision, nothing is overwritten.

## Charts

Two, on the finance overview, and no more. Most of what finance needs is a
single number — what is outstanding — and a headline is the honest form for a
headline; the charts answer what a number cannot, which is whether the balance
is growing and where it is sitting.

The series colours are slots 1 and 2 of a validated categorical palette, in
fixed order and never cycled. Both modes pass every check — lightness band,
chroma floor, colour-vision separation, normal-vision separation and contrast
against their own surface — and the dark values are the same hues re-stepped
for a dark ground rather than an automatic flip. The exact hexes that ship
were re-validated after the HSL conversion, not assumed from the source
palette.

The "who owes what" chart is a single series, so it carries one hue and no
legend: the facility names on the axis are the identity, not the colour. Every
figure on both charts also appears in the table beneath them, so the page is
readable without colour at all.

## The audit trail has no filter by actor

It answers "what happened to this record". A console that made it easy to ask
"what has this person been doing all week" is a surveillance tool wearing a
compliance badge. The omission is the design.

## What is not wired up

- **Uploading a credential document.** The signed-URL flow exists on the API
  and the screen says a reviewer may ask for the file. A file picker that
  silently did nothing would be worse than none.
- **Rates and billing**, which are Stage 8 and blocked on a business decision.
- **Offline capture.** A PWA queueing writes is a client concern and is not in
  this stage.

## Running it

```
docker compose up -d
docker compose exec web pnpm tsx scripts/bootstrap-demo.ts
```

Then <http://localhost:3000>. The bootstrap prints every demo account; they
share one password, which is printed with them and is not a secret.

**After adding a route segment, restart the web container** — Next does not
always pick up a new folder, and the symptom is a 404 on a page that exists.
