#!/usr/bin/env bash
# One-time owner-operated production approval for Seramet PR 273.
set -euo pipefail
cd "$(dirname "$0")"
repo=Xmanuel01/seramet-connect
pr=273
sha=52173b122f30f1910e7de8483589b7d6d996b2cf
[[ "$(gh api user --jq .login)" == Xmanuel01 ]] || { echo 'Authenticate as Xmanuel01 first.'; exit 1; }
[[ "$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid)" == "$sha" ]] || { echo 'Release candidate changed. Stop and review the new commit.'; exit 1; }
echo "PR #$pr: Fix online price updates for legacy menu categories"
echo "Exact production candidate: $sha"
echo 'This will record your production approval, verify the required checks, and merge the PR if authorized.'
read -r -p 'Type yes to approve this exact commit for production: ' confirm
[[ "$confirm" == yes ]] || { echo 'Cancelled.'; exit 1; }
expiry=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)
nonce=$(node -e "console.log(require('node:crypto').randomUUID())")
body=$(printf 'SERAMET_SOLO_RELEASE_APPROVAL_V1\n{"commit":"%s","pull_request":273,"scope":"production-promotion","expires_at":"%s","nonce":"%s"}' "$sha" "$expiry" "$nonce")
id=$(gh api "repos/$repo/issues/$pr/comments" -f "body=$body" --jq '.id')
node scripts/solo-release-approval.mjs --pr "$pr" --comment-id "$id" --sha "$sha" --scope production-promotion --publish-production-status
gh pr merge "$pr" --repo "$repo" --merge --match-head-commit "$sha"
echo 'Merge command succeeded. Verify the production deployment in Cloudflare.'
