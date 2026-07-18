# AI Readiness — Module Specification v1.0

Source: blueprint §2.1 «إنشاء بنية جاهزة للذكاء الاصطناعي دون مشاركة
بيانات خارجية إلا وفق سياسة معتمدة» and §23 "Later: … AI". The blueprint
defines **no concrete AI features** — only the readiness requirement and
the data-sharing policy condition. Per the §1 governance rules («أي متطلب
جديد يُسجل أولًا كـ Change Request»), concrete AI features (suggested
replies, auto-classification, forecasting, …) enter scope through Change
Requests; this phase builds the architecture they will plug into.

Open points are flagged as assumptions K1–K4.

## 1. Blueprint requirements (verbatim mapping)

| Requirement                                   | Delivered as                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| بنية جاهزة للذكاء الاصطناعي                   | `AiGatewayService` — one provider-agnostic outbound seam (K1)           |
| دون مشاركة بيانات خارجية إلا وفق سياسة معتمدة | Hard policy gate: `ai.policy.approved` must be true, else no call (K2)  |
| §23 "AI" upgrade slots named in earlier specs | OCR match assist wired behind the existing I3 interface (K3)            |
| §19.3 data protection (export logging)        | Every outbound AI call is audit-logged with feature + payload size (K4) |

## 2. Design decisions

### K1 — One gateway, provider-agnostic

All future AI features call `AiGatewayService.invoke(feature, payload)` —
a synchronous POST to `integrations.ai.endpoint`
(`{ feature, payload }` → `{ result }`, 5s timeout). The endpoint is a
bridge to whatever provider the company approves (self-hosted model,
Azure, etc.); swapping providers is a settings change, not a code change.
Failures return null so **every caller must have a non-AI fallback** — AI
never becomes a point of failure (same doctrine as Maps J6).

### K2 — The policy gate is a hard precondition

Two independent switches, both default-off:

- `ai.policy.approved` (BOOLEAN, false) — «سياسة معتمدة»: flipped only
  when management approves the data-sharing policy;
- `integrations.ai.endpoint` (STRING, '') — where calls go.

If either is unset, `invoke` returns null without any network activity.
There is no per-feature bypass. The connector card shows the gate state.

### K3 — First seam: OCR drug-match assist (already flagged in spec I3)

OCR spec I3 documented "Fuzzy/AI matching is a §23 'AI' upgrade behind
the same interface". When the gate is open, `OcrMatchService` consults
the gateway **only for lines the deterministic matcher could not match**
(feature `ocr.match`, payload: raw text + the drug-master candidate
shortlist). A returned `materialNo` that exists in the master becomes a
match with score 0.6 (below human-confirmed tiers — review remains
mandatory per I4). Gate closed → behavior is byte-identical to Phase 10.

### K4 — Every call is audited

Each outbound invocation writes an audit row
(`action: ai.invoke`, feature, payload byte size, success/failure) —
the §19.3 export-logging principle applied to AI data sharing. The audit
log is the evidence that the approved policy is being followed.

## 3. Settings (ADR-008)

| Key                        | Default | Meaning                                   |
| -------------------------- | ------- | ----------------------------------------- |
| `ai.policy.approved`       | `false` | Management approval of the sharing policy |
| `integrations.ai.endpoint` | `''`    | AI bridge URL                             |

## 4. Out of scope (awaiting Change Requests per §1)

Any concrete AI feature: suggested ticket replies, auto-classification,
sentiment, forecasting, chat assistants, model choice/hosting. Each will
name its feature key, payload contract, and fallback when proposed.
