"""CR-001 Sprint OCR-03 — script/language routing merge logic (design
brief §4). Pure-function tests — no PaddleOCR/model dependency."""

from app.ocr.language_routing import LanguageCandidate, merge_language_results


def _box(x, y, w, h):
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def _candidate(text, confidence, lang, box):
    script, direction = ("ARABIC", "RTL") if lang == "ar" else ("LATIN", "LTR")
    return LanguageCandidate(text, confidence, lang, script, direction, box)


def test_no_languages_returns_empty():
    assert merge_language_results({}) == []


def test_single_language_region_kept_as_is():
    en = _candidate("Panadol", 0.9, "en", _box(0, 0, 100, 20))
    result = merge_language_results({"en": [en]})
    assert len(result) == 1
    assert result[0].primary.text == "Panadol"
    assert result[0].alternatives == []
    assert result[0].ambiguous is False


def test_overlapping_regions_pick_higher_confidence_as_primary():
    en = _candidate("Augmentin", 0.95, "en", _box(10, 10, 100, 20))
    ar = _candidate("Aujmenlin", 0.40, "ar", _box(11, 10, 98, 20))
    result = merge_language_results({"en": [en], "ar": [ar]})
    assert len(result) == 1
    assert result[0].primary.language == "en"
    assert result[0].alternatives[0].language == "ar"


def test_close_confidence_scores_are_marked_ambiguous_and_both_kept():
    en = _candidate("foo", 0.70, "en", _box(10, 10, 100, 20))
    ar = _candidate("bar", 0.68, "ar", _box(11, 10, 98, 20))
    result = merge_language_results({"en": [en], "ar": [ar]})
    assert result[0].ambiguous is True
    assert len(result[0].alternatives) == 1


def test_far_apart_confidence_scores_are_not_ambiguous():
    en = _candidate("foo", 0.95, "en", _box(10, 10, 100, 20))
    ar = _candidate("bar", 0.20, "ar", _box(11, 10, 98, 20))
    result = merge_language_results({"en": [en], "ar": [ar]})
    assert result[0].ambiguous is False


def test_non_overlapping_regions_from_different_languages_both_survive():
    en = _candidate("Panadol", 0.9, "en", _box(0, 0, 100, 20))
    ar_unrelated = _candidate("صيدلية", 0.9, "ar", _box(500, 500, 50, 20))
    result = merge_language_results({"en": [en], "ar": [ar_unrelated]})
    assert len(result) == 2


def test_never_discards_a_region_only_one_pass_detected():
    en = _candidate("Panadol", 0.9, "en", _box(0, 0, 100, 20))
    ar_only = _candidate("جرعة", 0.85, "ar", _box(0, 100, 100, 20))
    result = merge_language_results({"en": [en], "ar": [ar_only]})
    texts = {r.primary.text for r in result}
    assert texts == {"Panadol", "جرعة"}
