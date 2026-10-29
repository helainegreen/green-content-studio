# Security and disclosure

This evaluation repository must not receive production data or credentials.

## Export controls

- New Git history, built from selected application source and schema files.
- No `.env`, compose files, SSH keys, token vaults, databases, dumps, uploads or logs.
- Client identity, Drive folder IDs, social account IDs and production origins replaced.
- Shared image-reference links removed; visual examples are synthetic.
- External integrations disabled in the example configuration.
- No deployment workflow, webhook, production remote or automatic synchronization.
- Ignore rules prevent common runtime and secret files from being added accidentally.

The existing source includes controls for encrypted credentials, CSRF, origin
validation, tenant access, media validation and approval concurrency. These controls
have specific tests; their presence is not a claim that every route has been audited.

## Future updates

Review the staged file list and diff before each push. Scan newly introduced text
and binaries. Do not import the original working directory or its Git history.
Use fresh credentials in an isolated environment. Never copy the production
configuration to make this evaluation snapshot run.

If a real secret is accidentally committed, remove it from the published history
and revoke/rotate the credential; deleting it in a later commit is insufficient.
Discuss findings privately with the repository owner, without pasting sensitive
values into public issues or reports.

