"""Converts the Word deliverables to Markdown for GitHub, keeping order of
headings, paragraphs, lists, tables and figures. Usage, from the repo root:
python docs/entregables/docx_to_md.py"""
import re
from pathlib import Path
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

ROOT = Path(__file__).resolve().parents[2]
JOBS = [
    ("docs/entregables/Arquitectura-y-DevOps.docx", "docs/ARQUITECTURA.md"),
    ("docs/entregables/Reporte-Pruebas-Audio.docx", "docs/PRUEBAS-AUDIO.md"),
]


def cell(text):
    return text.replace("|", r"\|").replace("\n", "<br>").strip()


def convert(src, dst):
    doc = Document(ROOT / src)
    out, in_list = [], False
    for el in doc.element.body.iterchildren():
        tag = el.tag.split("}")[1]
        if tag == "tbl":
            rows = [[cell(c.text) for c in r.cells] for r in Table(el, doc).rows]
            if not rows:
                continue
            width = max(len(r) for r in rows)
            rows = [r + [""] * (width - len(r)) for r in rows]
            out += ["", "| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
            out += ["| " + " | ".join(r) + " |" for r in rows[1:]]
            out.append("")
            continue
        if tag != "p":
            continue
        p = Paragraph(el, doc)
        text = p.text.strip()
        style = p.style.name if p.style is not None else ""
        if el.xpath(".//w:fldSimple|.//w:instrText"):
            continue
        if not text:
            in_list = False
            continue
        # Word-only navigation aids have no meaning on GitHub.
        if text == "Contenido" or text.startswith("Nota: el índice"):
            continue
        fig = re.search(r"docs/diagrams/img/([\w.-]+\.png)", text)
        if fig:
            caption = re.sub(r"\s*\(exportación:.*?\)", "", text)
            out += ["", f"![{caption}](diagrams/img/{fig.group(1)})", "", f"*{caption}*", ""]
            continue
        level = re.match(r"Heading (\d)", style) or (re.match(r"Title", style) and [None, "1"])
        if level:
            out += ["", "#" * (int(level[1]) + (0 if style == "Title" else 1)) + " " + text, ""]
            in_list = False
        elif "List" in style:
            out.append(("- " if "Bullet" in style else "1. ") + text)
            in_list = True
        else:
            if in_list:
                out.append("")
                in_list = False
            bold = all(r.bold for r in p.runs if r.text.strip()) and len(text) < 120
            out += [f"**{text}**" if bold else text, ""]
    md = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"
    note = f"<!-- Generado desde {src} con docs/entregables/docx_to_md.py. Editar el script generador del .docx y regenerar. -->\n\n"
    (ROOT / dst).write_text(note + md, encoding="utf-8")
    print(dst, len(md.splitlines()), "lineas")


for s, d in JOBS:
    convert(s, d)
