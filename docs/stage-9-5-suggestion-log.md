# Step 9.5 — the suggestion log

Module 18. The pilot exists to find out what the specification got wrong, and
that only works if there is somewhere for the finding to go that is not a
WhatsApp message to the founder.

## Two sources

**Somebody typing one**, and **a decline reason from step 6.5**.

The second is the one that matters. `docs/stage-6-5-6-6-6-7-assignments.md`
has said since Stage 6 that "a decline requires a reason ... and the pilot's
suggestion log (step 9.5) is built from exactly this". Until now that was a
sentence in a document; `recordDeclineAsSuggestion` is the line that makes it
true. It runs **inside the decline's own transaction**, so a decline and its
suggestion are one write or neither.

**The practitioner is not recorded as the author of a derived suggestion.**
They were answering an invitation, not filing a suggestion. Attributing it
would put words in their mouth — and would put a candid decline reason under
their name in an operations queue, which is a good way to stop getting candid
decline reasons. The invitation id goes in `sourceRef`, so the two can still
be joined by somebody who needs to.

Its audit row has no actor either, for the same reason: nobody filed it. The
decline it came from is audited under its own actor.

Every derived suggestion is filed under `MATCHING`. A practitioner declining
an invitation is, by construction, telling you something about what you
offered and how; guessing a finer area out of free text would be inventing
data.

## A low bar to file, a real bar to close

Submitting needs ten characters and an area. The cost of a thin suggestion is
one row; the cost of a form that argues with people is every suggestion they
do not file.

Triage is asymmetric on purpose:

| Move | Response required? |
| --- | --- |
| `TRIAGED`, `PLANNED` | No |
| `DONE`, `DECLINED` | **Yes** |

Moving something along a queue is housekeeping. Telling somebody their
suggestion is finished with — because it was built, or because it will not be
— is an answer. **A declined suggestion with no reason is how a pilot teaches
people to stop bothering.**

Nothing is deleted and nothing is reopened. A closed suggestion stays closed;
changing your mind is a new suggestion, because the log's value is that it
records what people actually asked for and what they were actually told.

## The summary is the point

`GET /api/v1/suggestions/summary` returns counts by area with the open ones
separated. It is the single most useful view of a pilot log and the reason the
`area` column exists at all: a founder deciding what to fix next needs the
*shape* of the complaints, not the complaints themselves. "Eleven people have
now said the same thing about matching" is the finding.

## Two new permission keys

`suggestion.submit` and `suggestion.triage` are **the only keys this codebase
adds to Section 8.8's catalogue.**

No existing key fits. Submitting is something every signed-in user should be
able to do, and there is deliberately no "any authenticated user" permission —
the guard requires a permission *and* a scope for everything, which is the
property that makes the route table reviewable at all. Reusing an unrelated
key to avoid the addition would have made the table lie about what it
authorises, which is worse than a documented extension.

`suggestion.submit` is granted to `practitioner`, `facility_owner` and
`operations_officer`; `suggestion.triage` to `operations_officer` only.

## Routes

| Method | Path | Permission | Scope |
| --- | --- | --- | --- |
| POST | `/api/v1/suggestions` | `suggestion.submit` | `SELF` |
| GET | `/api/v1/suggestions` | `suggestion.triage` | `PLATFORM` |
| GET | `/api/v1/suggestions/summary` | `suggestion.triage` | `PLATFORM` |
| POST | `/api/v1/suggestions/:id/triage` | `suggestion.triage` | `PLATFORM` |

**No `FACILITY` scope anywhere**, and a test asserts it. A facility reading
every practitioner's complaints about it is not what anybody agreed to.

## Not in this step

- **Notifying somebody their suggestion was answered.** Module 16's job, and
  it needs the real SMS gateway (step 4.7) to be worth anything.
- **Feeding incidents or disputes into the log.** `SuggestionSource` has two
  values rather than four because only two things write to it today; adding a
  value nothing produces would be describing a feature rather than having one.
- **Themes or clustering.** The area counts are the whole of the analysis, and
  a pilot of fifty engagements does not need more.
