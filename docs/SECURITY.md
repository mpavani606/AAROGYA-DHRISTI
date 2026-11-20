# Security checklist

This project is a synthetic demonstration. It is not a clinical system and is not approved for real patient data.

## Implemented safeguards

- [x] Server secrets are required from environment variables; access, refresh, and encryption secrets reject known placeholder prefixes.
- [x] CORS accepts only the configured comma-separated client origins. Production compose exposes the app through TLS-terminating nginx.
- [x] Helmet CSP, `express-mongo-sanitize`, `hpp`, a global request limit, and stricter limits on login, AI, uploads, registration and location sharing.
- [x] Zod parsing is used for authentication, upload metadata, AI input, patient writes, appointments, location shares, sync operations, dashboard filters, education management, and demo reset. Read-only routes with no client-supplied filters accept no body.
- [x] Multipart uploads are size-limited, checked against file magic bytes and re-encoded when images are accepted.
- [x] Doctor and administrator roles must enroll in MFA before authentication middleware grants access.
- [x] Legacy Employee accounts remain representable for historical records but are denied login, MFA completion, refresh, and protected API access; no user records are deleted or converted.
- [x] Doctor registration creates an unverified profile; professional PDFs/images are private, size/signature validated, encrypted at rest for local storage, and readable only by the owning doctor or System Admin.
- [x] Clinical doctor routes require professional verification; only System Admins may approve, reject, suspend, or reactivate verification, with append-only decision records.
- [x] Patient/case/media/appointment/navigator routes enforce creator or configured assignment relationships; system administrators retain explicit break-glass access.
- [x] Authenticated API routes write access audit entries before handling requests; denied role checks are separately audited. Audit query updates and deletes are rejected by the model.
- [x] Request logs omit bodies and query strings and normalize database IDs. Pino redacts credential and common identity fields; errors are logged as status/code metadata only.
- [x] AI inference accepts only a persisted image and server-computed quality status. The three advisory states and NOT FOR CLINICAL USE provenance are stored separately from signed reviews and diagnoses.
- [x] Unvalidated demonstration inference output is not presented as an AI observation in patient/doctor care summaries, case-image APIs, inference responses, or inference history; those surfaces expose only demo status and model provenance. Manual image review remains available.
- [x] Screening images use authenticated case-scoped routes, active-consent checks, no-store responses, and encryption at rest for new local uploads. Existing unencrypted image files remain backward-compatible and must be protected by the existing local-volume controls.
- [x] Follow-ups validate case/referral/appointment relationships, enforce status transitions, record status history, and restrict updates to authorized doctors. Referral creation requires active, distinct source and destination hospitals; referral status transitions require the referring or destination-hospital doctor.
- [x] Patient care summaries/reports are relationship-gated; doctor case summaries use case-scoped authorization rather than exposing the patient's unrelated cases. Generated synthetic reports are on-demand, include a non-clinical disclaimer, and are access-audited.
- [x] The structured clinical summary requires a verified doctor, an authorized case-care relationship, and active screening consent; it is no-store and access-audited. It does not call an external generative AI service, and explicitly reports that a validated AI summary is unavailable.
- [x] Patient-level symptom and habit history in a case summary is marked as not specifically linked to that case; existing rule-based indicators are labeled unvalidated, and no diagnosis or treatment recommendation is generated.
- [x] Workflow notification creation uses deduplication keys and never treats best-effort in-app enqueueing as proof of SMS or push delivery.
- [x] Location links are signed, time-limited, consent-gated, one-use and expire; SMS-mode logs do not include the link or patient identifier.
- [x] District endpoints return aggregate metrics only, suppress small village values, and audit exports.
- [x] Phase 08 analytics filters are validated and applied within backend-enforced role, geography, hospital, and doctor-care scopes; CSV/PDF exports are aggregate-only and audited.
- [x] AI operations telemetry stores no patient, case, image, or prompt identifiers; detailed system health is System Admin-only and does not expose connection strings, credentials, or patient data.
- [x] Phase 10 camp APIs enforce active role, geography/hospital scope, matching PHC/village/mandal, verified doctor assignments, screening consent, attendance transitions, aggregate-only exports, small-count suppression, and audit records.
- [x] Phase 10 SOS requests are patient-account-bound and idempotent; staff queues use patient geographic/care relationships; consented location is attached only from an active location share; request assignment requires an active verified doctor in the patient service area; transitions and actions are audited.
- [x] Emergency facility responses are directory-only, mark availability unknown, and explicitly disclaim dispatch or response guarantees. No emergency dispatch provider is integrated.
- [x] Reset operations are system-admin-only, require an explicit confirmation phrase, and delete only records tagged by the synthetic seed UUID prefix.

## Request-validation audit

The route audit found these request inputs that were previously accepted without a strict Zod schema; they are now validated before being used:

| Route input | Validation added |
|---|---|
| `GET /api/v1/admin/audit-logs` query | Strict allowlist, ObjectId actor, ISO date range, and limit from 1 to 500 |
| `GET /api/v1/patients` query and `POST /api/v1/patients?confirm=` | Strict query allowlists and bounded values |
| `GET /api/v1/geo/mandals` query | Strict query allowlist and ObjectId district |
| `GET /api/v1/sync/pull` query | Strict query allowlist and ISO timestamp |
| Mongo-backed route parameters | Shared Zod ObjectId validation for `id` and `*Id` parameters |
| Chunk-upload route parameter | UUID validation for `uploadId` |
| Offline sync patient references | ObjectId validation before database lookup |

Other mutation bodies are parsed with route-specific Zod schemas in their controllers. Read-only endpoints that accept no filters do not accept request bodies. Any newly added route should have an explicit body/query/parameter schema before its controller uses request input.

## Operational checks before deployment

- Replace all example environment values with generated secrets and store them in the deployment secret manager. Never commit `.env`.
- Use a dedicated least-privilege MongoDB application account, private networking, encrypted backups and tested restoration.
- Provide valid TLS certificate files at `TLS_CERT_DIR`; keep nginx and Node dependencies patched.
- Review `npm audit` output and resolve high/critical findings before release.
- Confirm SMTP/SMS provider settings and templates before enabling any live gateway. Demo mode is mock-only.
- Complete an independent penetration test and privacy review before considering any non-synthetic use.

## Known scope limits

- The demo server has one explicit system-admin break-glass role. It does not implement a production support approval workflow.
- Pino redaction is defense in depth; do not pass raw patient documents, request bodies, secrets, or identifiers into log fields.
- Database-backed authorization and workflow tests require a disposable MongoDB test service; CI's current Jest suite covers API guards and pure business rules.
- ASHA workers are provisioned by a System Admin, require MFA, and are limited to their assigned geography. Legacy Employee accounts remain disabled. Existing offline patient records and queued form payloads are not encrypted at rest; do not store real patient information locally.
- Emergency contacts, SMS/push emergency notifications, dispatch provider integration, and verified facility availability are not implemented. SOS is a coordination record only, not an emergency service.
- The deterministic screening model is demonstration-only and has no clinical validation. Do not use this project or its reports for patient care or medical decisions.
