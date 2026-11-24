# Production deployment

`.github/workflows/deploy-production.yml` releases an owner-approved, merged candidate to
the production Worker `seramet-connect` (`https://pos.seramet.co.ke`). It is dispatched by
the owner from `main` only and never runs on a push.

## Before the first run

- **Stop Cloudflare's Git integration from deploying `main`.** Workers Builds on
  `seramet-connect` currently builds every push. If it deploys `main`, a merge would put new
  code live before this workflow migrates the database. In the Cloudflare dashboard, open
  `seramet-connect` → Settings → Builds and disconnect the repository, or remove its
  production deploy command, so this workflow is the only production deployer.
- Provision the pinned production resources (Hyperdrive `4538af733065451c94d47beb2028390e`,
  R2 `seramet-production-objects`, queues `seramet-production-live-work`,
  `seramet-production-live-dlq`, `seramet-production-file-scan`). The workflow only checks
  that they exist; it never creates or pays for anything.
- In the GitHub `production` environment, add the secrets `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` and `SERAMET_POSTGRES_URL` (migration role on project
  `qnhqylslyhxjcksuhgyq`), and the variables `SERAMET_SUPABASE_PUBLISHABLE_KEY` and
  `SERAMET_DATA_API_EXPOSURE_CLEARED=true` once the Data API review is done.

## Each release

1. On the release PR, post an unedited owner comment with `"scope":"production-promotion"`
   for the exact head SHA (see [the solo release policy](SOLO_RELEASE_POLICY.md)), then
   publish the approval status:
   `node scripts/solo-release-approval.mjs --pr PR --comment-id ID --sha HEAD_SHA --scope production-promotion --publish-production-status`
2. Merge: `gh pr merge PR --merge --match-head-commit HEAD_SHA`.
3. Set the production variable `SERAMET_PRODUCTION_APPROVED_SHA` to the resulting `main`
   merge commit.
4. Run **Production encrypted recovery verification** on `main`. It takes an encrypted
   backup and proves it restores. The deploy needs a successful run for this commit from
   the last 24 hours.
5. Run **Deploy production** on `main` with `release_pr=PR`.

The deploy refuses to continue unless the PR was merged as this exact commit with the
approved source tree, the owner's production status is present, the recovery drill
passed, the database is the production project and locked down, and every migration
applies in one transaction. After deploying it checks that the live build, environment
and schema version match.
