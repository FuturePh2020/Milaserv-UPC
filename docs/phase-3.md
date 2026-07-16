# Phase 3 — Knowledge Base Basic (Acceptance Record)

Implements `docs/specs/kb-basic-spec-v1.0.md` (blueprint §10, Sprint 5 of §23).
Assumptions B1–B4 applied as flagged.

| Area                       | Delivered                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content library (§10.1)    | SOPs / Added SOPs / Daily Notes / Videos / PDF / Word / Flow Charts with bilingual titles, owner, summaries, body, video URL; files via the generic attachment engine                                                            |
| Versioning (§10.4)         | Published content immutable; new-version → DRAFT (v+1); publishing archives the previous published version; full version history retained and listed                                                                             |
| Publish/expiry (§10.4/B3)  | Drafts hidden from viewers; expired content hidden from viewers, visible to kb.manage                                                                                                                                            |
| Courses (§10.2)            | Ordered lessons (content-linked or video URL), Course Admin, publish gate (≥1 lesson), team/user assignment with due date, in-app assignment notifications, unauthorized access blocked (404)                                    |
| Progress (§10.3)           | Not Started / In Progress / Completed, Progress %, Last Position (positionSeconds), Watch Time (accumulating), Due Date; completion timeline event + course-admin notification                                                   |
| Manager visibility (§10.2) | Per-trainee overview with progress %, last activity, and lastSignInAt; restricted to kb.manage / kb.assign / Course Admin                                                                                                        |
| Permissions                | kb.view / kb.manage / kb.assign; role defaults: managers +kb.assign, all staff kb.view                                                                                                                                           |
| Frontend                   | KB hub (Library + My Courses with progress bars), course page (lesson checklist, mark-complete, trainee table for admins), KB Management screen (contents publish/new-version, courses/lessons/assign), sidebar items, bilingual |
| Hardening                  | PermissionsService no longer 500s when Redis is briefly unavailable — falls back to uncached resolve (§22 Availability)                                                                                                          |

Out of scope (per spec): quizzes, certificates, approval workflow before publish
(slot reserved), embedded video player analytics.

## Definition of Done (§24)

- [x] Business rules documented — spec + this record
- [x] UI + API implemented; migration `kb_basic`; 3 new permissions (34 total)
- [x] Permissions/audit/timeline on every mutation; notifications (assignment, completion) verified by tests
- [x] Tests — KB suite 9 e2e tests; full regression suite green
- [x] UAT walkthrough — Chromium 13/13: admin publishes SOP + course with lessons + team assignment; trainee 0% → 50% → 100%; admin trainee-progress overview; trainee has no KB Management access
- [x] Docs updated; rollback = revert commits + `kb_basic` migration

Next per blueprint §23: Sprint 6 — Break Tracker & Team Live View.
