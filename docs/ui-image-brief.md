# Image brief

What images Medilink uses, what is still missing, and exactly what each missing one has to be.
Nothing here is a placeholder: where an image is not yet available the page shows no image rather than
a stand-in, and the layout does not depend on it.

## Rules for every image

- **No confidential data.** No real practitioner name, photograph, registration number, NIN, phone number or
  document; no real facility's name, shift, rate, invoice or timesheet. Product screenshots are taken only from
  the seeded demonstration world (`pnpm tsx scripts/seed-demo.ts`) and say so in their section text.
- **No claims in pixels.** No statistic, rating, testimonial, partner or hospital logo, regulator badge or
  "verified by" mark appears inside an image unless the owner has the right to use it and it is true on the day it ships.
- **People.** A photograph of a real person needs a written release that covers web use and says how long it
  lasts. Prefer people at work over posed portraits, hands and screens over faces, and Nigerian clinical settings
  that look like the ones Medilink serves. No stock images of a different country's hospital.
- **Format and weight.** WebP, quality 75–80 (AVIF welcome if it is smaller). Under 120 KB for anything on the first
  screen of a page and under 80 KB for anything below it; a phone on a weak connection should have the first
  image in a second or two. No GIF, no autoplay video, no animated backgrounds.
- **Always `next/image`**, with real `width`/`height` so nothing moves while it loads, `sizes` that match the
  layout, `priority` only for the one image above the fold, and `alt` text that says what a person using the page
  needs from the picture — or `alt=""` when the picture only decorates. Never put the page's meaning in an image alone.
- **Contrast over text.** Where text sits on a photograph, the scrim is part of the component and must keep
  the text at WCAG AA contrast on the brightest part of the image at every width (see the hero).
- Files live in `public/`, lower-case, hyphenated, named for what they show.

## In use

| File | Where | Size (px) | Weight | Notes |
|---|---|---|---|---|
| `public/medilink-hero.webp` | Landing hero, behind the headline | 1672 × 941 | 125 KB | A nurse and a doctor reviewing a shift on a tablet in a hospital corridor. Kept as it was. Subjects sit right of centre (`object-[66%_center]`), so the left 45% must stay quiet for the headline; a replacement has to do the same. `alt` describes the scene. Owner to confirm the licence and the release for the two people shown. |
| `public/landing/preview-facility.webp` | Landing, "What you see when you sign in" — shown from 768 px wide | 1600 × 955 | 60 KB | The facility dashboard on a computer: "Needs your attention" and the four summary tiles. Demonstration data. |
| `public/landing/preview-facility-phone.webp` | Same section — shown below 768 px wide | 780 × 1628 | 55 KB | The same dashboard at phone width (390 CSS px at 2×), cropped on a row boundary. |
| `public/landing/preview-practitioner.webp` | Same section, beside or under the facility screen | 780 × 1688 | 49 KB | The practitioner's home screen on a phone. Demonstration data. |
| `public/icons/*`, `src/app/icon.svg` | Browser tab, home-screen icon, PWA manifest | 180, 192, 512, 512 maskable | small | Unchanged. |

The three previews are produced by `scripts/ui-landing-previews.mjs`, which signs in as seeded demo accounts,
photographs two read-only pages and clicks nothing, then removes the one banner that only appears because the
demo accounts have not accepted the current terms (a facility that has accepted them never sees it). Re-run it,
and convert as the script's header shows, whenever a dashboard changes enough that the picture would mislead.

## Still needed

None of these blocks launch. Each has a fallback that is shown today.

1. **Social-share image** (Open Graph and Twitter card)
   - `public/og/medilink-share.png`, **1200 × 630**, PNG or JPEG under 300 KB.
   - Brand mark and the promise "Verified healthcare professionals. Reliable clinical cover." in the brand teal
     (`#01696f` family) on the off-white used by the site, no photograph of a person. Text at least 60 px so it survives a
     thumbnail; keep everything inside a 1100 × 530 safe area (platforms crop differently).
   - Placement: `openGraph.images` and `twitter.images` in `src/app/layout.tsx` metadata, with `alt` matching the headline.
   - Today: shared links show the page title and description only.
2. **A second hero photograph for the practitioner path** (optional)
   - `public/medilink-hero-practitioner.webp`, **1672 × 941** (16:9), under 120 KB, same crop-safe rule as the current hero
     (quiet left 45%, subject right of centre, brightest area behind the text lightened by the scrim, not by editing).
   - Subject: a practitioner on a phone at the start or end of a shift, Nigerian clinical setting, hands and screen
     legible, no readable patient information, no readable screen content other than the Medilink interface.
   - Placement: hero of `/register`, replacing the plain panel. Release needed for anyone identifiable.
   - Today: `/register` has no photograph.
3. **Refreshed previews from the pilot** (when the pilot has consented, de-identified data)
   - Same three files, same sizes. Replace the demonstration data only if every name, amount and facility in the
     frame is invented or consented to in writing; otherwise keep the demonstration data. Either way the sentence
     above the images has to stay true.
4. **Dark-mode previews** (optional)
   - `preview-*-dark.webp`, same sizes, shown with `dark:` variants (`hidden dark:block` / `dark:hidden`). Only worth the bytes if
     analytics show a meaningful share of visitors using dark mode on the landing page; the landing page follows
     the system setting.
5. **Illustrations for the four "How it works" steps** — not needed. The steps use Lucide icons and numbers, which are
   legible at any text size, cost no bytes and cannot go out of date. Do not commission artwork for them.

## Handing over

For each image supplied: the file, who owns it, the licence or release (and its end date), the alt text the owner
would like, and a statement that it contains no real personal or confidential data. Put the licence in the pull request
description; do not put it in the image.
