# Design audit — Phase 2 (dashboards and flows)

Method as in Phase 1: the demo database, the running app, the three console homes and the shift pages at 360, 768 and 1280 px,
the code behind each. Ranked by user impact ÷ effort. IDs refer to `docs/blueprint/Gap-Reconciliation.md`.

| # | Problem | Where it shows | Fix | ID |
| --- | --- | --- | --- | --- |
| 1 | The pilot's main work item, practitioners waiting for approval, has no tile and no age on the operations dashboard. | `/admin` | A first tile with the count and the oldest wait; counted into the headline. | UXO-07 |
| 2 | A new facility lands on three tiles reading zero and a verification banner, with no hint of what to do first. | `/facility` | A checklist of the steps that can be known (licence, verified, rates, first shift), hideable, gone when done. | UXF-16 |
| 3 | The facility's numbers say how many, never which: "13 published" gives no way to see the one that starts tonight. | `/facility` | "Shifts still to fill", soonest first, and "Today on the floor" with arrival status. | — |
| 4 | A shift page shows a status badge and nothing about whose move it is. | Facility shift page, My shifts | One six-step lifecycle, with "Your turn" or who it is waiting for. | — |
| 5 | The three dashboards each draw their own tile, with different padding, sizes and error handling. | All three homes | One `StatTile`; one `NeedsBanner` headline. | — |
| 6 | A practitioner is told when they work but not when they are paid. | `/practitioner` | An "Owed to you" tile, from the same request the earnings page makes. | UXP-10 |
| 7 | The Publish button is disabled with no reason given, and "ends before it starts" shows only after the fact. | Publish a shift | Errors beside the field, and "Still to fill in: …" beside the button. | — |
| 8 | A long dialogue or wizard on a phone scrolls its own Next/Submit button out of reach; the dialogue's close target is 16 px. | Every dialogue, the setup wizard | Sticky footer on phones; 44 px close target. | UXA-02 |
| 9 | With no signal a request fails as "Something went wrong". Nothing says the phone is offline, and a retry of a change might duplicate it. | Everywhere | A connection banner; a message for an unreachable request that says to look before repeating a change. | UXA-09 |
| 10 | Photographs from a phone camera upload at full size over a weak connection. | Every document upload | Redrawn at 2000 px, re-encoded, before sending; PDFs and anything undecodable go as they are. | UXA-10 |

Not in this phase, on purpose: a bottom tab bar for phones (the menu drawer was fixed in Phase 1 and the dashboards now
carry the daily actions), automatic retry of failed changes (the API has no idempotency key, so a blind retry could record
a payment or a shift twice), "recent activity" on the facility and practitioner homes (no endpoint for it, and none was
added), and a default rate for a shift (a product decision, UXF-09).

## Outcome

All ten were addressed. Also found and fixed while scanning with axe:

- The text-size buttons' accessible names did not contain their visible text ("A+"), so voice control could not reach them.
- On the sign-in and register pages the text-size control sat on top of the teal panel with dark text: contrast 2.2:1.
- The teal panel's secondary text was 4.0:1; now 90 % white.

Axe (`tests/e2e/a11y.spec.ts`) now scans the landing page, sign-in, register, contact and the three console homes (the
consoles in light and dark) and fails the run on any serious or critical finding. It passes on the production build.

Found while building the dashboard, not caused by it: the assignments endpoint reads a date-only `to` as midnight at the
start of that day, so `from=D&to=D` returns nothing (checked against the API). The dashboard asks for the Lagos day as two
instants instead. The roster page's date filter sends date-only values to the same endpoint and so probably has the same
quirk for a one-day range; that was not checked in the page and was left alone.
