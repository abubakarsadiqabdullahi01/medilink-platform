# Does the money add up

Written for whoever is on the Finance page when it says something does not. The rules are in
`src/modules/billing-settlement/domain/reconciliation.ts`; `reconciliation.test.ts` holds this
page to them, so a kind or a threshold cannot change without this changing.

## What it is

The ledger is built so that it must add up: every transaction sums to zero, an invoice posts what
it is for, a payout moves two entries when it settles and none otherwise. Nothing used to check
that after the moment it was written. This checks it, from the ledger and from the invoices and
payouts that point at it.

- **Where you see it.** A card on the Finance page, worked out as the page opens. And a nightly
  job, `billing.reconciliation_sweep`, which fails when anything does not add up: the job shows as
  failed on System health with the kinds of break in its reason, and the run logs `reconciliation_break`
  with the ids and amounts (never a name). A clean run logs `reconciliation_clean`.
- **It changes nothing.** A finding is not stored. It is worked out again each time, so it is
  always about now and it goes away on its own when the cause is put right.
- **It is not an alert that wakes anybody.** There is no alert channel yet (`X02-05`). Until there
  is, a break is noticed by somebody looking at the card or at System health.

## What it checks, and what to do

| Kind | It means | First thing to do |
| --- | --- | --- |
| `transaction_unbalanced` | One transaction's entries do not add up to nothing. The ledger refuses to write one like that, so something wrote around it. | Find who: the audit trail around the time of the entries. Do not edit the ledger. Correct it with a reversing transaction. |
| `ledger_not_zero` | Every entry in the ledger together does not come to nothing. | As above. It usually comes with a `transaction_unbalanced`. |
| `cash_negative` | More cash has been recorded leaving than ever arrived. | Look at the payouts settled against cash that was never recorded arriving. |
| `facility_overpaid` | A facility has paid more than it was billed. | Look for a payment recorded twice or against the wrong invoice. |
| `practitioner_overpaid` | A practitioner has been paid more than they earned. | Look at their settled payouts against the invoices they were credited from. |
| `invoice_lines_differ` | An invoice's live lines do not come to its total, or a void invoice still has live lines. | A line was changed or voided outside the application. |
| `invoice_ledger_differs` | What the ledger shows for an invoice does not match its status: owed when issued, paid when paid, nothing when void. | Compare the invoice's entries with its history on the audit trail. |
| `payment_amount_differs` | A paid invoice's recorded payment is not its total. Part payments are not modelled, so it should always be. | The recorded amount was changed. |
| `payout_entries_differ` | A settled payout does not have its two entries, or a payout that is not settled has entries. | A settled one with none is money out unrecorded: the practitioner now looks owed it again. Do not prepare another payout for them until it is explained. |
| `payout_unanswered` | With a gateway in charge, a released payout has had no answer for more than 60 minutes. The process probably stopped after claiming it. | **Ask the gateway whether the money moved before doing anything else.** Do not release it again. |
| `payout_transfer_unrecorded` | Released to be paid by hand more than 3 days ago and no transfer has been recorded. | Finance records the transfer with the bank's reference, or fails the payout with the reason. |

## The two thresholds

Neither is a number anybody has decided. They are starting points that err towards looking, to be
replaced by what finance says is late.

- **60 minutes** for a gateway to answer a released payout. A gateway answers in the same request.
- **3 days** for finance to record a transfer it was asked to make by hand.

## What it does not do

- **It does not read a bank statement or a provider's report.** There is no such feed, so money
  that arrived and was never recorded cannot be found here, and a payment recorded for an amount
  the bank did not receive cannot either. This is `BIL-33`, and it is the part of reconciliation
  that needs the provider (`D04`) and finance's process to exist first.
- **There is no month-end close and no correction of a statement.**
- **There is no queue to work through.** A finding has no owner and no "resolved" state. It is on
  the card until the numbers agree.
- **It lists at most 500 unbalanced transactions.** If there are 500, there are at least that many.
- **A write made outside the application that keeps every sum right** (moving an amount from one
  facility to another, say) is not a break in anything this checks.
