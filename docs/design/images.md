# Images: what goes where

The pictures that are not code arrive separately (generated from the prompts in `DESIGN_BRIEF.md`, part 3). The pages
are built so that a missing one is not a hole and a new one needs no code: drop the file in, rebuild.

| File | Used by | Shape | What happens until it exists |
| --- | --- | --- | --- |
| `public/images/landing/facility-ward-manager.webp` | Landing, "For facilities" | 3:2 (1600×1067) | A pale block of the same shape; nothing moves when the file arrives. Checked when the page is served. |
| `public/images/landing/practitioner-phone.webp` | Landing, "For practitioners" | 3:2 (1600×1067) | As above. (Briefed as 4:5; the delivered picture is landscape, so the section was changed to 3:2.) |
| `public/images/auth/shift-handover.webp` | Sign-in, register, forgot password (wide screens only) | About 9:10; shown full height of the panel and cropped to fit | The teal panel, as before. Found when the app is **built**. |
| `public/images/empty/shifts.webp` | Facility shifts, nothing yet | 1:1, 480 px | The icon the screen already had. Found at build. |
| `public/images/empty/offers.webp` | Practitioner offers, nothing yet | 1:1, 480 px | As above. |
| `public/images/empty/all-clear.webp` | Operations queues that are clear (credentials, disputes, incidents, data requests) | 1:1, 480 px | As above. |
| `public/images/empty/not-found.webp` | The 404 page | 1:1, 480 px | As above. |

Each file: WebP, at most 150 kB (illustrations at most 40 kB). The pictures on the landing page are described to
screen readers in the page itself (`src/app/page.tsx`), so check the description still fits the picture you drop in.
The illustrations and the sign-in photograph are decorative and have no description.

## Delivered so far

The three photographs are in: `facility-ward-manager.webp`, `practitioner-phone.webp` and `shift-handover.webp`. They were
delivered as 16:9 landscape and cropped to the shapes above (the facility photo loses a pale wash on its right, the
practitioner photo is centred on the nurse, the sign-in photo is the right half of the sharpest of the four). A fourth
photograph, a corridor handover, has no slot and is not in the repository.

**Still to come:** the four illustrations in `public/images/empty/`. Until they arrive each screen keeps its icon.

## Already in place, made in code and not generated

- `public/images/landing/preview-desktop.webp` and `preview-phone.webp` — real screens from the demonstration data,
  captured with Playwright. The landing page says they are from the demonstration environment and that the names and
  figures are invented. Retake them when the dashboards change.
- `public/og.jpg` — the 1200×630 card shown when a link is shared. Redraw with `node scripts/make-share-card.mjs`; it
  uses the hero photograph, the outlined wordmark and the self-hosted typeface.
- `public/brand/` — the mark and the lockups as SVG. The same mark is drawn inline in `src/components/app/logo.tsx` and
  is the file `src/app/icon.svg`; the PNG icons in `public/icons/` and `src/app/favicon.ico` are rendered from it.
  Change them together.
