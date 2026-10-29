# Snapshot validation — October 29, 2026

## Passed locally

- 18 selected test files: 130 Node test cases plus nine assertion scripts.
- 134 JavaScript source/test/script files: no syntax errors.
- Functional checks include draft validation, approval fingerprints, queue behavior,
  duplicate prevention, simulated provider failures, media safety, CSRF/origin checks,
  token vault behavior, statistics, document parsing and editorial state recovery.
- `detect-secrets` 1.5.0: no unreviewed findings in the final source scan.
- Dependency archives were retrieved from the npm registry at the lockfile versions,
  their integrity hashes verified, and no dependency install scripts executed.

Tests ran with Node.js 24.22.1. Provider requests were mocked. HTTP integration tests
bound only to loopback. No production database, provider credentials or real
publication operations were used.

## Changes made for the export

- Removed five hardcoded Drive folder IDs and replaced social account identifiers.
- Anonymized client names, module identifiers and production origins.
- Removed a real shared photo-reference URL and replaced story-derived fixtures.
- Replaced original preview data and brand manual with synthetic examples.
- Made incident test paths portable and updated the DOCX test fixture to contain
  the content-types entry required by the existing document validator.
- Resolved test modules relative to the application source in the VM harness.
- Added a font fallback for excluded original font files.
- Added documentation, environment placeholders, ignore rules and test commands.

Six `detect-secrets` keyword findings were reviewed as type/length checks on
variables, not credential values. They are annotated on their exact source lines.
A dummy database password was removed from a mocked test connection. No production
credential was supplied to the scanner or retained in the repository.

## Not validated by this export

- PostgreSQL integration suites requiring dedicated containers and database roles.
- Browser smoke suites requiring a configured application and rendering assets.
- Live Meta OAuth, permission approval, publication or metric collection.
- Live OpenAI generation, billing, or Google Drive/n8n delivery.
- Full application deployment, load testing, penetration testing or dependency
  vulnerability assessment.

Passing checks describe the sanitized evaluation snapshot, not a new audit or
deployment of the production service.
