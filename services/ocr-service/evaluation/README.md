# OCR accuracy evaluation (CR-001 Sprint OCR-03)

Fixture-based CER/WER/precision/recall/confidence/timing evaluation
(design brief §19). Synthetic, programmatically-rendered fixtures only —
`dataset/generate_fixtures.py` draws known ground-truth strings with a
known system font (DejaVu Sans for English, FreeSerif for Arabic); there
is no real customer prescription or PII anywhere in this dataset.

## Running it

```bash
cd services/ocr-service
source .venv/bin/activate   # this service's own pinned dependencies
python -m evaluation.evaluate_ocr --provider mock        # sanity check
python -m evaluation.evaluate_ocr --provider paddleocr   # real accuracy
```

Each run regenerates `dataset/manifest.json` / `dataset/images/*.png` if
missing, serves them over a throwaway local HTTP server (so the provider
takes the exact same `image_url` → httpx-fetch path production traffic
does), and writes a full per-fixture report to
`results/<provider>-<timestamp>.json` plus a summary to stdout.

## Metrics

- **CER / WER** — Levenshtein edit distance over characters / words,
  normalized by ground-truth length (`metrics.py`). 0.0 is an exact
  match; an empty ground truth scores 1.0 if the provider hallucinates
  any text, 0.0 if it correctly reports nothing.
- **Detection precision/recall** — this synthetic set has no per-region
  bounding-box ground truth, so these are *fixture-level presence*
  metrics (did the provider detect text exactly when the fixture had
  any), not region-level IoU precision/recall. Documented here so the
  numbers are never mistaken for something they're not.
- **Confidence / timing** — mean per-block confidence and wall-clock
  `detect_and_recognize()` duration per fixture.

## Current status in this sandbox

`--provider paddleocr` reliably reports `status: ABORTED` here: every
PaddleOCR/PaddleX model-weight source (`bcebos.com`, `huggingface.co`,
`modelscope.cn`, `aistudio.baidu.com`) is network-blocked by this
sandbox's egress policy, so `initialize()` cannot download model weights
and the run aborts with the real underlying error, never fabricated
numbers. `--provider mock` runs end-to-end and is asserted in
`tests/test_evaluate_ocr.py` as a harness self-check (a provider whose
output is unrelated to the input image must score badly — proving the
metrics aren't trivially returning 0 for everything).

**No Arabic or handwriting accuracy claim is made anywhere in CR-001
Sprint OCR-03 as a result.** Run `--provider paddleocr` in an
environment with real network access to one of the model hosters above
before making or relying on any such claim.
