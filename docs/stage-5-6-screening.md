# Stage 5.6 — sanctioned and quack-list screening

Implements step 5.6: screening at registration **and** on a schedule, so that
a listed practitioner is flagged and cannot be matched.

## The governing asymmetry

A false positive costs a compliance officer five minutes. A false negative
puts a struck-off practitioner on a ward.

Every judgement in `src/modules/practitioners/domain/screening.ts` is
therefore deliberately loose — it matches more than it strictly should, and a
person answers the flags. The design work went into making a flag *answerable*
rather than into making matching precise.

## Model

`config.sanctioned_entries` — the list, seeded **empty** with Compliance as
its named owner. `practitioners.screening_results` — one row per practitioner:
`status`, `matchedEntryId`, `matchedOn`, `screenedAt`, `clearedBy`, `notes`.

The list is in `config` because it is compliance-owned reference data like
credential types and rate floors.

## Decisions worth knowing

**Names are normalised by sorting their words.** "Amina Yusuf" and "Yusuf
Amina" are the same person. Nigerian names are routinely written in either
order, and a screening list that missed the reversal would be defeated by
filling the form backwards.

Titles are dropped (they carry no identity and are written inconsistently),
punctuation is stripped, and single letters are dropped so an initial cannot
decide a match either way.

**A folio match is checked first and reported as such.** It is the stronger
signal — somebody re-registering under a new name is exactly what it catches —
and telling a reviewer *which* field matched saves them wondering whether two
people simply share a name.

**`PENDING` is not `CLEAR`.** It means nobody has looked, which is not the
same as looking and finding nothing. `isScreeningClear` accepts only `CLEAR`,
and the eligibility rule in 5.8 refuses the rest.

**A cleared near-miss is not re-flagged by the next sweep.** Two people
sharing a name is common, so a flag has to be answerable — otherwise the
officer's answer means nothing and the nightly sweep undoes their work. A
clearance answers *one entry*: a match against a different entry flags again.

**Only a change writes an audit row.** A nightly sweep over every practitioner
would otherwise write one row per person per night, and the trail that matters
would drown in it.

**The list ships empty, on purpose.** The real lists are MDCN's to publish and
compliance's to transcribe. An invented one would be worse than none, because
a screening step matching nothing real still reports "clear" and looks like it
worked.

**The sweep is not paginated.** The pilot is fifty practitioners, and a sweep
that is simple and obviously correct is worth more at that size than one that
is fast. It needs paging before it is thousands, and the comment in
`screenAllPractitioners` says so.

## Not in this stage

- **A compliance tool for editing the list.** Entries go in through the seed
  or the database today. `config.manage` exists as a permission and no route
  uses it yet.
- **Fuzzy matching** — no edit distance, no phonetic matching. Sorted exact
  tokens plus folio is the whole of it. Anything looser needs a real list to
  tune against.
- **Date of birth or state of origin** as corroborating fields, which would
  let a reviewer dismiss a same-name match faster. Nothing stores them yet.
- **Blocking matching.** This raises the flag; the eligibility rule in 5.8 is
  what stops a flagged practitioner reaching a shift.

## Verifying it locally

```
docker compose exec web pnpm test
docker compose exec web pnpm test:integration
```

`tests/integration/screening.test.ts` seeds a listed name, runs the sweep
through the scheduler, and asserts the account is flagged — step 5.6's stated
verification. It also covers the reversal, the folio match, the clearance and
the re-flag on a new entry.
