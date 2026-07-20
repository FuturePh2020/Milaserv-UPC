"""CER/WER edit-distance metrics — CR-001 Sprint OCR-03 design brief §19.

Plain Levenshtein distance, no external dependency: these fixture sets
are small enough that O(n*m) DP is more than fast enough, and it keeps
the evaluation harness free of a jiwer/python-Levenshtein pin that would
need its own version-pinning discipline for one script.
"""

from __future__ import annotations


def _edit_distance(a: list[str] | str, b: list[str] | str) -> int:
    n, m = len(a), len(b)
    if n == 0:
        return m
    if m == 0:
        return n
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        curr = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            curr[j] = min(
                prev[j] + 1,  # deletion
                curr[j - 1] + 1,  # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr
    return prev[m]


def character_error_rate(ground_truth: str, recognized: str) -> float:
    """Edit distance over characters, normalized by ground-truth length.
    1.0 = completely wrong (or non-empty ground truth vs. empty output);
    0.0 = exact match. Ground truth "" is a special case (see below) —
    scoring it 0.0 only when the output is also empty avoids a
    divide-by-zero while still penalizing hallucinated text."""
    if len(ground_truth) == 0:
        return 0.0 if len(recognized) == 0 else 1.0
    return _edit_distance(ground_truth, recognized) / len(ground_truth)


def word_error_rate(ground_truth: str, recognized: str) -> float:
    gt_words = ground_truth.split()
    rec_words = recognized.split()
    if len(gt_words) == 0:
        return 0.0 if len(rec_words) == 0 else 1.0
    return _edit_distance(gt_words, rec_words) / len(gt_words)
