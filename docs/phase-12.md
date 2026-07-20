# Phase 12 — AI Readiness (Acceptance Record)

Implements `docs/specs/ai-readiness-spec-v1.0.md` — blueprint §2.1
(«إنشاء بنية جاهزة للذكاء الاصطناعي دون مشاركة بيانات خارجية إلا وفق
سياسة معتمدة») and the §23 "AI" line. The blueprint defines no concrete
AI features, so per the §1 governance rules **none were invented**: this
phase delivers the readiness architecture they will plug into, plus the
single upgrade slot already flagged in an approved spec (OCR I3).

| Area             | Delivered                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway (K1)     | `AiGatewayService.invoke(feature, payload)` — one provider-agnostic seam (POST to `integrations.ai.endpoint`, 5s timeout); returns null on any failure so every caller keeps a non-AI fallback |
| Policy gate (K2) | Two independent default-off switches: `ai.policy.approved` + the endpoint; either off = **no byte leaves the platform**, no per-feature bypass                                                 |
| OCR seam (K3)    | Lines no deterministic tier matched are offered to the gateway with a drug-master candidate shortlist; a suggested materialNo must exist in the master; score 0.6 keeps human review mandatory |
| Audit (K4)       | Every outbound call writes `ai.invoke` (feature, payload bytes, ok) — §19.3 export-logging applied to AI data sharing                                                                          |
| Monitoring       | `ai` joined the §21 connector cards: Configured when the endpoint is set, **Enabled only when the policy is also approved**                                                                    |
| Future features  | Suggested replies, classification, forecasting, … enter scope via Change Requests (§1) naming their feature key, payload contract, and fallback                                                |

## Definition of Done (§24)

- [x] Business rules documented — spec + this record; no new tables or permission keys; 2 settings, both default-off
- [x] Tests — ai suite 5 e2e tests (AI-1..AI-5: closed gate emits nothing and stays byte-identical to Phase 10, half-open gate still emits nothing, open gate suggests at 0.6 with audit, unknown suggestions/bridge failures fall back, connector card mirrors the two-switch gate); full regression **159/159 across 18 suites**
- [x] UAT walkthrough — Chromium 3/3: endpoint configured with policy off → card shows Configured only; policy approved → Enabled; Arabic RTL
- [x] Docs updated; rollback = revert commits (settings are additive)

**This closes the last item of the blueprint's §23 delivery plan.**
See `docs/delivery-summary.md` for the full platform record.
