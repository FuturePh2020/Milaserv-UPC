# Architecture Decision Records

The blueprint (`docs/blueprint/Milaserv360_Enterprise_Blueprint_v1.0.docx`, §25) is the
source of truth. ADR-001…010 are mirrored here for quick reference; new implementation
ADRs are appended as numbered files and must not contradict the blueprint (§1.1 change
management: blueprint updates require an approved Change Request).

| ID      | Decision                                                              |
| ------- | --------------------------------------------------------------------- |
| ADR-001 | PostgreSQL as the primary database.                                   |
| ADR-002 | Modular Monolith first, with clear domain boundaries.                 |
| ADR-003 | Universal Ticket Engine for all teams.                                |
| ADR-004 | `Created By` separate from `Responsible`, `Resolved By`, `Closed By`. |
| ADR-005 | Final Resolution fields are mandatory before closing.                 |
| ADR-006 | Branch Supervisor auto-fetched from the Branch Database.              |
| ADR-007 | Supervisor snapshot stored at ticket-creation time.                   |
| ADR-008 | Configuration over Code for variable values.                          |
| ADR-009 | Every external integration goes through the Integration Layer.        |
| ADR-010 | Search and Reports respect permissions and data scope.                |

## Implementation ADRs (Phase 1)

- [ADR-011 — npm-workspaces monorepo](./ADR-011-monorepo.md)
