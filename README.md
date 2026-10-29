# Green Content Studio

An AI-assisted content operations platform: plan topics, prepare copy and visual
assets, review drafts, schedule approved publications, and inspect social metrics.

**This is a sanitized source snapshot for technical evaluation, dated October 29,
2026.** It is derived from a working application, with fictional client profiles
and newly created sample assets. It contains no production database or deployment
credentials. This repository starts a new history; it does not reproduce the
application's development history.

## What the code covers

- Client workspaces and editorial configuration.
- Topic planning, structured AI output, evidence-aware copy review and human approval.
- Single posts, carousels, layout templates, image jobs and document imports.
- Background processing, leases, retries, uncertain outcomes and duplicate prevention.
- Facebook/Instagram connection, scheduling, publishing and statistics adapters.
- Version-bound approvals, CSRF checks, origin checks, encrypted token storage,
  controlled media access and file validation.

Implementation: **Node.js / CommonJS, PostgreSQL, server-rendered HTML/CSS/JavaScript**.
Optional integrations include OpenAI, Meta, Google Drive and n8n. Rendering uses
Chromium where configured. No framework migration or replacement application was
introduced for this snapshot.

## Review and test

Use Node.js 22 or newer and npm. No API key, social account or database is required
for the default tests.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run simulate
```

The test runner uses mock providers, temporary files and loopback HTTP servers.
It explicitly selects 18 test files and does not start application workers or run
the PostgreSQL/browser smoke suites. The simulation produces fictional planning
output and an inactive n8n workflow; it sends nothing externally.

The default test suite passed locally for this snapshot. See
[validation details](docs/VALIDATION.md) and [architecture](docs/ARCHITECTURE.md).

## Evaluation snapshot boundaries

Client names, folder identifiers, social account identifiers, production origins
and private reference links have been replaced. Example clients are Demo Wellness,
Demo Health and Community News. Some modules retain the `FR2_` environment-variable
prefix as a legacy technical identifier; it is not an access credential.

Original client images, fonts, render scripts, generated posts, attachments,
production infrastructure, workflow exports, logs, backups and credentials are
excluded. Synthetic preview data and fallback fonts are provided. Rendering and
legacy client-specific paths therefore require additional assets/configuration
before deployment. This is **not a turnkey replica of production**.

`npm start` requires an isolated PostgreSQL database and fresh environment values;
startup creates application tables and fictional client records. Read
[setup boundaries](docs/SETUP.md) before attempting it. The default tests are the
recommended entry point for reviewers. End-to-end production deployment, live AI
generation and Meta publication were not exercised during this export.

## Security and access

Read [SECURITY.md](SECURITY.md). The snapshot was checked with `detect-secrets` and
manual review of identifiers, URLs and configuration. This is a source-disclosure
check, not a comprehensive penetration test or a guarantee of vulnerability absence.

The repository is intended to remain private until its owner decides how to share
it with evaluators. A private URL alone does not grant access. No open-source
license is granted by this snapshot; see [NOTICE](NOTICE).

