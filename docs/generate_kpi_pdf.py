"""Generate Rentals-KPI-Formulas.pdf from the markdown source."""
from __future__ import annotations

import re
from pathlib import Path

from fpdf import FPDF, FontFace

ROOT = Path(__file__).resolve().parent
MD_PATH = ROOT / "Rentals-KPI-Formulas.md"
PDF_PATH = ROOT / "Rentals-KPI-Formulas.pdf"

FONT_REG = "Arial"
PAGE_W = 210
MARGIN_L = 12
MARGIN_R = 12
USABLE_W = PAGE_W - MARGIN_L - MARGIN_R


class FormulaPDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font(FONT_REG, size=8)
        self.set_text_color(120, 120, 120)
        self.set_x(MARGIN_L)
        self.cell(USABLE_W, 6, "EstateCFO - Rentals KPI Formula Sheet", align="R")

    def footer(self):
        self.set_y(-10)
        self.set_font(FONT_REG, size=8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 6, f"Page {self.page_no()}", align="C")


def setup_fonts(pdf: FPDF) -> None:
    reg = Path("C:/Windows/Fonts/arial.ttf")
    bold = Path("C:/Windows/Fonts/arialbd.ttf")
    if not reg.exists() or not bold.exists():
        raise FileNotFoundError("Arial fonts not found")
    pdf.add_font(FONT_REG, "", str(reg))
    pdf.add_font(FONT_REG, "B", str(bold))


def strip_md(text: str) -> str:
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    return (
        text.replace("÷", "/")
        .replace("−", "-")
        .replace("×", "x")
        .replace("≥", ">=")
        .replace("≤", "<=")
        .replace("→", "->")
        .replace("—", "-")
        .replace("|", " ")
        .strip()
    )


def col_widths(n: int) -> tuple[float, ...]:
    if n == 2:
        return (USABLE_W * 0.34, USABLE_W * 0.66)
    if n == 3:
        return (USABLE_W * 0.30, USABLE_W * 0.50, USABLE_W * 0.20)
    if n == 4:
        return (USABLE_W * 0.22, USABLE_W * 0.40, USABLE_W * 0.18, USABLE_W * 0.20)
    w = USABLE_W / n
    return tuple(w for _ in range(n))


def write_table(pdf: FPDF, rows: list[list[str]]) -> None:
    if not rows:
        return
    n = max(len(r) for r in rows)
    rows = [r + [""] * (n - len(r)) for r in rows]
    rows = [[strip_md(c) for c in r] for r in rows]
    widths = col_widths(n)
    head_style = FontFace(family=FONT_REG, emphasis="BOLD", fill_color=(245, 240, 230))
    body_style = FontFace(family=FONT_REG, size_pt=8)

    pdf.set_x(MARGIN_L)
    with pdf.table(width=USABLE_W, col_widths=widths, line_height=5, text_align="LEFT") as table:
        for ri, row in enumerate(rows):
            tr = table.row()
            for cell in row:
                if ri == 0:
                    tr.cell(cell, style=head_style)
                else:
                    tr.cell(cell, style=body_style)
    pdf.ln(2)


def parse_blocks(text: str) -> list[tuple[str, str | list[list[str]]]]:
    lines = text.splitlines()
    blocks: list[tuple[str, str | list[list[str]]]] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or line == "---":
            i += 1
            continue
        if line.startswith("#"):
            level = len(line) - len(line.lstrip("#"))
            blocks.append((f"h{level}", line.lstrip("#").strip()))
            i += 1
            continue
        if line.startswith("|"):
            table: list[list[str]] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(set(c) <= set("-:") for c in row):
                    table.append(row)
                i += 1
            blocks.append(("table", table))
            continue
        if line.startswith("```"):
            i += 1
            code: list[str] = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            blocks.append(("code", "\n".join(code)))
            i += 1
            continue
        para = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not lines[i].startswith("#") and not lines[i].startswith("|") and not lines[i].startswith("```") and lines[i].strip() != "---":
            para.append(lines[i].strip())
            i += 1
        blocks.append(("p", " ".join(para)))
    return blocks


def write_text(pdf: FPDF, text: str, size: int, bold: bool = False, color=(30, 30, 30)) -> None:
    pdf.set_x(MARGIN_L)
    pdf.set_font(FONT_REG, "B" if bold else "", size=size)
    pdf.set_text_color(*color)
    pdf.multi_cell(USABLE_W, 5, strip_md(text))


def build_pdf() -> None:
    blocks = parse_blocks(MD_PATH.read_text(encoding="utf-8"))

    pdf = FormulaPDF(orientation="P", unit="mm", format="A4")
    pdf.set_left_margin(MARGIN_L)
    pdf.set_right_margin(MARGIN_R)
    pdf.set_auto_page_break(auto=True, margin=14)
    setup_fonts(pdf)
    pdf.add_page()

    # Cover
    pdf.set_font(FONT_REG, "B", size=20)
    pdf.set_text_color(28, 25, 23)
    pdf.set_x(MARGIN_L)
    pdf.multi_cell(USABLE_W, 10, "Rentals KPI Formula Sheet")
    pdf.set_font(FONT_REG, size=10)
    pdf.set_text_color(120, 113, 108)
    pdf.set_x(MARGIN_L)
    pdf.multi_cell(USABLE_W, 6, "EstateCFO - Overview, Financials, CFO Dashboard, Financial Ratios, AR Dashboard")
    pdf.ln(3)
    y = pdf.get_y()
    pdf.set_draw_color(212, 175, 55)
    pdf.set_line_width(0.6)
    pdf.line(MARGIN_L, y, MARGIN_L + USABLE_W, y)
    pdf.ln(5)

    for kind, content in blocks:
        if pdf.get_y() > 270 and kind == "table":
            pdf.add_page()

        if kind == "h1":
            pdf.ln(4)
            write_text(pdf, content, 13, bold=True, color=(28, 25, 23))
            pdf.ln(1)
        elif kind == "h2":
            pdf.ln(3)
            write_text(pdf, content, 11, bold=True, color=(58, 47, 31))
            pdf.ln(1)
        elif kind == "h3":
            pdf.ln(2)
            write_text(pdf, content, 9.5, bold=True, color=(58, 47, 31))
        elif kind == "p":
            write_text(pdf, content, 8.5)
            pdf.ln(1)
        elif kind == "code":
            pdf.set_fill_color(247, 241, 230)
            pdf.set_font(FONT_REG, size=8)
            pdf.set_text_color(40, 40, 40)
            for cl in content.splitlines():
                pdf.set_x(MARGIN_L)
                pdf.multi_cell(USABLE_W, 4.5, strip_md(cl), fill=True)
            pdf.ln(2)
        elif kind == "table":
            write_table(pdf, content)

    pdf.output(str(PDF_PATH))
    print(f"Wrote {PDF_PATH}")


if __name__ == "__main__":
    build_pdf()
