# Knowledge Base Basic — Specification v1.0

**Source of truth:** Blueprint §10 (+§5 "Knowledge Base", §23 Sprint 5) · **Status:** implemented
with flagged assumptions (per §1.1, deviations require a Change Request).

## Scope (— "Basic")

| In                                                                                                                                               | Out (later per blueprint)                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Content library: SOPs, Added SOPs, Daily Notes, Videos, PDF/Word files, Flow Charts (§10.1) with owner, versioning, publish/expiry dates (§10.4) | Quizzes, Certificates (§10.1 "Future")                               |
| Courses with ordered lessons, Course Admin, team/user assignment, due date (§10.2)                                                               | Approval workflow for publishing (§10.4 "اختياريًا") — slot reserved |
| Progress per §10.3: Not Started / In Progress / Completed, Progress %, Last Position, Watch Time, Due Date                                       | SCORM/embedded video player analytics                                |
| Access control: assigned users/teams only; unauthorized content blocked (§10.2); last training activity visible to managers                      | Public e-learning portal                                             |

## Model

- `KbContent(rootId, version, kind, titleAr/En, summaryAr/En, body?, videoUrl?, ownerId, status DRAFT/PUBLISHED/ARCHIVED, publishAt?, expiryAt?, isPublic)` — files attach via the
  generic Attachment engine (`entityType=kb_content`). **Versioning:** `new-version` copies the
  row (version+1, DRAFT); publishing archives the previous published version — history retained (§10.4).
- `Course(titleAr/En, description, courseAdminId, status, dueAt?)` + `CourseLesson(order, title, contentId?, videoUrl?, durationSeconds?)`
- `CourseAssignment(courseId, teamId? | userId?, assignedById, dueAt?)` — team or user target (§10.2).
- `LessonProgress(lessonId, userId, positionSeconds, watchTimeSeconds, completedAt?)` —
  course progress % derived as completed/total lessons; course status derived per §10.3.

## Access rules

- `kb.view`: published+non-expired public content; courses assigned to me or my teams.
- `kb.manage`: full content/course CRUD incl. drafts, versions, publish.
- `kb.assign`: assign courses (also allowed: the course's Course Admin).
- Course progress overview (per-user, incl. last activity §10.2): kb.manage, kb.assign, or Course Admin.
- Role defaults: admins all @ALL_DATA; TEAM_MANAGER +kb.assign; all staff roles kb.view.

## API (v1)

`GET/POST /kb/contents`, `GET /kb/contents/:id` (+`versions`), `PATCH` (drafts only),
`POST /:id/new-version`, `POST /:id/publish`, `POST /:id/archive` ·
`GET/POST /kb/courses`, `GET /kb/courses/:id` (lessons + my progress), `PATCH`,
`POST /:id/lessons`, `DELETE /kb/lessons/:id`, `POST /:id/assign {teamIds?, userIds?, dueAt?}`,
`POST /:id/publish`, `GET /:id/progress` (admin view) ·
`POST /kb/lessons/:id/progress {positionSeconds?, watchTimeDeltaSeconds?, completed?}`

Notifications: course assignment → assigned users (in-app). Audit + timeline on every mutation.

## Assumptions (flagged per §1.1)

- **B1** Videos are URL-based this phase (uploaded video files also work via attachments); an embedded player with position tracking uses `positionSeconds` as provided by the client.
- **B2** "Course visible" = assigned directly or via any of my teams, or I am its Course Admin, or I hold kb.manage.
- **B3** Expired content (expiryAt < now) disappears from the library for viewers but stays for kb.manage.
- **B4** Approval workflow before publish is deferred (blueprint marks it optional); publish is permission-gated + audited.
