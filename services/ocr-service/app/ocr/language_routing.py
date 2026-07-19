"""Script/language routing (CR-001 Sprint OCR-03 design brief §4, "Option
A — Script or Language Routing" with the "Option B" confidence-comparison
folded in for close calls).

PaddleOCR's per-language `PaddleOCR(lang=...)` pipelines each run their
own text *detection* pass, not just recognition — so an Arabic-configured
pipeline and an English-configured pipeline over the same image can
report slightly different region polygons for the same physical line.
This module reconciles the two independent passes by IoU-matching their
regions (the same technique `region_detection/regions.py` already uses
for candidate-region dedup) rather than assuming a shared detection step.

Kept as pure functions over plain dataclasses — independently unit-
testable with synthetic data, no PaddleOCR/model dependency at all.
"""

from __future__ import annotations

from dataclasses import dataclass

# Two detections are treated as "the same physical region" (recognized by
# both language pipelines) once their axis-aligned boxes overlap by at
# least this fraction (intersection / union) — mirrors the threshold
# style already used in region_detection/regions.py.
_IOU_MATCH_THRESHOLD = 0.5
# Below this gap between the two candidates' confidence, both are kept as
# alternatives on the merged region rather than silently discarding the
# loser (design brief §4: "preserve both candidates when scores are
# close").
_CLOSE_CONFIDENCE_DELTA = 0.10


@dataclass(frozen=True)
class LanguageCandidate:
    """One language pipeline's recognition of one detected region."""

    text: str
    confidence: float
    language: str  # "ar" | "en"
    script: str  # "ARABIC" | "LATIN"
    direction: str  # "RTL" | "LTR"
    polygon: list[tuple[float, float]]  # 4 (x, y) points, detector order


@dataclass(frozen=True)
class MergedRegion:
    primary: LanguageCandidate
    alternatives: list[LanguageCandidate]
    ambiguous: bool


def _axis_aligned_box(polygon: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return min(xs), min(ys), max(xs), max(ys)


def _iou(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> float:
    ax0, ay0, ax1, ay1 = _axis_aligned_box(a)
    bx0, by0, bx1, by1 = _axis_aligned_box(b)
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    intersection = (ix1 - ix0) * (iy1 - iy0)
    area_a = (ax1 - ax0) * (ay1 - ay0)
    area_b = (bx1 - bx0) * (by1 - by0)
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def merge_language_results(
    candidates_by_language: dict[str, list[LanguageCandidate]],
) -> list[MergedRegion]:
    """Merges independent per-language detection+recognition passes into
    one region list. A region detected by only one language's pass is
    kept as-is (nothing is ever discarded for lacking a second opinion);
    a region detected by more than one pass keeps the higher-confidence
    reading as primary and preserves the rest as alternatives, marking
    the region ambiguous when the scores are close.
    """
    languages = list(candidates_by_language.keys())
    if not languages:
        return []

    pool: list[tuple[str, int, LanguageCandidate]] = [
        (lang, idx, cand)
        for lang in languages
        for idx, cand in enumerate(candidates_by_language[lang])
    ]
    consumed: set[tuple[str, int]] = set()
    merged: list[MergedRegion] = []

    for lang, idx, cand in pool:
        key = (lang, idx)
        if key in consumed:
            continue
        consumed.add(key)
        group = [cand]
        for other_lang, other_idx, other_cand in pool:
            other_key = (other_lang, other_idx)
            if other_key in consumed or other_lang == lang:
                continue
            if _iou(cand.polygon, other_cand.polygon) >= _IOU_MATCH_THRESHOLD:
                group.append(other_cand)
                consumed.add(other_key)

        group.sort(key=lambda c: c.confidence, reverse=True)
        primary = group[0]
        alternatives = group[1:]
        ambiguous = bool(alternatives) and (primary.confidence - alternatives[0].confidence) < (
            _CLOSE_CONFIDENCE_DELTA
        )
        merged.append(MergedRegion(primary=primary, alternatives=alternatives, ambiguous=ambiguous))

    return merged
