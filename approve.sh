#!/usr/bin/env bash
set -euo pipefail
repo=Xmanuel01/seramet-connect
pr=273
sha=52173b122f30f1910e7de8483589b7d6d996b2cf
cd "$(git rev-parse --show-toplevel)"
test "$(gh api user --jq .login)" = Xmanuel01 || { echo "Authenticate as Xmanuel01 first."; exit 1; }
test "$(gh pr view "$pr" -R "$repo" --json headRefOid --jq .headRefOid)" = "$sha" || { echo "PR head changed. Do not proceed."; exit 1; }
gh pr checks "$pr" -R "$repo"
echo "Production approval for PR #$pr, exact commit $sha"
echo "This records owner approval, runs the existing approval verifier, then merges into main."
read -r -p "Type APPROVE to authorize this exact production release: " answer </dev/tty
test "$answer" = APPROVE || { echo "Cancelled."; exit 1; }
expiry=$(date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ)
nonce=$(node -e "console.log(require('crypto').randomUUID())")
body=$(printf 'SERAMET_SOLO_RELEASE_APPROVAL_V1\n{"commit":"%s","pull_request":273,"scope":"production-promotion","expires_at":"%s","nonce":"%s"}' "$sha" "$expiry" "$nonce")
id=$(gh api "repos/$repo/issues/$pr/comments" -f "body=$body" --jq .id)
node scripts/solo-release-approval.mjs --pr "$pr" --comment-id "$id" --sha "$sha" --scope production-promotion --publish-production-status
gh pr merge "$pr" -R "$repo" --merge --match-head-commit "$sha"
echo "Merge succeeded. Check Cloudflare for the production deployment result."
