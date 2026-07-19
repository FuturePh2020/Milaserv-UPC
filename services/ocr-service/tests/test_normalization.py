"""CR-001 Sprint OCR-03 — text normalization (design brief §8)."""

from app.ocr.normalization import normalize_arabic, normalize_english, normalize_text


def test_removes_tatweel():
    assert normalize_arabic("بـــسم") == "بسم"


def test_removes_diacritics():
    assert normalize_arabic("السَّلَامُ عَلَيْكُمْ") == "السلام عليكم"


def test_normalizes_alef_variants_to_bare_alef():
    assert normalize_arabic("أحمد إبراهيم آدم") == "احمد ابراهيم ادم"


def test_normalizes_alef_maksura_to_yeh():
    assert normalize_arabic("على") == "علي"


def test_does_not_fold_teh_marbuta_into_heh():
    # Explicit design-brief requirement: never blindly replace ة with ه.
    assert normalize_arabic("صيدلية") == "صيدلية"
    assert "ه" not in normalize_arabic("صيدلية").replace("صيدلي", "")


def test_normalizes_arabic_indic_digits_to_western():
    assert normalize_arabic("٥٠٠ ملغ") == "500 ملغ"


def test_arabic_digit_normalization_is_configurable():
    result = normalize_arabic("٥٠٠", normalize_digits=False)
    assert result == "٥٠٠"


def test_preserves_raw_text_separately():
    raw = "أَحْمَد"
    normalized = normalize_arabic(raw)
    assert raw != normalized
    assert raw == "أَحْمَد"  # never mutated


def test_english_lowercases_and_normalizes_whitespace():
    assert normalize_english("  Augmentin   1  GM  ") == "augmentin 1 gm"


def test_english_normalizes_smart_quotes_and_hyphens():
    assert normalize_english("Doctor’s “note” – urgent") == "doctor's \"note\" - urgent"


def test_normalize_text_dispatches_on_script():
    assert normalize_text("Augmentin", "LATIN") == "augmentin"
    assert normalize_text("أوجمنتين", "ARABIC") == "اوجمنتين"


def test_normalize_text_falls_back_safely_for_unknown_script():
    # Must never raise — worst case behaves like the English normalizer.
    assert normalize_text("Foo", None) == "foo"
