#!/usr/bin/env python3
"""Draw the four blueprint figures as SVG, then render to PNG with headless Chromium.

Usage: python3 make_figs.py <out_dir>
Palette is colour-blind safe: facility = orange, professional = blue, system = teal,
money = slate/violet; every colour is also labelled in words.
"""
import html
import os
import subprocess
import sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
FONT = "Inter, 'DejaVu Sans', Arial, sans-serif"

C = {
    "ink": "#1f2937", "muted": "#475569", "line": "#64748b", "bg": "#ffffff",
    "fac_f": "#fff1e6", "fac_s": "#c2410c", "fac_t": "#7c2d12",
    "pro_f": "#e6f0ff", "pro_s": "#1d4ed8", "pro_t": "#1e3a8a",
    "sys_f": "#e3f4f1", "sys_s": "#0f766e", "sys_t": "#134e4a",
    "mon_f": "#f1ecfb", "mon_s": "#6d28d9", "mon_t": "#4c1d95",
    "red_f": "#fdecec", "red_s": "#b91c1c", "red_t": "#7f1d1d",
    "gry_f": "#f3f4f6", "gry_s": "#6b7280", "gry_t": "#374151",
}


def esc(t):
    return html.escape(t, quote=False)


class Svg:
    def __init__(self, w, h):
        self.w, self.h, self.parts = w, h, []
        self.parts.append(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<defs>'
            f'<marker id="arr" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="{C["line"]}"/></marker>'
            f'<marker id="arrr" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="{C["red_s"]}"/></marker>'
            f'</defs><rect width="{w}" height="{h}" fill="{C["bg"]}"/>'
        )

    def text(self, x, y, s, size=14, weight=400, fill=None, anchor="middle", italic=False):
        fill = fill or C["ink"]
        st = ' font-style="italic"' if italic else ""
        self.parts.append(
            f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}"{st}>{esc(s)}</text>'
        )

    def box(self, x, y, w, h, title, sub=None, kind="sys", dashed=False, tsize=14, ssize=11.5, rx=10):
        f, s, t = C[kind + "_f"], C[kind + "_s"], C[kind + "_t"]
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        self.parts.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{f}" stroke="{s}" stroke-width="2"{dash}/>'
        )
        lines = title.split("|")
        sublines = sub.split("|") if sub else []
        total = len(lines) * (tsize + 3) + len(sublines) * (ssize + 3)
        cy = y + (h - total) / 2 + tsize
        for ln in lines:
            self.text(x + w / 2, cy, ln, tsize, 700, t)
            cy += tsize + 3
        for ln in sublines:
            self.text(x + w / 2, cy, ln, ssize, 400, C["muted"])
            cy += ssize + 3

    def arrow(self, x1, y1, x2, y2, red=False, dashed=False, label=None, lx=None, ly=None):
        col = C["red_s"] if red else C["line"]
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        mk = "arrr" if red else "arr"
        self.parts.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="2"{dash} marker-end="url(#{mk})"/>'
        )
        if label:
            self.text(lx if lx is not None else (x1 + x2) / 2, ly if ly is not None else (y1 + y2) / 2 - 6,
                      label, 11, 600, col)

    def poly(self, pts, red=False, dashed=False):
        col = C["red_s"] if red else C["line"]
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        mk = "arrr" if red else "arr"
        p = " ".join(f"{a},{b}" for a, b in pts)
        self.parts.append(f'<polyline points="{p}" fill="none" stroke="{col}" stroke-width="2"{dash} marker-end="url(#{mk})"/>')

    def band(self, x, y, w, h, label, kind="gry"):
        f = C.get(kind + "_f", C["gry_f"])
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{f}" opacity="0.55"/>')
        self.text(x + 14, y + 22, label, 12.5, 700, C.get(kind + "_t", C["muted"]), anchor="start")

    def save(self, name):
        self.parts.append("</svg>")
        path = os.path.join(OUT, name + ".svg")
        open(path, "w").write("".join(self.parts))
        return path


def fig1():
    s = Svg(1100, 520)
    # lanes
    s.band(10, 14, 690, 96, "Facility-led (origin: FACILITY_POSTED or PRACTITIONER_APPLIED)", "fac")
    s.band(10, 122, 690, 96, "Professional-led (origin: LISTING_BOOKED)", "pro")
    xs = [26, 262, 498]
    fac = [("Facility publishes", "a shift at a required level"), ("Eligible professionals", "are matched (hard rules)"), ("Professional accepts", "or counters (≤ 2 rounds)")]
    pro = [("Professional publishes", "availability and rate (opt-in)"), ("Facility searches", "verified available people"), ("Facility sends", "a booking offer")]
    for x, (a, b) in zip(xs, fac):
        s.box(x, 44, 188, 56, a, b, "fac", tsize=13, ssize=11)
    for x, (a, b) in zip(xs, pro):
        s.box(x, 152, 188, 56, a, b, "pro", tsize=13, ssize=11)
    for i in range(2):
        s.arrow(xs[i] + 188, 72, xs[i + 1], 72)
        s.arrow(xs[i] + 188, 180, xs[i + 1], 180)
    # booking box
    s.box(760, 52, 320, 150, "ONE BOOKING", "origin: FACILITY_POSTED|PRACTITIONER_APPLIED|LISTING_BOOKED|Agreed level, rate and unit, fee policy,|cancellation rules — snapshotted at acceptance", "sys", tsize=18, ssize=12)
    s.arrow(686, 72, 760, 100)
    s.arrow(686, 180, 760, 152)
    # chain
    s.arrow(920, 202, 920, 262)
    s.text(1010, 240, "same from here on", 11.5, 600, C["sys_s"])
    chain = [("Credential", "revalidation"), ("Payment", "authorisation"), ("Confirmed", "booking"), ("Attendance", ""), ("Timesheet", ""), ("Approval", "or dispute"), ("Settlement", ""), ("Two-way", "review")]
    w, g, x0, y0 = 122, 11, 12, 270
    for i, (a, b) in enumerate(chain):
        x = x0 + i * (w + g)
        kind = "mon" if i in (1, 6) else "sys"
        s.box(x, y0, w, 64, a, b or None, kind, tsize=13, ssize=11)
        if i < len(chain) - 1:
            s.arrow(x + w, y0 + 32, x + w + g, y0 + 32)
    # notes
    notes = [
        (12, "Checked again at confirmation", "licence, level, competence,|consent, facility status, clock", "sys"),
        (386, "A licensed provider holds the money", "Medilink records the ledger,|never the balance", "mon"),
        (760, "Contact released only after acceptance", "approximate area before that;|no phone, no street address", "fac"),
    ]
    for x, a, b, k in notes:
        s.box(x, 380, 330, 92, a, b, k, tsize=13.5, ssize=12)
    s.arrow(73, 334, 180, 380)
    s.arrow(300, 334, 540, 380)
    s.arrow(990, 334, 930, 380)
    s.text(550, 502, "Colours: orange = facility side · blue = professional side · teal = Medilink system · violet = money handled by the licensed provider", 11.5, 400, C["muted"])
    return s.save("fig1-engagement")


def fig2():
    s = Svg(1100, 640)
    s.text(550, 24, "Filled = exists today (named as in the code) · Dashed outline = new in v3", 12, 600, C["muted"])
    bw, bh, gap = 150, 70, 30
    x0 = 25
    row1 = [
        ("PROPOSED", "today: INVITED", True),
        ("NEGOTIATING", "counter-offer, ≤ 2 rounds", False),
        ("ACCEPTED", "soft hold; revalidate", True),
        ("AWAITING|FUNDS", "provider authorisation", False),
        ("CONFIRMED", "today: CONFIRMED", True),
        ("IN PROGRESS", "today: CHECKED_IN", True),
    ]
    y1 = 56
    for i, (a, b, ex) in enumerate(row1):
        x = x0 + i * (bw + gap)
        s.box(x, y1, bw, bh, a, b, "sys", dashed=not ex, tsize=13, ssize=10.5)
        if i < 5:
            s.arrow(x + bw, y1 + bh / 2, x + bw + gap, y1 + bh / 2)
    s.poly([(x0 + 5 * (bw + gap) + bw / 2, y1 + bh), (x0 + 5 * (bw + gap) + bw / 2, 168), (x0 + bw / 2, 168), (x0 + bw / 2, 200)])
    row2 = [
        ("AWAITING|APPROVAL", "today: SUBMITTED", True),
        ("APPROVED", "today: COMPLETED", True),
        ("SETTLED", "funds captured and split", False),
        ("PAID OUT", "today: payout SETTLED", True),
        ("REVIEWED", "both reviewed", False),
    ]
    y2 = 200
    for i, (a, b, ex) in enumerate(row2):
        x = x0 + i * (bw + gap)
        s.box(x, y2, bw, bh, a, b, "sys", dashed=not ex, tsize=12.5, ssize=10.5)
        if i < 4:
            s.arrow(x + bw, y2 + bh / 2, x + bw + gap, y2 + bh / 2)
    # disputed
    s.box(x0 + 0.5 * (bw + gap), 330, bw + 40, bh, "DISPUTED", "holds only the disputed amount", "red", tsize=13, ssize=10.5)
    s.arrow(x0 + bw / 2 + 20, y2 + bh, x0 + bw / 2 + 60, 330, red=True)
    s.arrow(x0 + bw + gap + bw / 2 - 10, 330, x0 + bw + gap + bw / 2 - 10, y2 + bh, red=True)
    s.text(x0 + 300, 366, "After settlement a dispute is resolved by a reversal entry, never by editing the original", 12, 600, C["red_s"], anchor="start")
    # off-ramps
    s.band(10, 430, 1080, 190, "Off-ramps — each records who, when and why", "gry")
    offs = [
        ("DECLINED · EXPIRED", "WITHDRAWN|from PROPOSED, NEGOTIATING,|ACCEPTED; hold released", 24),
        ("CANCELLED", "from ACCEPTED to CONFIRMED;|by whom, in which notice window;|never a no-show for the professional", 238),
        ("NO-SHOW", "from CONFIRMED; detected 30 min|after start; fault decided|before any sanction", 452),
        ("EXCUSED", "from CONFIRMED; the facility|releases the professional;|no sanction, no reliability penalty", 666),
        ("REPLACED", "after a cancel or no-show;|reopens with the original terms;|the new booking records its origin", 880),
    ]
    for a, b, x in offs:
        s.box(x, 470, 190, 120, a, b, "red", dashed=True, tsize=13, ssize=10.5)
    return s.save("fig2-booking-states")


def fig3():
    s = Svg(1100, 700)
    cols = [(30, "Facility", "fac", 240), (300, "Licensed payment provider", "mon", 270), (600, "Professional", "pro", 230), (850, "Medilink", "sys", 220)]
    centers = {}
    for i, (x, name, k, w) in enumerate(cols):
        s.box(x, 14, w, 46, name, None, k, tsize=15)
        centers[i] = x + w / 2
        s.parts.append(f'<line x1="{centers[i]}" y1="62" x2="{centers[i]}" y2="560" stroke="{C["gry_s"]}" stroke-width="1.5" stroke-dasharray="3 5"/>')
    s.text(centers[1], 82, "holds the money — Medilink never does", 11.5, 600, C["mon_s"])

    def lab(cx, y, t, size, weight, fill):
        wd = len(t) * size * 0.56 + 14
        s.parts.append(f'<rect x="{cx - wd / 2}" y="{y - size}" width="{wd}" height="{size + 6}" fill="#ffffff"/>')
        s.text(cx, y, t, size, weight, fill)

    def flow(y, a, b, t, sub):
        xa, xb = centers[a], centers[b]
        s.arrow(xa, y, xb, y)
        lab((xa + xb) / 2, y - 10, t, 12.5, 700, C["ink"])
        lab((xa + xb) / 2, y + 22, sub, 10.5, 400, C["muted"])

    flow(130, 0, 1, "1  Accepts the quote and pays", "₦40,000 agreed pay + ₦2,000 service fee = ₦42,000")
    s.box(centers[1] - 150, 178, 300, 54, "2  Authorises and safeguards ₦42,000", "booking becomes CONFIRMED and funded", "mon", tsize=12.5, ssize=10.5)
    flow(290, 0, 1, "3  Shift attended; timesheet approved", "(auto-approved after N days unless disputed)")
    flow(366, 1, 2, "4  Releases ₦40,000", "to the professional's verified bank account")
    flow(440, 1, 3, "4b  Releases the ₦2,000 fee", "to Medilink (provider charge: decision pending)")
    s.box(centers[3] - 150 if False else 760, 478, 330, 54, "5  Ledger records every entry", "gross · fee · tax · provider charge · facility debit · payout", "sys", tsize=12.5, ssize=10.5)
    s.box(30, 574, 1040, 112, "Side paths", "Dispute: only the disputed amount is held; the undisputed part settles on schedule. After settlement a reversal entry corrects it.|Cancellation: the provider voids or captures part, according to the cancellation rules snapshotted at acceptance.|Provider timeout or repeated webhook: a pending state and idempotent handling — never recorded as a failure while money may have moved.", "gry", tsize=13, ssize=11.5)
    return s.save("fig3-money-flow")


def fig4():
    s = Svg(1100, 410)
    phases = [
        ("0", "Make it safe", "~4 weeks", "P0 gaps; SMS; deploy;|backups; public pages", "red"),
        ("1", "Gombe pilot", "6–8 weeks", "free; levels in the data;|fee row at 0%", "sys"),
        ("2", "Two-sided", "6–8 weeks", "listings; offers;|counters; one Booking", "pro"),
        ("3", "Money you|can trust", "6–8 weeks", "provider; reconciliation;|then the fee", "mon"),
        ("4", "Trust and|retention", "ongoing", "reviews; repeat;|recurring; replacement", "sys"),
        ("5", "Resource|Exchange", "after traffic", "verified resources;|deposits; commission", "fac"),
        ("6", "Premium|and sponsors", "after traffic", "subscriptions; labelled|sponsors only", "gry"),
    ]
    w, g, x0, y0 = 144, 12, 14, 70
    for i, (n, a, d, b, k) in enumerate(phases):
        x = x0 + i * (w + g)
        kk = k if k != "gry" else "gry"
        s.box(x, y0, w, 150, f"Phase {n}|{a}", d + "|" + b, kk, tsize=13, ssize=11)
        if i < 6:
            s.arrow(x + w, y0 + 75, x + w + g, y0 + 75)
    s.text(550, 30, "Order of work: make it safe → prove the loop in one place → open both sides → make money trustworthy → grow", 14, 700, C["ink"])
    # gates sit on the boundary between phases, directly under the arrow
    gates = [(1, "Gate: P0 closed;|restore drilled"), (2, "Gate: ≥ 50 verified;|fill ≈ 70%"), (4, "Gate: reconciliation clean;|counsel sign-off → fee on")]
    for idx, t in gates:
        gx = x0 + idx * (w + g) - g / 2
        s.parts.append(f'<line x1="{gx}" y1="{y0+150}" x2="{gx}" y2="232" stroke="{C["fac_s"]}" stroke-width="1.5" stroke-dasharray="3 4"/>')
        s.parts.append(f'<polygon points="{gx},232 {gx+11},243 {gx},254 {gx-11},243" fill="{C["fac_s"]}"/>')
        for j, ln in enumerate(t.split("|")):
            s.text(gx, 274 + j * 14, ln, 11, 600, C["fac_t"])
    # long lead
    s.band(14, 308, 3 * (w + g) - g, 84, "", "sys")
    s.text(28, 332, "Long-lead work starts in Phase 0:", 12.5, 700, C["sys_t"], anchor="start")
    s.text(28, 350, "counsel · NDPC registration · payment provider · clinical safety lead", 12, 400, C["muted"], anchor="start")
    s.parts.append(f'<rect x="28" y="362" width="{3*(w+g)-g-28}" height="12" rx="6" fill="{C["sys_s"]}" opacity="0.55"/>')
    return s.save("fig4-roadmap")


def render(svg, w, h):
    chrome = None
    base = "/opt/pw-browsers"
    for d in sorted(os.listdir(base)):
        cand = os.path.join(base, d, "chrome-linux", "chrome")
        if d.startswith("chromium-") and os.path.exists(cand):
            chrome = cand
    png = svg.replace(".svg", ".png")
    subprocess.run([chrome, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                    "--force-device-scale-factor=2", f"--window-size={w},{h + 200}", f"--screenshot={png}", f"file://{svg}"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    from PIL import Image
    im = Image.open(png).convert("RGB")
    im.crop((0, 0, w * 2, h * 2)).save(png)
    return png


if __name__ == "__main__":
    for fn, (w, h) in ((fig1, (1100, 520)), (fig2, (1100, 640)), (fig3, (1100, 700)), (fig4, (1100, 410))):
        p = fn()
        print(render(p, w, h))
