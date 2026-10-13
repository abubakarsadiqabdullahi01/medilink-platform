# Medilink System Blueprint v3.0 (draft for team review)

One picture of Medilink for the whole team: **what exists today, what is missing against the
v2.9 specification, what the new strategy adds, and the recommended flows** — built from a
module-by-module read of the code at commit `5c199c1`. No application code was changed to
produce it, and nothing was run: "verified" means *read in the code*.

| Read this | What it is | Size |
| --- | --- | --- |
| [Medilink-System-Blueprint-v3.md](Medilink-System-Blueprint-v3.md) | The blueprint: one-page brief; why Medilink exists and how each group says "yes"; v2.9 against the code against v3; a card per module; the gap register (410 gaps, 119 P0, collapsed into 14 pilot blockers); the v3 target (hierarchy, one Booking, negotiation, success fee, provider-held payments, trust, privacy, resource exchange); the recommended flows; data and permission changes; roadmap, decisions, risks and the Gombe appraisal; appendices including the money arithmetic | ~110 pages as Word |
| [Medilink-Module-Reference-v3.md](Medilink-Module-Reference-v3.md) | The detail behind it: one full chapter per module and console — who uses it, how it works step by step, state tables, rules, every gap with `file:line` evidence, the recommended change and acceptance criteria | ~125 pages as Word |

**Word and PDF renditions.** This repository ignores `*.docx` ("documents belong outside the repository"), so the Word and PDF
files are not committed. They are generated from the Markdown with `tools/make_docx.py` (see below) and were shared with the team
directly. A local build writes them to `out/`, which is also ignored.

Start with **The one-page brief**, then Part 5 (the gap register) and Part 6 (the target).

## Folder

| Path | Contents |
| --- | --- |
| `fig/` | The four figures (PNG and the SVG they were drawn from) |
| `evidence/` | The six module-by-module fact sheets the chapters were written from — working notes at commit `5c199c1`; see `evidence/README.md` for the corrections the chapters make |
| `tools/` | `make_docx.py` (Markdown → styled Word) and `make_figs.py` (figures) |

## Regenerating the Word files

The Markdown files are the source of truth from now on; edit them and rebuild. Needs `pandoc` and
`python-docx`; a PDF is `soffice --headless --convert-to pdf` on the result.

```bash
python3 docs/blueprint/tools/make_docx.py docs/blueprint/Medilink-System-Blueprint-v3.md \
  docs/blueprint/out/Medilink-System-Blueprint-v3.docx docs/blueprint --font Calibri
python3 docs/blueprint/tools/make_figs.py docs/blueprint/fig      # needs Chromium
```

## What to treat with care

- **Regulatory, tax and payment statements are marked** `[Counsel]` or `[Unverified]` and must be confirmed
  by a qualified adviser before anyone relies on them. The NMCN register structure was confirmed from the
  council's own site; MLSCN, NDPC and CBN points are from secondary sources; MDCN and PCN categories are
  from the strategy note and were not checked.
- **The Gombe context is hypothesis** until the structured appraisal (Part 9, Appendix C) tests it.
- Several findings are race conditions or access gaps found by reading. **Reproduce each with a test before
  fixing it, and keep the test.**
- The worked money numbers in Appendix F come from running copies of the real domain functions, not the app.

System Documentation v2.9 — the specification this work measures the code against — is kept outside the repository, as the
project convention requires; the evidence sheets and chapters cite it by section and module number.
