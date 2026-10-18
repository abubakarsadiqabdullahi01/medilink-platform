# Design tokens and conventions

Where each decision lives, so a screen never invents its own.

| What | Where | Use |
| --- | --- | --- |
| Colour (semantic) | `src/app/globals.css` — `--primary`, `--success`, `--warning`, `--info`, `--destructive`, neutrals, light and dark | `bg-primary`, `text-muted-foreground`, … Never a hex in a component. |
| Colour (public pages) | `--brand-night`, `--brand-deeper`, `--brand-mint`, `--surface-tint` | `bg-brand-night`, `text-brand-mint`, `bg-tint`. Light only. |
| Typeface | `src/app/layout.tsx` — Plus Jakarta Sans, self-hosted in `src/app/fonts/` | The default. Add the Latin Extended-B subset when Hausa arrives (ɓ ɗ ƙ). |
| Type scale | `tailwind.config.ts` — `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-sm` (body, 1rem), `text-xs` (secondary, 0.875rem) | Headings use the named sizes. Nothing smaller than `text-xs`. |
| Spacing | Tailwind's 4 px scale | 1–3 inside a control · 4 between related things · 6 between groups · 8–12 between sections. |
| Elevation | `--shadow-card`, `--shadow-raised` | `shadow-card` for things resting on the page, `shadow-raised` for menus, popovers, dialogs. |
| Motion | `--duration-fast/base/slow`, `--ease-out`; `src/lib/ui/motion-tokens.ts` for Framer | ≤ `base` (180 ms) in consoles, `slow` (320 ms) on public pages only. Opacity and transform only. |
| Icons | `src/components/app/icons.ts` — `ICON` (concepts) and `STATUS_ICON` | Pick a concept, never a one-off lucide import for something already named. Sizes 16 / 20 / 24. Navigation is always icon + label. |
| Status | `src/components/app/status-badge.tsx` | Colour plus icon, so it never depends on colour alone. |
| Load states | `src/components/app/page-shell.tsx` — `QueueSkeleton`, `EmptyState`, `ErrorState` | Every list and card shows one of the three. `ErrorState` always offers "Try again". |
| Money | `src/components/app/format.ts`, `money-input.tsx` | `formatNaira` (no ".00" on whole naira), `MoneyInput` for entry. |
| Theme | `src/lib/ui/theme.ts` | Explicit choice beats device setting; consoles only; applied before first paint. |
| Active page | `src/components/app/nav.ts` | Longest-match menu item; breadcrumb on deep pages. |

Sizes in the controls: 44 px high (`h-11`) for anything tapped. Focus ring 2 px with offset. Text size scales with the
reader's choice (A / A+ / A++) because everything is in `rem`; do not size text in `px`.
