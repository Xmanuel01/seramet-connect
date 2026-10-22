# Guarded Production Updates

The owner authorized merging the reviewed pilot and release stack on October 22, 2026. Both were merged in dependency order. The resulting main revision is
`3ed3623955d3105715a7e19741aa01a11e00cd8e`; its tree exactly matches the reviewed
`86540a0fce7440a901a5eb97109414fc20598212` candidate. Its main CI passes.

## Scope

`Deploy approved production update` automatically follows successful **main push**
CI. It does not run for pull requests, forks, failed/skipped CI or arbitrary manual
events. It executes trusted main source, never an upstream build artifact.

This is an update mechanism for an already bootstrapped production service, not
permission to launch an unconfigured database. It deliberately does not migrate,
provision infrastructure, copy staging secrets, change printer configuration,
activate providers or reconstruct database grants. It does not make an unavailable
production site available by deploying a development runtime instead.

## Required Production Setup

The production GitHub environment must have:

- `SERAMET_PRODUCTION_AUTO_DEPLOY=true` only after initial production acceptance.
- `SERAMET_PRODUCTION_APPROVED_SHA` matching the reviewed main revision exactly.
- The dedicated production project ref, Supabase URL and public origin.
- Dedicated `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
- Existing production Hyperdrive, private R2, work queue, DLQ and scan queue IDs/
  names in the configuration renderer's corresponding environment variables.

The pipeline requires successful main CI and a successful owner-initiated real
production recovery workflow on the same revision. It retrieves that run's actual
verification artifact and validates its project, commit, digest, isolated target
and original capture age (at most two hours). Disposable CI recovery is not a
substitute. A newer failed recovery attempt is not masked by an earlier pass.

The current live production runtime must already pass operational health at the
candidate's required schema version. Existing authenticated Worker settings must
match the production project and configured resource identities before deployment.
Binding changes, schema changes and first deployment require the separate reviewed
bootstrap process. Automatic updates reuse the existing runtime secrets.

The gate rechecks that the main revision has not been superseded immediately before
deployment. All production work shares the existing serialization group. As with
any external deployment API, a main update racing after the final check cannot be
made atomic with that API; the next release must pass its own gates.

If the first automatic run is blocked while awaiting exact-revision recovery or
approval, finish those prerequisites and rerun that main CI run. No guards need to
be disabled. Failed health checks mark the deployment unsuccessful; no automatic
database restore or rollback of financial records is attempted. Use the recorded
previous Cloudflare version and an explicitly reviewed rollback when necessary.

## Current Launch Status

Automatic deployment is **not enabled**. Dedicated production credentials, actual
production recovery, schema migrations, runtime bindings and first-deployment
acceptance are still outstanding. Merged code and passing CI do not mean the
website or installed application has updated. The installed PWA receives the
website's assets through its existing update lifecycle; this workflow does not
force-reload active cashier sessions.
