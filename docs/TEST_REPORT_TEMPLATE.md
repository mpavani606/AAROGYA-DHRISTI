# Aarogya Drishti test report

> Simulation only. No real patient information is permitted in test reports.

## Run metadata

- Date/time:
- Commit/revision:
- Node/npm versions:
- Operating system:
- MongoDB test instance:
- Environment (`test` only):

## Commands

| Command | Result | Notes |
|---|---|---|
| `npm run lint` | | |
| `npm test` | | |
| `npm run build` | | |
| `npm run test:e2e -w client` | | |
| `npm audit --omit=dev --audit-level=high` | | |

## API/business-rule checks

| Test ID | Expected behavior | Result | Evidence |
|---|---|---|---|
| MFA-01 | Elevated roles must enroll in MFA | | |
| IMG-01 | Wrong magic bytes are rejected | | |
| AI-01 | Failed image quality returns `image_insufficient` | | |
| AI-02 | AI state/provenance remains separate from signed review | | |
| RBAC-01 | Unassigned user is denied and the attempt is audited | | |
| PRIV-01 | District endpoints return no patient identifiers | | |
| LOC-01 | Location share requires consent, is one-use and expires | | |
| RESET-01 | Reset is system-admin-only and scoped to synthetic seed records | | |

## Required acceptance cases

| Test ID | Expected behavior | Result | Evidence |
|---|---|---|---|
| T01 | Patient can register in Telugu and the selected language is retained | | |
| T03 | Offline registration syncs without creating a duplicate | | |
| T05 | Dark, blurred, and glare-heavy images are flagged; no inference is run | | |
| T06 | A good image returns a safe state with model provenance | | |
| T07 | Doctor disagreement is stored separately from the AI inference | | |
| T08 | ASHA outside the patient assignment receives 403 and an audit entry | | |
| T09 | District administrator cannot retrieve identifiable patient data | | |
| T11 | Expired video token is refused | | |
| T12 | Video recording is disabled by default | | |
| T13 | Missed appointment creates a navigator task | | |
| T14 | Pathology-confirmed diagnosis without a reviewed report is rejected | | |
| T15 | Appointment reminders contain no disease wording | | |
| T16 | Location sharing requires consent and expires | | |
| T17 | Duplicate registration produces a warning | | |
| T19 | Dashboard filters agree with the underlying synthetic data | | |
| T20 | Protected read/edit/export operations produce audit events | | |
| T21 | SLA breach triggers escalation | | |
| T22 | External API failure is queued and retried | | |
| T24 | Demo reset restores only synthetic demo data | | |

## Demo / E2E observations

- Language switching with entered data:
- Offline save and retry:
- Blocked out-of-assignment access:
- Poor-quality image flow:
- Doctor review/override separation:
- Missed appointment follow-up:
- Network failure recovery:

## Defects and disposition

| ID | Severity | Description | Owner | Status |
|---|---|---|---|---|

## Sign-off

- Reviewer:
- Decision:
- Follow-up:
