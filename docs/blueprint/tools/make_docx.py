#!/usr/bin/env python3
"""Markdown -> styled .docx (pandoc + python-docx post-processing).

Usage: python3 -I make_docx.py <input.md> <output.docx> <resource_dir> [--font Calibri] [--footer "text"]
"""
import copy
import subprocess
import sys
import tempfile
import os

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor, Inches

inp, outp, resdir = sys.argv[1], sys.argv[2], sys.argv[3]
args = sys.argv[4:]
FONT = "Calibri"
FOOT = "Medilink System Blueprint v3.0 · Draft for team review"
for i, a in enumerate(args):
    if a == "--font":
        FONT = args[i + 1]
    if a == "--footer":
        FOOT = args[i + 1]

TEAL = RGBColor(0x0F, 0x4C, 0x5C)
INK = RGBColor(0x1F, 0x29, 0x37)
MUTED = RGBColor(0x47, 0x55, 0x69)


def set_font(style, size=None, bold=None, color=None, name=None, italic=None):
    f = style.font
    f.name = name or FONT
    rpr = style.element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rf.set(qn(a), name or FONT)
    if size:
        f.size = Pt(size)
    if bold is not None:
        f.bold = bold
    if italic is not None:
        f.italic = italic
    if color is not None:
        f.color.rgb = color


def shade(el_pr, fill):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    el_pr.append(shd)


def make_reference(path):
    from docx.enum.style import WD_STYLE_TYPE
    subprocess.run(["pandoc", "-o", path, "--print-default-data-file", "reference.docx"], check=True)
    d = Document(path)
    sec = d.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.9)
    sec.top_margin, sec.bottom_margin = Cm(2.0), Cm(2.0)
    by_id = {s.style_id: s for s in d.styles}

    def S(sid):
        return by_id.get(sid)

    for sid in ("Normal", "BodyText", "FirstParagraph", "Compact"):
        if S(sid) is not None:
            set_font(S(sid), 10, color=INK)
    for sid in ("BodyText", "FirstParagraph"):
        if S(sid) is not None:
            pf = S(sid).paragraph_format
            pf.space_before, pf.space_after = Pt(0), Pt(6)
            pf.line_spacing = 1.12
    if S("Compact") is not None:
        S("Compact").paragraph_format.space_after = Pt(2)
    h = {"Heading1": (20, TEAL), "Heading2": (14.5, TEAL), "Heading3": (11.5, INK), "Heading4": (10.5, INK)}
    for sid, (sz, col) in h.items():
        st = S(sid)
        if st is not None:
            set_font(st, sz, bold=True, color=col)
            pf = st.paragraph_format
            pf.space_before = Pt(18 if sid == "Heading1" else 12)
            pf.space_after = Pt(6)
            pf.keep_with_next = True
    S("Heading1").paragraph_format.page_break_before = True
    set_font(S("Title"), 34, bold=True, color=TEAL)
    S("Title").paragraph_format.space_before = Pt(60)
    set_font(S("Subtitle"), 15, color=MUTED, bold=False)
    for sid in ("Date", "Author"):
        if S(sid) is not None:
            set_font(S(sid), 11, color=MUTED)
    # code styles: create if absent, because pandoc looks them up by name
    sc = S("SourceCode")
    if sc is None:
        sc = d.styles.add_style("Source Code", WD_STYLE_TYPE.PARAGRAPH)
        sc.base_style = S("Normal")
    set_font(sc, 8.5, name="Consolas", color=RGBColor(0x0B, 0x3B, 0x36))
    shade(sc.element.get_or_add_pPr(), "F1F5F9")
    sc.paragraph_format.space_after = Pt(6)
    vc = S("VerbatimChar")
    if vc is None:
        vc = d.styles.add_style("Verbatim Char", WD_STYLE_TYPE.CHARACTER)
    set_font(vc, 9, name="Consolas", color=RGBColor(0x0B, 0x3B, 0x36))
    if S("BlockText") is not None:
        set_font(S("BlockText"), 10.5, italic=True, color=TEAL)
    for sid in ("ImageCaption", "TableCaption", "Caption"):
        if S(sid) is not None:
            set_font(S(sid), 9, italic=True, color=MUTED)
    d.save(path)


def borders(tbl):
    tblPr = tbl._tbl.tblPr
    old = tblPr.find(qn("w:tblBorders"))
    if old is not None:
        tblPr.remove(old)
    b = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:val"), "single")
        e.set(qn("w:sz"), "4")
        e.set(qn("w:space"), "0")
        e.set(qn("w:color"), "C3CAD3")
        b.append(e)
    tblPr.append(b)
    mar = OxmlElement("w:tblCellMar")
    for edge, w in (("top", 40), ("left", 70), ("bottom", 40), ("right", 70)):
        e = OxmlElement(f"w:{edge}")
        e.set(qn("w:w"), str(w))
        e.set(qn("w:type"), "dxa")
        mar.append(e)
    tblPr.append(mar)


def style_tables(doc, base_pt=8.5):
    for ti, tbl in enumerate(doc.tables):
        borders(tbl)
        ncols = len(tbl.columns)
        size = 10 if ncols == 2 and ti == 0 else base_pt
        for ri, row in enumerate(tbl.rows):
            trPr = row._tr.get_or_add_trPr()
            if ri == 0:
                h = OxmlElement("w:tblHeader")
                h.set(qn("w:val"), "true")
                trPr.append(h)
            cs = OxmlElement("w:cantSplit")
            cs.set(qn("w:val"), "true")
            trPr.append(cs)
            for cell in row.cells:
                tcPr = cell._tc.get_or_add_tcPr()
                if ri == 0 and not (ncols == 2 and ti == 0):
                    shade(tcPr, "E6EEF2")
                for p in cell.paragraphs:
                    p.paragraph_format.space_before = Pt(1)
                    p.paragraph_format.space_after = Pt(1)
                    p.paragraph_format.line_spacing = 1.0
                    for r in p.runs:
                        r.font.size = Pt(size - (0.5 if r.style is not None and r.style.name == "Verbatim Char" else 0))
                        if ri == 0:
                            r.font.bold = True



ORDERS = {
    "settings": ["writeProtection", "view", "zoom", "removePersonalInformation", "removeDateAndTime",
                 "doNotDisplayPageBoundaries", "displayBackgroundShape", "printPostScriptOverText",
                 "printFractionalCharacterWidth", "printFormsData", "embedTrueTypeFonts", "embedSystemFonts",
                 "saveSubsetFonts", "saveFormsData", "mirrorMargins", "alignBordersAndEdges",
                 "bordersDoNotSurroundHeader", "bordersDoNotSurroundFooter", "gutterAtTop", "hideSpellingErrors",
                 "hideGrammaticalErrors", "activeWritingStyle", "proofState", "formsDesign", "attachedTemplate",
                 "linkStyles", "stylePaneFormatFilter", "stylePaneSortMethod", "documentType", "mailMerge",
                 "revisionView", "trackRevisions", "doNotTrackMoves", "doNotTrackFormatting", "documentProtection",
                 "autoFormatOverride", "styleLockTheme", "styleLockQFSet", "defaultTabStop", "autoHyphenation",
                 "consecutiveHyphenLimit", "hyphenationZone", "doNotHyphenateCaps", "showEnvelope",
                 "summaryLength", "clickAndTypeStyle", "defaultTableStyle", "evenAndOddHeaders", "bookFoldRevPrinting",
                 "bookFoldPrinting", "bookFoldPrintingSheets", "drawingGridHorizontalSpacing",
                 "drawingGridVerticalSpacing", "displayHorizontalDrawingGridEvery", "displayVerticalDrawingGridEvery",
                 "doNotUseMarginsForDrawingGridOrigin", "drawingGridHorizontalOrigin", "drawingGridVerticalOrigin",
                 "doNotShadeFormData", "noPunctuationKerning", "characterSpacingControl", "printTwoOnOne",
                 "strictFirstAndLastChars", "noLineBreaksAfter", "noLineBreaksBefore", "savePreviewPicture",
                 "doNotValidateAgainstSchema", "saveInvalidXml", "ignoreMixedContent", "alwaysShowPlaceholderText",
                 "doNotDemarcateInvalidXml", "saveXmlDataOnly", "useXSLTWhenSaving", "saveThroughXslt", "showXMLTags",
                 "alwaysMergeEmptyNamespace", "updateFields", "hdrShapeDefaults", "footnotePr", "endnotePr", "compat",
                 "docVars", "rsids", "mathPr", "attachedSchema", "themeFontLang", "clrSchemeMapping",
                 "doNotIncludeSubdocsInStats", "doNotAutoCompressPictures", "forceUpgrade", "captions",
                 "readModeInkLockDown", "smartTagType", "schemaLibrary", "shapeDefaults", "doNotEmbedSmartTags",
                 "decimalSymbol", "listSeparator"],
    "style": ["name", "aliases", "basedOn", "next", "link", "autoRedefine", "hidden", "uiPriority", "semiHidden",
              "unhideWhenUsed", "qFormat", "locked", "personal", "personalCompose", "personalReply", "rsid", "pPr",
              "rPr", "tblPr", "trPr", "tcPr", "tblStylePr"],
    "pPr": ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr",
            "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap",
            "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid",
            "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection",
            "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"],
    "rPr": ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow",
            "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
            "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs",
            "em", "lang", "eastAsianLayout", "specVanish", "oMath"],
    "tblPr": ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize", "tblStyleColBandSize", "tblW",
              "jc", "tblCellSpacing", "tblInd", "tblBorders", "shd", "tblLayout", "tblCellMar", "tblLook",
              "tblCaption", "tblDescription"],
    "tcPr": ["cnfStyle", "tcW", "gridSpan", "hMerge", "vMerge", "tcBorders", "shd", "noWrap", "tcMar",
             "textDirection", "tcFitText", "vAlign", "hideMark"],
}


def _local(tag):
    return tag.split("}")[1] if "}" in tag else tag


def reorder(el, order):
    idx = {n: i for i, n in enumerate(order)}
    kids = list(el)
    keyed = sorted(range(len(kids)), key=lambda i: (idx.get(_local(kids[i].tag), 999), i))
    if keyed == list(range(len(kids))):
        return
    for k in kids:
        el.remove(k)
    for i in keyed:
        el.append(kids[i])


def normalise_order(root):
    for name, order in ORDERS.items():
        for el in root.iter(qn("w:" + name)):
            reorder(el, order)


def fix_sections(doc):
    for sec in doc.sections:
        pm = sec._sectPr.find(qn("w:pgMar"))
        if pm is not None:
            for a, v in (("w:header", "708"), ("w:footer", "708"), ("w:gutter", "0")):
                if pm.get(qn(a)) is None:
                    pm.set(qn(a), v)



def fix_pandoc_quirks(doc):
    """Repair three schema violations that pandoc's default parts carry, so the files validate."""
    try:
        num = doc.part.numbering_part.element
        for tag in ("w:nsid", "w:tmpl"):
            for el in num.iter(qn(tag)):
                v = el.get(qn("w:val"))
                if v and len(v) != 8:
                    el.set(qn("w:val"), v.upper().zfill(8)[-8:])
    except Exception:
        pass
    st = doc.settings.element
    for z in list(st.findall(qn("w:zoom"))):
        st.remove(z)
    for r in doc.styles.element.iter(qn("w:rPr")):
        if r.text and r.text.strip():
            r.text = None
        for child in r:
            if child.tail and child.tail.strip():
                child.tail = None
    for tag in ("w:embedSystemFonts",):
        for e in list(st.findall(qn(tag))):
            st.remove(e)


def space_around_tables(doc):
    from docx.text.paragraph import Paragraph
    for tbl in doc.tables:
        nxt = tbl._tbl.getnext()
        if nxt is not None and nxt.tag == qn("w:p"):
            Paragraph(nxt, tbl._parent).paragraph_format.space_before = Pt(8)
        prv = tbl._tbl.getprevious()
        if prv is not None and prv.tag == qn("w:p"):
            Paragraph(prv, tbl._parent).paragraph_format.space_after = Pt(4)


def add_field(run, instr):
    for t, txt in (("begin", None), ("instr", instr), ("separate", None), ("text", "1"), ("end", None)):
        if t == "instr":
            e = OxmlElement("w:instrText")
            e.set(qn("xml:space"), "preserve")
            e.text = txt
        elif t == "text":
            e = OxmlElement("w:t")
            e.text = txt
        else:
            e = OxmlElement("w:fldChar")
            e.set(qn("w:fldCharType"), t)
        run._r.append(e)


def footer(doc, text):
    for sec in doc.sections:
        sec.footer.is_linked_to_previous = False
        p = sec.footer.paragraphs[0] if sec.footer.paragraphs else sec.footer.add_paragraph()
        for r in list(p.runs):
            r._r.getparent().remove(r._r)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(text + "  ·  Page ")
        r.font.size = Pt(8)
        r.font.color.rgb = MUTED
        r2 = p.add_run()
        r2.font.size = Pt(8)
        r2.font.color.rgb = MUTED
        add_field(r2, "PAGE")
        r3 = p.add_run(" of ")
        r3.font.size = Pt(8)
        r3.font.color.rgb = MUTED
        r4 = p.add_run()
        r4.font.size = Pt(8)
        r4.font.color.rgb = MUTED
        add_field(r4, "NUMPAGES")


import re

# ---- table-width tuning for pandoc (relative column widths come from the separator dashes)
def cell_split(ln):
    s = ln.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|") and not s.endswith("\\|"):
        s = s[:-1]
    cells, cur, esc = [], "", False
    for ch in s:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            cur += ch
            esc = True
        elif ch == "|":
            cells.append(cur)
            cur = ""
        else:
            cur += ch
    cells.append(cur)
    return [c.strip() for c in cells]


def strip_md(t):
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"\*\*(.*?)\*\*", r"\1", t)
    return t


def rewrite_table(rows):
    cells = [cell_split(r) for r in rows]
    n = len(cells[0])
    body = [r for i, r in enumerate(cells) if i != 1]
    TOTAL = 104.0  # approx characters across the text width at table font size
    req, want = [], []
    for j in range(n):
        texts = [strip_md(r[j]) if j < len(r) else "" for r in body]
        lens = [len(t) for t in texts]
        avg = sum(lens) / max(1, len(lens))
        mx = max(lens) if lens else 0
        longest = 0
        for t in texts:
            for w_ in t.replace("/", " ").split():
                longest = max(longest, len(w_))
        r_ = min(longest, 20) + 2.5
        d_ = 0.7 * avg + 0.3 * min(mx, 80)
        want.append(max(d_, r_))
        req.append(r_)
    if sum(want) <= TOTAL:
        scale = TOTAL / sum(want)
        w = [x * scale for x in want]
    else:
        spare = max(0.0, TOTAL - sum(req))
        extra = [max(0.0, want[j] - req[j]) for j in range(n)]
        te = sum(extra) or 1.0
        w = [req[j] + spare * extra[j] / te for j in range(n)]
        if sum(req) > TOTAL:
            w = [x * TOTAL / sum(req) for x in req]
    dashes = ["-" * max(3, int(round(x * 1.2))) for x in w]
    return [rows[0], "|" + "|".join(dashes) + "|"] + rows[2:]


def fix_tables(text):
    lines = text.split("\n")
    out, i, in_code = [], 0, False
    sep = re.compile(r"^\s*\|[\s:\-|]+\|\s*$")
    while i < len(lines):
        ln = lines[i]
        if ln.strip().startswith("```"):
            in_code = not in_code
            out.append(ln)
            i += 1
            continue
        if not in_code and ln.lstrip().startswith("|") and i + 1 < len(lines) and sep.match(lines[i + 1]):
            j, tbl = i, []
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                tbl.append(lines[j])
                j += 1
            out.extend(rewrite_table(tbl))
            i = j
            continue
        out.append(ln)
        i += 1
    return "\n".join(out)


def fix_images(t):
    return re.sub(r"!\[([^\]]*)\]\((fig/[^)]+)\)", r"![\1](\2){width=6.5in}", t)




def main():
    tmp = tempfile.mkdtemp()
    ref = os.path.join(tmp, "ref.docx")
    make_reference(ref)
    raw = os.path.join(tmp, "raw.docx")
    tuned = os.path.join(tmp, "tuned.md")
    with open(inp, encoding="utf-8") as fh, open(tuned, "w", encoding="utf-8") as fo:
        fo.write(fix_images(fix_tables(fh.read())))
    subprocess.run(["pandoc", tuned, "-f", "markdown", "-o", raw, "--reference-doc", ref, "--columns=60",
                    "--resource-path", resdir, "-V", "lang=en-GB"], check=True)
    d = Document(raw)
    style_tables(d)
    space_around_tables(d)
    footer(d, FOOT)
    fix_sections(d)
    fix_pandoc_quirks(d)
    normalise_order(d.styles.element)
    reorder(d.settings.element, ORDERS["settings"])
    normalise_order(d.element)
    for sec in d.sections:
        normalise_order(sec.footer._element)
    cp = d.core_properties
    cp.title = "Medilink — " + os.path.basename(outp).replace(".docx", "").replace("-", " ")
    cp.author = "Medilink team"
    cp.subject = "System blueprint"
    d.save(outp)
    print("wrote", outp)


main()
