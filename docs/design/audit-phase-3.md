# Design audit — Phase 3 (landing, auth, brand, imagery)

Method as before. Measured on a production build with Lighthouse (mobile, simulated slow 4G) and axe, and by reading
the landing page, sign-in, register, forgot-password and 404 at 360 and 1280 px.

| # | Problem | Fix |
| --- | --- | --- |
| 1 | The logo was a stethoscope icon in a square, used in three places by hand, and the favicon, manifest and landing page each had a different teal. | A real mark (a cross with a connection node), one `Logo` component, SVG files in `public/brand`, and a favicon, apple, maskable and PNG icon set rendered from it. |
| 2 | Sharing a link showed nothing: no share card, and no description in the `<head>` for anything but a few crawlers. | A composed 1200×630 card, Open Graph and Twitter tags, `robots` and `sitemap`, and metadata in the head for every visitor. |
| 3 | The landing page had no picture of the product, only claims about it. | Real screens from the demonstration data, in a plain frame, with a line saying so. |
| 4 | "Facilities" and "practitioners" were two columns of text. | Two photo sections with a call to action each (the photographs arrive separately; a placeholder holds their place). |
| 5 | No answers to the questions people ask before signing up. | Six, as native disclosure elements, each only claiming what the system does. |
| 6 | On a phone the landing header had no Sign in, and the nav was unreachable. | Sign in visible at every width; header fits 360 px (it was 372). |
| 7 | The four steps were four separate blocks. | A line through them, and each section arrives as it is scrolled to (once, 8 px, never for reduced motion). |
| 8 | The three auth pages each had their own panel, one with none; the register page's panel cards held a lot of text beside a form. | One panel component with a photograph and a single sentence on sign-in and password reset; register keeps its explanation of what happens next. |
| 9 | Empty states and the 404 were an icon and a sentence, however welcome the moment. | Four spot illustrations, switched on when the files exist, with the icon as the fallback. |
| 10 | The footer's text-size control would have been dark text on dark teal. | A `dark` tone for the control. |

## Outcome

Lighthouse, landing page, mobile: **Performance 95–98** (the 95 is the first request after a restart, which pays for the
image optimiser; LCP 2.9 s cold, 2.4 s warm), **Accessibility 100, Best Practices 100, SEO 100**, layout shift 0,
blocking time 50–80 ms. The page's JavaScript is 120 kB first load, shared with the rest of the app; the landing page
itself adds 1.4 kB, because it stays a server component. The one failing audit is back/forward cache, a result of the
site-wide `Cache-Control: no-store`, left as it is.

With the photographs in place the figures are the same shape: **Performance 95–97, Accessibility 100, Best Practices 100,
SEO 100**, layout shift 0, LCP 2.6 s warm. That is at the edge of the 2.5 s target and moves by a few tenths between runs; the
LCP is the hero photograph, which is unchanged, and the three new photographs are below the fold and load only when
scrolled to (the only image fetched on load is the hero, at 25 kB).

Full Playwright suite on the production build, before and after the photographs: 72 of 72, including the accessibility scan
of the landing page, sign-in, register, contact and the consoles, and the phone-width checks.

Found on the way: a `favicon.ico` was requested by every browser and was a 404; Next was putting the page description in
the body for a dynamic page, so a link preview or Lighthouse never saw it; and an image that fails before React is
attached to hear about it never fires `onError`, so optional pictures are now detected when the app is built.

Not done, on purpose: a service worker, a video, and Hausa. The three photographs are in; the four illustrations are not
yet (see `images.md`), so empty states and the 404 still show their icons.
