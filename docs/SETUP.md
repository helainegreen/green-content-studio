# Setup boundaries

Start with `npm ci --ignore-scripts`, `npm run check` and `npm test`. These commands
exercise the evaluation snapshot without a database or live provider credentials.

Application startup is separate from the tests:

1. Provision a new, disposable PostgreSQL database for this snapshot only.
2. Copy `.env.example` to a local ignored `.env`; provide a database connection,
   a new admin identity/password and a cryptographically random session secret.
3. Keep external integrations disabled. Ensure local storage directories are writable.
4. Use `node --env-file=.env server.js` behind an isolated HTTPS endpoint for
   interactive login; session cookies are marked Secure.

Startup creates schema tables and fictional seed clients. It is not read-only.
Do not point it to an existing application database. The server does not load
`.env` automatically unless Node's `--env-file` option or an environment loader is used.

Some legacy modules expect separate databases, explicit role names and configured
file paths. Do not enable those modules merely to silence configuration errors.
The `integration/` suites require explicitly isolated PostgreSQL infrastructure and
are not part of the default test command.

Source for AI, social connections and publishing is included for review. Activating
them requires new provider credentials, an independently configured Meta app and
review of permissions, costs and destination accounts. Those operations are outside
this snapshot's validation scope.

Client-specific legacy rendering scripts, original fonts and real media were not
exported. Generic templates have synthetic samples and font fallback; reproducing
the production visual identity requires separately licensed assets. Browser smoke
tests also require their own isolated running application and fixtures.

