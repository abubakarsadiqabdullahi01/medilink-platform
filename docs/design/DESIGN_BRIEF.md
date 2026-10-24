# Medilink — UI/UX design brief

Three parts, used in this order:

1. **What a professional design system needs**, checked against what this repo already has (so nothing is rebuilt).
2. **The prompt for Claude Code** — one master prompt, run as three phases.
3. **The prompts for Gemini / Google Flow** — only the images that cannot be built in code.

Principle for all three: **boring, consistent and fast beats clever.** Medilink's users are a nurse on a phone over
weak 4G, a ward manager between patients, and an operations officer clearing forty rows. The design should make them
feel the product is calm, careful and trustworthy. That is what makes a visitor think "these people know design".

---

## 1. The checklist

Legend: ✅ already in the repo · 🔧 do now · ⏭ deliberately skipped (would be over-engineering)

### Foundations

| Area | What a professional expects | Medilink today |
| --- | --- | --- |
| Colour | One brand colour, warm neutrals, semantic status colours, light + dark | ✅ Teal primary, warm neutrals, success/warning/info/destructive, dark mode (`globals.css`). 🔧 Landing page hard-codes `#062a2e`, `#7fd3cf`, `#f2f7f6`, `#04201f` — promote to tokens. 🔧 Manifest theme colour (`#01696f`) and `icon.svg` (`#0a5c63`) disagree with the app primary (≈`#0a6066`) — unify. |
| Typography | One typeface, a fixed scale, readable sizes | ✅ 16px content / 14px secondary floor, larger-text and projector switch. 🔧 No web font at all (system stack) — add one self-hosted variable font and a named type scale. |
| Spacing, radius, elevation | A 4/8 rhythm and two or three shadows, nothing ad hoc | ✅ Radius token. 🔧 Document spacing rhythm and add two elevation levels. |
| Iconography | One icon set, one stroke, one size scale, same icon = same concept, always with a label in navigation | ✅ lucide-react only. 🔧 One small dictionary mapping domain concepts (shift, offer, credential, timesheet, invoice, payout, incident, dispute, audit) to icons, used everywhere. |
| Imagery | One photographic style, one illustration style, alt text, optimised files, no fake testimonials | ✅ One good hero photo (`public/medilink-hero.webp`). 🔧 Two more audience photos, one auth photo, four spot illustrations (Part 3). |
| Motion | Short, purposeful, respects reduced motion | ✅ `motion.tsx`: `LazyMotion`, 180 ms, reduced motion honoured. 🔧 Landing scroll-reveal and card hover only. ⏭ Parallax, Lottie, 3D, video backgrounds. |
| Logo and brand | A real logomark, favicon set, share image | 🔧 Today it is a Stethoscope icon in a square. Make an SVG logomark + wordmark, favicon, share card. |

### Components and states

| Area | What a professional expects | Medilink today |
| --- | --- | --- |
| Component set | Button, input, card, badge, table, dialog, tabs, toast, skeleton | ✅ shadcn/Radix kit in `src/components/ui`, 44 px controls, 2 px focus ring. |
| Interaction states | default · hover · focus · active · disabled · loading · error on everything | 🔧 Audit and fill gaps (press feedback, loading on every submit). |
| Data states | Loading (skeleton the same size as content) · empty · error · partial | ✅ `Skeleton`, `EmptyState` exist. 🔧 Use them everywhere, with the same tone. |
| Tables and records | Never clip the value that matters | 🔧 UXA-05: values and ranking reasons are still truncated. |
| Money and dates | ₦ with thousands separators, no `.00` on whole naira, Nigerian time | 🔧 UXA-15. |

### Screens and flow

| Area | What a professional expects | Medilink today |
| --- | --- | --- |
| Dashboards | First screen answers "what needs me now?" — one status, three or four numbers, a prioritised to-do list, recent activity | ✅ Practitioner home leads with eligibility. 🔧 Facility: onboarding checklist (UXF-16). 🔧 Operations: queue tiles with the age of the oldest item (UXO-07). |
| Charts | Only where a trend answers a question; accessible colours | ✅ Recharts + validated chart tokens. Keep. |
| Process visibility | The user always knows where a thing is and whose turn it is | 🔧 One shared lifecycle stepper (Published → Offered → Confirmed → Attended → Approved → Paid) on shift pages. |
| Forms | Inline validation, sensible defaults, save draft, a button that says what will happen, undo over confirm | ✅ Wizard keeps drafts. 🔧 Apply the same rules to shift, register and profile forms. |
| Navigation | Active state on nested routes, breadcrumbs on deep pages, phone-first | 🔧 UXA-14 (nested active state, breadcrumbs — component exists, unused). |
| Microcopy | Plain words, consequences stated, errors say what to do | ✅ Already strong. Keep the voice. |

### Landing page

| Section | Notes |
| --- | --- |
| Header, hero, two audience calls to action | ✅ exists |
| Proof strip | ✅ exists as three chips — keep, no invented numbers |
| How it works (4 steps) | ✅ exists — 🔧 add a quiet connector line and reveal |
| **Product preview** | 🔧 missing. Real screenshots (desktop dashboard, phone offers screen) made with Playwright from the demo seed — not AI images |
| For facilities / for practitioners | ✅ exists as text — 🔧 give each a photo |
| Trust and safety band | ✅ exists |
| **FAQ** | 🔧 missing. Native `<details>` — no new dependency |
| Final call to action, footer | ✅ exists |
| Share card and metadata | 🔧 Open Graph image built from the existing hero |

### Quality gates

✅ Contrast test, skip link, larger-text switch. 🔧 axe scan in Playwright (UXA-16), alerts not announced on every mount
(UXA-07), no flash of wrong theme (UXA-13), offline/slow banner with retry (UXA-09, banner only), landing LCP < 2.5 s on
throttled Slow 4G.

### Deliberately skipped

Storybook · a design-token build pipeline · swapping the component library · Lottie · 3D · parallax · custom cursor ·
video hero · glassmorphism everywhere · mega-menus · a service worker · an i18n framework (Hausa is a later, separate piece).

---

## 2. The prompt for Claude Code

Paste the whole block, then change the last line to the phase you want. Run Phase 1, merge it, then 2, then 3 — three
small reviewable changes is better than one enormous one.

```
ROLE
You are a senior product designer and front-end engineer joining the Medilink team. You design with restraint: calm,
consistent, fast and accessible. A visitor should feel "these people know what they are doing" within five seconds,
and a tired nurse on a weak phone connection should never be confused. Boring and consistent beats clever.

CONTEXT — already true, do not redo
- Medilink: verified healthcare workforce and locum management for Nigeria. Three consoles — practitioner, facility,
  operations (src/app/practitioner, /facility, /admin) — plus a public landing page (src/app/page.tsx) and auth pages
  (src/app/(auth)). Users are mostly on phones over weak 4G, with mixed digital literacy.
- Stack: Next.js App Router, React, TypeScript, Tailwind, shadcn/Radix components in src/components/ui, app components
  in src/components/app, lucide-react icons, Framer Motion (only through src/components/app/motion.tsx), Recharts,
  sonner toasts.
- The foundation is good. Tokens live in src/app/globals.css (deep teal primary ≈ #0a6066, warm neutrals, semantic
  success/warning/info/destructive, dark mode). Content text is 16px, secondary text 14px, controls are 44px, there is a
  larger-text/projector switch, a skip link and a contrast test (src/app/globals.contrast.test.ts). The hero photo is
  public/medilink-hero.webp. Do not rebuild any of this — extend it.
- docs/blueprint/Gap-Reconciliation.md lists open design debt by ID (UXA-, UXF-, UXO-, UXP-, UXW-). Read it before you
  start and cite the IDs you close.

NON-NEGOTIABLES
1. No change to business logic, API routes, database schema, permissions or audit behaviour. Presentation only.
2. Keep WCAG 2.2 AA. src/app/globals.contrast.test.ts must keep passing. Nothing below 14px, controls stay ≥ 44px, the
   larger-text switch must still work on every screen you touch.
3. Honour prefers-reduced-motion. Animate opacity and transform only. ≤ 200 ms inside consoles, ≤ 400 ms on the landing
   page. Never animate a queue or table row.
4. Use design tokens, not hard-coded colours, in components.
5. Every claim on the landing page must be something the system does today. No invented statistics, testimonials,
   awards, customer logos or regulator/government logos. Use only counts that come from real data.
6. Restraint: reuse before you create; add a component only if it is used in three or more places; no new abstraction
   layers; prefer deleting to adding. No new runtime dependency unless unavoidable — if you add one, say why and what it
   costs in kB. Not allowed: swapping the UI kit, Storybook, Lottie, an i18n library, a service worker.
7. Performance is part of design: landing LCP < 2.5 s and CLS < 0.1 on throttled Slow 4G; images through next/image
   with correct sizes, WebP, only the hero marked priority; the landing page stays a server component; fonts
   self-hosted through next/font, Latin subset, one variable family.

HOW TO WORK
1. Read first: globals.css, tailwind.config.ts, src/components/ui/*, src/components/app/{page-shell,console-shell,
   status-badge,motion,format}.*, the three console home pages, the landing page, docs/blueprint/Gap-Reconciliation.md
   (UX rows), docs/running-a-demo.md.
2. Run the app with the demo data (docs/running-a-demo.md) and take "before" screenshots of the key screens at 360,
   768 and 1280 px, light and dark, with Playwright. Keep them in the scratchpad, not in git — except product
   screenshots intended for the landing page.
3. Write docs/design/audit.md, one page: the ten highest-impact problems for the phase you were given, ranked by user
   impact ÷ effort. Then implement them in that order without waiting for approval. Stop and ask only if a fix needs a
   product decision or content you do not have; otherwise leave a clearly named placeholder and list it in your summary.
4. Small commits, one theme each. Before every push run `pnpm verify` and the relevant Playwright spec (tests/e2e). After
   each UI change take "after" screenshots and compare with "before" — fix what looks off before moving on.
5. Finish with: what changed (by ID closed), before/after screenshots, what you deliberately did not do and why.

PHASE 1 — FOUNDATIONS AND SHELL
- Tokens: add a type scale (display, h1, h2, h3, body, small), one self-hosted variable font (Plus Jakarta Sans via
  next/font), a spacing rhythm (4/8), two elevation levels and motion duration/easing tokens, in globals.css and
  tailwind.config.ts. Replace the landing page's hard-coded #062a2e, #7fd3cf, #f2f7f6, #04201f with named tokens.
  Make theme colour in the manifest, viewport and icon.svg agree with the app primary.
- Icons: one dictionary file (src/components/app/icons.ts) mapping domain concepts — shift, offer, credential,
  timesheet, invoice, payout, incident, dispute, audit, facility, practitioner — to lucide icons. Use it in navigation,
  page headers, empty states and badges. Icon sizes 16/20/24; navigation is always icon + text label.
- Components: audit Button, Input, Card, Badge, StatusBadge, Table, Dialog and Alert for default / hover / focus /
  active / disabled / loading / error and fix gaps. Press feedback on buttons. Tables: sticky header, row hover,
  comfortable density, never truncate a name, amount or reason (UXA-05). Static notices must not use role="alert"
  (UXA-07).
- Shell: active menu item on nested routes plus breadcrumbs on deep pages (UXA-14); follow prefers-color-scheme with no
  flash of the wrong theme (UXA-13); check the phone drawer and bottom of the screen reachability with one thumb.
- Formatting: whole-naira without ".00", thousands separators in money inputs, Nigerian time (WAT) in every displayed
  date and time (UXA-15).
- Loading / empty / error: every list and card uses the same three patterns with the same tone.

PHASE 2 — DASHBOARDS AND FLOWS
- One dashboard pattern: first screen answers "what needs me now?" — one status headline, at most four numbers above
  the fold, each linking to the filtered list, then a prioritised to-do list, then recent activity. Skeletons match
  the final layout. Charts only where a trend answers a question, using the chart tokens.
  · Practitioner: keep eligibility first; add next shift, offers awaiting an answer, earnings.
  · Facility: onboarding checklist until complete — licence, staff, rates, first shift (UXF-16) — then needs-action
    list, today's attendance, timesheets to approve.
  · Operations: queue tiles showing the age of the oldest item, practitioners waiting for approval first (UXO-07).
- Lifecycle stepper: one shared component (Published → Offered → Confirmed → Attended → Approved → Paid) on facility
  and practitioner shift pages, showing the current step and whose turn it is ("Waiting for you / for the facility /
  for Medilink").
- Forms: new-shift dialog, profile wizard and register — inline validation, sensible defaults, sticky primary action on
  phones, buttons that name their consequence, undo toast instead of a confirm where an action is reversible.
- Weak-network behaviour: a small offline/slow banner and a retry on failed mutations (UXA-09, banner and retry only);
  compress photographs client-side before upload (UXA-10) if it fits in under ~60 lines.
- Add @axe-core/playwright as a dev dependency and a spec that scans login, landing and the three console homes; fix
  serious and critical findings (UXA-16).

PHASE 3 — LANDING, AUTH, BRAND, IMAGERY
- Brand: an SVG logomark and wordmark (replace the Stethoscope-in-a-square placeholder in the header, footer and
  icon.svg), favicon, Apple touch icon, maskable icon, and an Open Graph card (1200×630) built from the existing hero
  with the logo and headline composed in code. Do not generate the logo as a raster.
- Landing structure, keeping the existing copy and claims: header · hero (headline, subhead, two audience calls to
  action, proof chips) · how it works (four steps, with a quiet connector line) · product preview · for facilities and
  for practitioners as two photo cards · trust and safety band · FAQ using native <details>/<summary> · final call to
  action · footer with contact, privacy link and the text-size control.
- Product preview: real screenshots made with Playwright from the demo seed — a desktop facility dashboard and a phone
  practitioner offers screen — in a plain device frame, WebP, with proper alt text. Never mock up fake data in design
  software.
- Motion on the landing page only: fade-up reveal once per section (8px, ≤ 400 ms) using the existing `m` primitives,
  a 2px lift on card hover. Nothing else.
- Images: wire the files below with next/image and meaningful alt text. Until they exist, render a neutral tinted block
  of the same aspect ratio so nothing shifts. Expected files, in public/images/:
    landing/facility-ward-manager.webp   3:2
    landing/practitioner-phone.webp      4:5
    auth/shift-handover.webp             3:4
    empty/shifts.webp, offers.webp, all-clear.webp, not-found.webp   1:1, 480px
  Each file ≤ 150 kB (illustrations ≤ 40 kB). Use the 404 and global error pages and the three console empty states for
  the illustrations.
- Auth pages (login, register, forgot password): split layout — form left, photo right on lg and up, no image on
  phones — with one trust line. Same logo, same tokens as the landing page.
- Metadata: title, description, Open Graph and Twitter tags, robots and sitemap. Nothing more.
- Final check: Lighthouse mobile (if available) performance, accessibility and best practices ≥ 90 on the landing page.

DEFINITION OF DONE
`pnpm verify` and the relevant Playwright specs pass · no serious or critical axe findings on the pages you touched ·
screenshots at 360 / 768 / 1280 in light, dark and larger-text · reduced motion tested · a written list of IDs closed
and of anything left open.

THIS RUN: do PHASE <1 | 2 | 3> only.
```

---

## 3. Images for Gemini / Google Flow

### What to use for what

- **Gemini (image generation)** — all stills below. Upload `public/medilink-hero.webp` with every prompt and say
  "match the lighting, colour grade and realism of the attached image": this is what keeps the set looking like one
  brand.
- **Google Flow** — video only. **Skip it for launch**: a looping background video costs megabytes on weak 4G and adds
  nothing the photos do not. If you want one later, the prompt is at the end of this section.
- **Not for Gemini**: the logo (an SVG built in code), the product screenshots (real, from the demo seed), and the
  share card (built from the existing hero). Generated pictures of software look fake and invite distrust.

### Rules for every image

- No text, no logos, no watermarks, no legible screens or signage in the picture.
- Check hands, stethoscopes and ID badges for AI artefacts before you accept an image. Regenerate rather than retouch.
- These are illustrative. Never caption them as real Medilink users, and never pair them with a quote.
- Download at the highest resolution offered. Name the file exactly as below.

### Shared photo style — paste at the start of each photo prompt

```
Photorealistic editorial photograph, natural daylight, warm and calm, shallow depth of field. A modern, well-kept
Nigerian hospital: clean white corridors, teal and navy scrubs, gentle warm highlights. Authentic, unposed and
dignified; the professionals look competent and relaxed. Match the lighting, colour grade and realism of the attached
reference image. No text, no logos, no watermarks, no legible screens or signage. No stock-photo clichés (no
stethoscope on a laptop, no handshakes, no thumbs-up). Natural hands and fingers, correct anatomy, ID badges blank.
```

### Photo 1 — `facility-ward-manager.jpg` — landscape 3:2

```
[shared photo style] A Nigerian woman in her 40s, a ward manager in a navy tunic with a teal lanyard, stands at a
nurses' station beside a younger male nurse in teal scrubs. They look together at an open laptop whose screen is angled
away from the camera, discussing a weekly roster. The ward corridor behind them is softly blurred. Place the two people
in the right third of the frame and keep the left third calm and uncluttered, so text can sit on it.
```

### Photo 2 — `practitioner-phone.jpg` — portrait 4:5

```
[shared photo style] A Nigerian nurse in her early thirties, in teal scrubs, waist-up in a quiet hospital corridor at
the start of her shift. She glances at a smartphone with a small, relaxed smile; the phone screen gives off a soft glow
but shows nothing legible. Window light from the left, a gently blurred corridor behind her.
```

### Photo 3 — `shift-handover.jpg` — portrait 3:4

```
[shared photo style] Two nurses at a shift handover in a bright hospital corridor, seen from a little distance: a
Nigerian man around thirty passes a tablet to a Nigerian woman around thirty-five, both mid-conversation. Cooler teal
tones in the scrubs and walls so a teal overlay will sit comfortably on the image. Keep the top third calm.
```

### Spot illustrations — four empty-state and error pictures, 1:1

Paste the style block, then one scene per image. Generate them one at a time in the same chat so Gemini keeps the style.

```
Flat vector-style spot illustration, soft rounded shapes, one consistent 2 px line weight in deep teal #0A6066, fills
in pale mint #DCEFEE and white, a single small accent of warm orange #EB6A32, a faint grey ground shadow. Plain white
background, square 1:1, generous empty space around the subject. No text, no letters, no numbers, no gradients, no
realistic faces. Calm, friendly, healthcare context.
```

- `empty-shifts.png` — an empty weekly calendar card with one dashed outline slot and a small plus button, a tiny
  stethoscope leaning against it.
- `empty-offers.png` — an empty inbox tray with a single small paper plane resting beside it, quiet and waiting.
- `all-clear.png` — a clipboard with three ticked rows and a small teal check badge: everything is done.
- `not-found.png` — a magnifying glass tilted over an empty document with a dotted outline.

### Optional later — Google Flow, one loop

```
Eight-second seamless, silent loop. Slow dolly forward along a bright, modern Nigerian hospital corridor; a nurse in
teal scrubs walks away from the camera, blurred. Teal and white palette, soft daylight, no text, no logos, no faces in
focus. 16:9. Under 1 MB after compression, always with a still poster image as fallback.
```

### Handing the images back

Attach the files to this chat (or put them in `public/images/incoming/`) with the file names above. Claude Code will
compress to WebP, place them with `next/image`, write the alt text and check that any text laid over them stays readable.
