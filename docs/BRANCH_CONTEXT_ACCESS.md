# Branch Context Access

## Authority model

Seramet separates three concepts:

- `user_branches` defines the branches a user is assigned to.
- `user_primary_branches` defines the single branch selected automatically at sign-in.
- `branches.switch` permits changing the active operating branch among assigned branches.

`scope.branches.all` remains a reporting and organizational scope permission. It does not, by
itself, permit an operator to change branch context. All-branch context requires both
`scope.branches.all` and `branches.switch`.

## Runtime rules

The authenticated server identity supplies the tenant, primary branch, assignments and permission
set. A browser branch header is only a request. The server rejects it when the branch is not
assigned or the user lacks `branches.switch`. Users without switching authority are reset to their
primary branch even if browser storage contains an older branch preference.

Cross-branch mutations require the target to be the active branch, or require `branches.switch`
and an explicit assignment to the target branch. Reporting access does not substitute for this
operational authority.

## Administration

Authorized managers use **Settings > Users and access > User branch assignments** to set the
primary branch and additional assignments. The same screen's role matrix exposes
`branches.switch` under the Dashboard sensitive authority. Assignment updates are transactional,
increment the access revision and append a `USER_BRANCH_ASSIGNMENT_CHANGED` audit event with the
old and new branch sets.

Changes are detected by the existing access refresh. A transferred user is therefore placed into
the new primary branch without relying on their device's local preferences.

## Visual identity

The app shell displays branch name and branch code with a stable branch-specific color marker.
Locked users also see a lock indicator. Authorized switchers see only assigned branches, with the
active branch clearly checked.
