from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["provider"] == "mock"


def test_analyze_quality_default_is_high():
    res = client.post("/v1/analyze-quality", json={"imageUrl": "s3://bucket/rx-1.jpg"})
    assert res.status_code == 200
    body = res.json()
    assert body["qualityScore"] >= 0.4
    assert body["issues"] == []


def test_analyze_quality_lowquality_marker_triggers_reupload_gate():
    res = client.post("/v1/analyze-quality", json={"imageUrl": "s3://bucket/lowquality-scan.jpg"})
    body = res.json()
    assert body["qualityScore"] < 0.4
    assert "BLUR" in body["issues"]


# /v1/preprocess's real 18-step image-processing engine (CR-001 Sprint
# OCR-02) is covered in tests/test_preprocessing.py — Sprint OCR-01's
# mock-passthrough contract it replaced is gone; nothing else in this
# file depended on it, only /v1/analyze-quality and /v1/detect-* below.


def test_detect_and_recognize_is_deterministic():
    payload = {"imageUrl": "s3://bucket/rx-deterministic.jpg"}
    first = client.post("/v1/detect-and-recognize", json=payload).json()
    second = client.post("/v1/detect-and-recognize", json=payload).json()
    assert first["blocks"] == second["blocks"]
    assert first["providerUsed"] == "mock"


def test_detect_and_recognize_different_urls_can_yield_different_fixtures():
    seen = set()
    for i in range(12):
        body = client.post(
            "/v1/detect-and-recognize", json={"imageUrl": f"s3://bucket/rx-{i}.jpg"}
        ).json()
        seen.add(len(body["blocks"]))
    # the three canned fixtures have 2, 1, and 0 blocks respectively
    assert seen == {0, 1, 2}


def _blocks_for(image_url: str) -> list[dict]:
    return client.post("/v1/detect-and-recognize", json={"imageUrl": image_url}).json()["blocks"]


def test_detect_candidates_keeps_high_confidence_lines():
    high_conf_url = next(
        f"s3://bucket/rx-{i}.jpg"
        for i in range(20)
        if (blocks := _blocks_for(f"s3://bucket/rx-{i}.jpg")) and all(b["confidence"] >= 0.5 for b in blocks)
    )
    blocks = _blocks_for(high_conf_url)
    cand_res = client.post("/v1/detect-candidates", json={"blocks": blocks})
    assert cand_res.status_code == 200
    lines = cand_res.json()["candidateLines"]
    assert len(lines) == len(blocks)
    assert all(line["extractedDrugText"] for line in lines)


def test_detect_candidates_skips_low_confidence_lines():
    low_conf_url = next(
        f"s3://bucket/rx-{i}.jpg"
        for i in range(20)
        if (blocks := _blocks_for(f"s3://bucket/rx-{i}.jpg")) and any(b["confidence"] < 0.5 for b in blocks)
    )
    blocks = _blocks_for(low_conf_url)
    cand_res = client.post("/v1/detect-candidates", json={"blocks": blocks})
    lines = cand_res.json()["candidateLines"]
    assert len(lines) < len(blocks)


def test_detect_candidates_empty_blocks_yields_no_candidates():
    res = client.post("/v1/detect-candidates", json={"blocks": []})
    assert res.json()["candidateLines"] == []
