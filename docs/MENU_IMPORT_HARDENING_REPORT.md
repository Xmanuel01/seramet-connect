# Menu Import Hardening Report

## Root Causes

1. Two frontend helpers generated incompatible menu templates.
2. Station validation queried the database for every row and had no branch-aware mapping workflow.
3. Browser preview identity omitted content digest and import configuration.
4. Duplicate policy could change without invalidating the preview.
5. All-branches context could create tenant items without explaining branch activation.
6. Commit responses did not independently verify catalogue records.
7. The setup loader coupled menu data to unrelated provider/device/diagnostic requests.
8. Operational readers treated a missing branch setting as available and one reader queried a non-existent station table.
9. Login network/configuration failures collapsed to the opaque `Seramet API failure` message.

## Corrected Workflow

Before:

`competing template -> weak preview -> repeated station errors -> commit/queue -> generic success -> coupled refresh -> possibly empty POS`

After:

`template v2 -> explicit target -> digest/config fingerprint -> branch reference preload/mapping -> exact row actions -> explicit commit/queue -> authoritative verification -> independent catalogue refresh -> explicit branch POS/KDS visibility`

## Migration

Migration `0018_authoritative_menu_import.sql` adds preview/version/target/verification metadata, row actions and before/after evidence, branch station/routing payloads, reusable reference aliases, indexes, and branch-station scope triggers. Existing committed imports retain `PENDING` verification rather than being reinterpreted as failed.

## Verification Coverage

Automated coverage includes:

- canonical and legacy template behavior;
- deterministic preview fingerprints;
- preview-time duplicate decisions;
- tenant-master versus branch activation;
- cross-branch rejection;
- station mapping and stored aliases;
- multiple row-branch assignments for one tenant item;
- stale and expired preview rejection;
- branch price and station persistence;
- explicit unavailability exclusion;
- verified synchronous commit and idempotent retry;
- durable queued commit without false committed state;
- a 343-row repeated-station regression through the operational catalogue;
- a 600-row durable-worker load fixture;
- an actual `.xlsx` workbook through parsing, preview, commit, and branch catalogue verification;
- optional previous-POS sales preview, skip, one-time commit, append-only storage, no live-flow replay, and historical aggregate quality labeling;
- controlled Supabase login outage errors.

Exact final command results are recorded in the task completion response after the full suite, lint, builds, migration compatibility and browser QA run.
