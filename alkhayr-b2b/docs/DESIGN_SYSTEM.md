# ALKHAYR — Design system and UI rules (stage 10)

Arabic-first (RTL) B2B ordering portal. Clear, calm, business-like: no marketing hero sections,
childish decoration or obstructive animation. Source: `src/web/styles/*`, `src/web/components/*`,
`src/web/layouts/*`. Development preview: `npm run dev` → `http://localhost:3000/#/__gallery`.

## 1. Brand assets
- **Logo:** `assets/brand/alkhayr-logo-original.png` is the **authentic logo supplied by the owner**
  (D-011); the web uses the optimized derivative `public/assets/brand/alkhayr-logo-480.png` (D-028).
  It is not a provisional wordmark. Alt text: «الخير».
- **Product imagery:** only administrator-supplied `https` image URLs (loaded with no referrer, never
  fetched by the server) or a truthful placeholder «لا توجد صورة». No invented packaging,
  certifications, sales figures, growth metrics or testimonials anywhere in the UI.
- **Font:** IBM Plex Sans Arabic (SIL Open Font License 1.1), pinned package
  `@fontsource/ibm-plex-sans-arabic@5.3.0`, Arabic + Latin subsets, weights 400/500/600/700, bundled as
  local `woff2` files (≈ 257 KB total, loaded per unicode-range and weight actually used). Licence:
  `licenses/IBM-Plex-Sans-Arabic-OFL-1.1.txt` and a preserved notice in the built CSS. Fallback stack:
  Segoe UI, Tahoma, Noto Sans Arabic, Arial. No remote font or script service.

## 2. Colour tokens (`styles/tokens.css`) and verified contrast
Ratios computed with the WCAG 2.x relative-luminance formula (script output recorded in PROJECT_STATE).

| Pair | Ratio | Use |
|---|---:|---|
| text `#352C2B` on background `#FAF7F2` | 12.71 | body text (owner palette) |
| text on surface `#FFFFFF` | 13.58 | cards, tables |
| primary `#A72E35` on background | 6.37 | links, active navigation |
| white on primary `#A72E35` | 6.81 | primary buttons |
| white on primary-strong `#8A242A` | 8.87 | hover/pressed |
| muted `#6B5D58` on background / white | 5.90 / 6.30 | secondary text |
| success `#2B6338` / warning `#7A4D00` / danger `#9B1C22` / info `#1D4F8C` / neutral `#4A403D` on their tints | 6.26 / 6.59 / 6.94 / 7.04 / 8.33 | badges, notices |
| category text on tint: chocolate / candy / wafers / snacks | 8.87 / 6.44 / 6.75 / 5.76 | category labels, card accent stripe |
| focus ring `#1F5FAE` on background / white | 5.94 / 6.35 | keyboard focus |

**Known unsuitable pairs (not used for text):** `#857873` on background = 3.98 (decorative icons
only); focus blue on primary red = 1.07 → focus rings are always drawn **offset outside** the element
(against the page or surface), never on the red. Control borders `#8C7F79` = 3.87 on white (≥ 3:1 for
non-text UI). Status is never conveyed by colour alone (text + icon in every badge).

Category accents are restrained packaging-inspired hues (chocolate brown, candy plum, wafer gold,
snack green) used only as small badges and a 4 px stripe under product images — no large pink areas.

## 3. Typography, direction and formatting
- `<html lang="ar" dir="rtl">`; CSS uses logical properties (`inline`/`block`, `inset-inline-*`,
  `padding-inline-*`), so no mirrored overrides are needed. DOM order equals visual reading order.
- Scale: 13 / 14 / 16 / 18 / 22 / 28 px; line height 1.7 for Arabic.
- Words wrap only at word boundaries (`overflow-wrap: break-word`); Arabic words are never split.
- **Mixed-direction identifiers** (barcodes, order numbers, usernames, phone numbers, request ids,
  amounts) are wrapped in `<bdi dir="ltr">` (`Ltr`, `Money` components), so they are never reversed.
- **Digits:** Western digits for all amounts, quantities, dates and identifiers (D-106).
- **Money** (`format.ts`): integer piasters → `1,255.50 ج.م`, exact integer arithmetic (no floating
  division), correct up to the 1e13 order limit.
- **Units:** prices are per **carton** («سعر الكرتونة»); pack size «24 قطعة في الكرتونة»; minimum
  «أقل كمية: كرتونتان». The per-piece price is labelled «للعلم فقط … للقطعة — البيع بالكرتونة فقط»,
  rounded half-up to whole piasters, and is never presented as a selling price.
- Arabic plural forms via `Intl.PluralRules('ar')`: كرتونة واحدة · كرتونتان · 3 كراتين · 11 كرتونة.
- Dates: `ar-EG` with Latin digits, Africa/Cairo time zone.

## 4. Components (`src/web/components`)
| Component | Notes |
|---|---|
| `Button`, `IconButton`, `ButtonLink` | variants primary/secondary/ghost/danger, small/block; `busy` disables and sets `aria-busy` (prevents accidental double submission only — server idempotency/version checks remain authoritative); icon buttons require an accessible name; 44 px targets |
| `Field`, `TextInput`, `TextArea`, `Select`, `PasswordInput`, `OtpInput`, `FormErrors` | visible labels; hint/error linked with `aria-describedby`; `aria-invalid`; password show/hide toggle (`aria-pressed`); one-field 6-digit OTP with `autocomplete="one-time-code"`; server field errors summarised with `role="alert"` |
| `SearchInput`, `FilterBar` | real `<form role="search">`; explicit submit |
| `OrderStatusBadge`, `AvailabilityBadge`, `MerchantStatusBadge`, `AllocationBadge`, `CategoryBadge`, `DemoBadge` | text + icon; availability badge has no way to show stock counts |
| `Spinner`, `Skeleton`, `SkeletonLines` | status announced; skeleton hidden from assistive tech; shimmer disabled under reduced motion |
| `EmptyState`, `StateView`, `ErrorState`, `ConflictNotice`, `Notice` | `ErrorState` per failure kind (network/401/403/404/409/428/429/503/500/invalid), keeps the request id; retry only where meaningful; `ConflictNotice` keeps the user's draft and offers "show current data" — never overwrites |
| `DataTable`, `LoadMore` | caption, `scope` headers, focusable horizontally scrollable region (page never overflows); keyset "load more" matching the signed API cursors (no invented totals/page numbers) |
| `Dialog`, `ConfirmDialog` (also drawer variant) | native `<dialog>` `showModal()` (background inert), Tab wraps inside, Escape closes (blocked while busy), focus restored to the opener, initial focus `data-autofocus` |
| `ProductCard`, `ProductImage` | carton price vs informational piece price, pack size, minimum, LTR barcode, availability status, category accent, demo badge, truthful image fallback |
| `QuantityStepper` | whole cartons; typed or ± ; Arabic-Indic digits accepted on input; invalid text keeps the value `null` so it cannot be submitted |
| `OrderTimeline` | from the order's own events (snapshots); actor/reason rendered only when present (administrator views) |
| `OrderTotals`, `SummaryRow` | the stored order amounts; never recomputed in the browser |
| `ToastProvider`/`useToast` | polite status / assertive errors; for real server results only |
| `Ltr`, `Money`, `Cartons`, `RequestRef` | direction-safe text primitives |

## 5. Application shells (`src/web/layouts`)
| Shell / state | Behaviour |
|---|---|
| `AuthLayout` | signed out, session expired, network failure (centered card, logo) |
| `MerchantLayout` — approved | header links (desktop) + bottom tab bar (phone): الكتالوج · طلباتي · حسابي; logout in the header on every width |
| `MerchantLayout` — pending | only «حسابي»; pending-approval screen instead of catalog/orders |
| `AdminLayout` | grouped sidebar ≥ 1024 px; below that a menu button opens a focus-managed drawer with the same groups, account and logout (no tiny bottom tabs) |
| Identity loading / expired / reauthentication required (428) / forbidden / not found / network failure | dedicated `States.tsx` views |

The shell chosen depends on `GET /auth/me`; **this is presentation only** — the server authorizes
every request. No administrator data is requested before `/auth/me` reports an administrator.

## 6. Production screens in stage 10
Real: identity detection, the three shells, the read-only account page (from `/auth/me`) and **real
logout** (`POST /auth/logout`; failure is reported and the session stays valid). Catalog, orders and
administration areas show an honest «هذه الشاشة قيد الإنشاء — تُضاف في المرحلة 11/12» notice; sign-in
and registration screens arrive in stage 11. No decorative button reports success.

## 7. Development gallery
`src/web/main.dev.tsx` (development builds only) registers `#/__gallery` and
`#/__gallery/layout/<name>`: every component and identity state with **synthetic** fixtures
(`gallery/fixtures.ts`, marker `ALKHAYR-SYNTHETIC-PREVIEW-FIXTURE`). It calls no API, creates no session,
persists nothing and is not imported by the production entry `main.tsx`. Tests prove the production
bundle contains neither the gallery nor the fixtures, and the browser check proves `#/__gallery` in a
production build shows the normal application.

## 8. Motion and responsiveness
Transitions 120–180 ms on colour only; spinner and skeleton are the only animations and are disabled
by `prefers-reduced-motion: reduce`. Breakpoints: 30 rem (compact header), 48 rem (merchant desktop
nav), 64 rem (admin sidebar). Verified at 375, 768 and 1366 px (PROJECT_STATE).

## 9. CSP
Unchanged: `style-src 'self'`, `script-src 'self'`, `font-src 'self'`, no `unsafe-inline`/`unsafe-eval`.
No inline `<style>`/`style=""`; dynamic sizes/colours (skeleton width, gallery swatches) are set through
the CSSOM, which the CSP permits. No style exception was required.

## 10. Stage 11 additions
- `ErrorSummary`: focusable summary (receives focus after a failed submission) whose items link to fields;
  `Field` accepts a stable `id` for those links.
- `QuantityStepper` `labelSuffix`: product name added to the accessible label only (no repeated long names).
- Cart line, checkout review line, product detail, collapsible catalog filters ("تصفية وترتيب", open when a
  filter is active) so phones show products on the first screen.
- Toasts moved to the top under the header (max two) so they never cover the bottom tab bar or actions.
- Merchant bottom tabs: الكتالوج · السلة (count) · طلباتي · حسابي.
- Rates inside Arabic text are LTR-isolated («(14%)»).

## 11. Stage 12 additions (administration)
- Administrator navigation: الرئيسية (landing, links only, no figures) · الطلبات · المنتجات · المخزون · التجار ·
  company purchasing; the landing entry is current only on `#/admin`.
- Tables (`DataTable`) stay inside their card and scroll horizontally only within the table; filters collapse
  under "تصفية وترتيب" on phones (verified at 360, 375, 768, 1366 px without page-wide horizontal scroll).
- Stock figures: `c-stat-row` (total / reserved / available); signed differences are LTR-isolated with a true
  minus sign. Preview of an adjustment uses the summary rows (current, proposed, difference, reserved unchanged,
  available after).
- Destructive or consequential actions (suspension, deactivation, cancellation, stock movement) always pass
  through `ConfirmDialog` with the consequence spelled out; danger tone for suspension, deactivation and
  cancellation.
- Operation notices: sending (status), outcome unknown (warning, with the operation key), refusal (danger),
  replay ("already recorded — not repeated", success).
- Snapshot vs current: order lines show the ordered name/price/packaging, and a separate "الآن" column with the
  current product state, packaging changes and availability; buyer data at order time is separate from the
  merchant's current account.
