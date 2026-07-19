"""Reading-order sorting (CR-001 Sprint OCR-03 design brief §7).

Runs *after* recognition — each block already carries the script/language
its recognizer determined, and therefore its display direction. This
module only clusters blocks into rows by vertical overlap (not a naive
top-to-bottom sort — see `cluster_rows`) and orders each row according to
its own dominant direction, so an Arabic line reads right-to-left, an
English line reads left-to-right, and a genuinely mixed row still reads
correctly script-run by script-run.

For layouts too ambiguous to confidently group into rows/columns (a
screenshot with scattered UI text, multiple document columns), this
deliberately does not try to guess column structure — geometric order is
preserved and every block still carries its own coordinates for the
frontend to render, per the design brief's own instruction.
"""

from __future__ import annotations

from dataclasses import dataclass

# Two blocks are considered part of the same text row when their vertical
# spans overlap by at least this fraction of the shorter block's height.
_ROW_OVERLAP_RATIO = 0.5


@dataclass(frozen=True)
class ReadingOrderBlock:
    index: int
    x: float
    y: float
    width: float
    height: float
    direction: str  # "LTR" | "RTL"


def _vertical_overlap_ratio(a: ReadingOrderBlock, b: ReadingOrderBlock) -> float:
    top = max(a.y, b.y)
    bottom = min(a.y + a.height, b.y + b.height)
    overlap = max(0.0, bottom - top)
    shorter = min(a.height, b.height)
    if shorter <= 0:
        return 0.0
    return overlap / shorter


def cluster_rows(blocks: list[ReadingOrderBlock]) -> list[list[ReadingOrderBlock]]:
    """Groups blocks into rows by vertical overlap, not a fixed y-band —
    tolerates slightly skewed/rotated lines where a naive "same y" or
    "same y // N" bucketing would incorrectly split one line in two."""
    ordered = sorted(blocks, key=lambda b: b.y)
    rows: list[list[ReadingOrderBlock]] = []
    for block in ordered:
        placed = False
        for row in rows:
            if any(_vertical_overlap_ratio(block, member) >= _ROW_OVERLAP_RATIO for member in row):
                row.append(block)
                placed = True
                break
        if not placed:
            rows.append([block])
    return rows


def _row_direction(row: list[ReadingOrderBlock]) -> str:
    rtl_count = sum(1 for b in row if b.direction == "RTL")
    ltr_count = len(row) - rtl_count
    return "RTL" if rtl_count > ltr_count else "LTR"


def sort_reading_order(blocks: list[ReadingOrderBlock]) -> list[int]:
    """Returns original block indices in reading order."""
    if not blocks:
        return []
    rows = cluster_rows(blocks)
    rows.sort(key=lambda row: sum(b.y for b in row) / len(row))
    order: list[int] = []
    for row in rows:
        direction = _row_direction(row)
        row_sorted = sorted(row, key=lambda b: b.x, reverse=(direction == "RTL"))
        order.extend(b.index for b in row_sorted)
    return order
