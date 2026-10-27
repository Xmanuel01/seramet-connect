# Controlled Solo-Developer Release Policy

The owner approved this policy on 27 October 2026. It replaces the requirement
for a second person's GitHub review; it does not pretend an AI report is an
independent human approval.

Main retains strict current-commit GitHub Actions checks (`validate`,
`postgres-crm`, `postgres-recovery-fixture`), administrator enforcement,
conversation resolution, and bans on force-push/deletion. It additionally
requires `owner-approved-production-candidate`, an explicit owner approval of
the exact tested commit for production promotion. A new push has no approval
status and cannot reuse an old commit's approval.

Staging approval is a separate scope. It cannot create the production approval
status. Because the existing Cloudflare connection may publish main, approving
staging work is not authorization to merge main. No merge or production
promotion is authorized by merely adopting this policy.

`scripts/solo-release-approval.mjs` verifies an unedited, recent owner comment on
the intended PR, exact head SHA, action, current successful core checks from
GitHub Actions, and completion without failure of the other reported checks.
The owner must explicitly approve the final SHA before an operator records the
comment. No comment or successful production status may be fabricated from a
general request to continue working.

Comment format (replace all placeholder values):

```text
SERAMET_SOLO_RELEASE_APPROVAL_V1
{"commit":"EXACT_40_CHARACTER_SHA","pull_request":156,"scope":"staging","expires_at":"OWNER_APPROVED_UTC_EXPIRY","nonce":"FRESH_UUID_V4"}
```

Verify with `node scripts/solo-release-approval.mjs --pr 156 --comment-id ID
--sha SHA --scope staging`. Only a separate `production-promotion` approval may
use `--publish-production-status`. The two-hour window limits issuing the
approval status; GitHub commit statuses do not expire automatically. Revalidate
the approval before any operator-controlled merge or deployment.

This is an owner-controlled workflow, not two-person separation of duties.
The repository currently has only the owner as a writer, workflow credentials
default to read-only, and CI does not receive permission to publish this status.
Reassess status-publishing permissions before adding collaborators or granting
automation write access. An owner/admin credential remains a high-trust secret.

Staging backup/restore may run on the release candidate only when dispatched by
the owner, rerun by the owner, and matching the protected staging approved-SHA
variable. The existing backup encryption, trust-root, isolated restore and
no-replay controls remain mandatory. No passing CI or approval erases unresolved
financial, queue, recovery or acceptance defects.

For this incident, the existing staging deployment workflow has an explicit
`maintenance_only` option. It requires the exact staging owner-comment approval
and every backup, backlog, Data API and health gate. It updates only the existing
primary Worker. Scanner/container creation, provider-secret writes, origin
credential changes and database migrations do not run in that mode. Existing
secrets and resource identities are retained, and unscanned imports stay denied.
This is not approval to activate delivery providers or a paid scanning service.
