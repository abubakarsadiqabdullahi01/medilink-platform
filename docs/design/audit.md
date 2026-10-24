# Design audit — Phase 1 (foundations and shell)

Method: the demo database was seeded, the app run, and the key screens of all three consoles, the landing page, login,
register and 404 were screenshotted at 360, 768 and 1280 px, light and dark. The code behind each screen was read.
The ten problems below are ranked by user impact ÷ effort. IDs refer to `docs/blueprint/Gap-Reconciliation.md`.

| # | Problem | Where it shows | Fix | ID |
| --- | --- | --- | --- | --- |
| 1 | Chart axis labels are cut off: "000,000" and "6000" lose their leading digits. Widths were set for 12 px text; ticks are now 16 px. | Facility dashboard spend chart, operations growth chart, finance charts | Compact naira ticks (₦1.5M), wider axes | — |
| 2 | On a phone the console name is cut to three letters ("Prac…", "Ope…") because five controls share a 360 px header. | Every console, phone | Theme and text size move into the account menu on phones | — |
| 3 | Theme is applied after first paint (a flash) and the system setting is ignored. | Every console, every reload | A tiny pre-paint script, console routes only; system preference as the default | UXA-13 |
| 4 | Deep pages light up no menu item, and each one invents its own "← All shifts" link. The breadcrumb component exists, unused. | Facility shift detail, any nested route | Longest-match active state; breadcrumb in the shell on deep pages | UXA-14 |
| 5 | Names, amounts and reasons are cut with an ellipsis (37 places). | Queue rows, record details, ranking reasons | Wrap instead of truncate where the value matters | UXA-05 |
| 6 | Whole-naira amounts print ".00" ("₦10,500.00"); money inputs have no thousands separators and use a spinner `type="number"`. | Shift form, rate floors, invoice payment, every amount | Drop ".00" on whole naira; one `MoneyInput` | UXA-15 |
| 7 | Status is carried by colour alone, and icons are chosen page by page; the shell's `ICONS` export is unused. | Every badge and nav item | One icon dictionary; status badges gain an icon | — |
| 8 | Static notices are announced as alerts on every mount. | Every `Alert` | Only failures announce; others are plain regions | UXA-07 |
| 9 | No type scale, no web font (system stack), one shadow, landing page hard-codes four hex colours, and the theme colour in the manifest, viewport and icon all differ from the app primary. | Whole product | Named type scale, self-hosted variable font, elevation and motion tokens, brand tokens, one primary everywhere | — |
| 10 | Component states are uneven: no press feedback, no error styling on inputs, tables are tight (8 px cells) with no sticky header, menu items are 40 px tall (target 44 px). | Forms, tables, the drawer | Fill the gaps in `ui/` once, not page by page | UXA-02 |

Not in this phase, on purpose: dashboards and flows (Phase 2), landing, auth, logo and imagery (Phase 3), a bottom tab
bar for phones (a Phase 2 candidate once the dashboards are settled), and a service worker.

## Outcome

All ten were addressed in Phase 1.

- **1** — Money axes read "₦1.5M" / "₦500k"; axis widths grown for 16 px ticks. Checked on the facility dashboard at 360 and 1280.
- **2** — The theme toggle moved into the account menu on phones. "Practitioner" now shows in full at 360 px.
- **3** — A pre-paint script applies the theme on console routes only; the device setting is the default. A unit test runs the script against `resolveTheme` for every combination.
- **4** — The menu marks the longest matching item; a breadcrumb is drawn on deep pages. The shift page's own "← All shifts" link is gone because the breadcrumb replaces it.
- **5** — `truncate` replaced by wrapping in 29 places where the value is a name, amount or reason. The ranking reasons are shown in full under their bar.
- **6** — `formatNaira` drops ".00" on whole naira; `MoneyInput` replaces the number field and two bare text fields.
- **7** — One icon dictionary used by all three menus; status badges carry an icon.
- **8** — Only failures announce. A standing destructive notice (a rejected facility) passes `live={false}`.
- **9** — Type scale, self-hosted font, two elevation levels, motion and brand tokens; the landing page's hex colours became tokens; manifest, viewport, `icon.svg` and the PNG icons all use the app primary (#0a6066).
- **10** — Press feedback, invalid and hover states on inputs, comfortable table cells, opt-in sticky table header (audit trail), 44 px menu items, no pulsing skeleton for reduced motion.

Also: 43 "could not be loaded" notices became one `ErrorState` with a "Try again" button.

Found while checking the result: Plus Jakarta Sans sets its word space narrow and, with tight heading tracking, read as
"Adocument toaccept". Body word spacing was opened by 0.08 em.

Not done, and why: the Playwright journeys (`pnpm test:e2e`) were not run — they need the worker and the journey world, which
this container does not start. Their three expectations that spelled the old money format were updated by hand
(`tests/e2e/money.spec.ts`, `tests/e2e/staffing.spec.ts`). Axe scans, a bottom tab bar and the lifecycle stepper are Phase 2.
