"""CR-001 Sprint OCR-03 — reading-order sorting (design brief §7)."""

from app.ocr.reading_order import ReadingOrderBlock, cluster_rows, sort_reading_order


def _block(index, x, y, w=50, h=20, direction="LTR"):
    return ReadingOrderBlock(index=index, x=x, y=y, width=w, height=h, direction=direction)


def test_empty_input_returns_empty():
    assert sort_reading_order([]) == []


def test_ltr_two_rows_sorted_top_to_bottom_left_to_right():
    blocks = [
        _block(0, x=200, y=10),  # row1, second word
        _block(1, x=10, y=12),  # row1, first word
        _block(2, x=200, y=100),  # row2, second word
        _block(3, x=10, y=98),  # row2, first word
    ]
    assert sort_reading_order(blocks) == [1, 0, 3, 2]


def test_rtl_row_reads_right_to_left():
    blocks = [
        _block(0, x=10, y=10, direction="RTL"),
        _block(1, x=200, y=10, direction="RTL"),
    ]
    assert sort_reading_order(blocks) == [1, 0]


def test_mixed_row_uses_majority_direction():
    blocks = [
        _block(0, x=10, y=10, direction="RTL"),
        _block(1, x=100, y=10, direction="RTL"),
        _block(2, x=200, y=10, direction="LTR"),
    ]
    assert sort_reading_order(blocks) == [2, 1, 0]


def test_slightly_skewed_line_still_clusters_into_one_row():
    # A rotated/skewed prescription line: y drifts by a few px across the
    # line's width, but the blocks still substantially overlap vertically.
    blocks = [
        _block(0, x=10, y=10, h=20),
        _block(1, x=100, y=14, h=20),
        _block(2, x=200, y=18, h=20),
    ]
    rows = cluster_rows(blocks)
    assert len(rows) == 1


def test_clearly_separate_lines_are_not_merged():
    blocks = [
        _block(0, x=10, y=10, h=20),
        _block(1, x=10, y=200, h=20),
    ]
    rows = cluster_rows(blocks)
    assert len(rows) == 2


def test_geometric_order_preserved_for_a_column_layout():
    # Two columns of medication names — reading order must not scramble a
    # column's own top-to-bottom order even though it can't infer columns.
    left_col = [_block(0, x=10, y=10), _block(1, x=10, y=50)]
    right_col = [_block(2, x=300, y=10), _block(3, x=300, y=50)]
    order = sort_reading_order(left_col + right_col)
    left_positions = [order.index(0), order.index(1)]
    right_positions = [order.index(2), order.index(3)]
    assert left_positions[0] < left_positions[1]
    assert right_positions[0] < right_positions[1]
