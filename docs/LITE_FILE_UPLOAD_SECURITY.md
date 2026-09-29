# Seramet Lite: file upload and import security

This release intentionally removes the antivirus scanner and its separate ClamAV service.
It does **not** claim to detect malware. Only deploy to the intended low-resource
restaurant workload while accepting the documented residual risk.

## Controls retained

- Server-side authentication, tenant and branch permissions, and private R2 access.
- Explicit file allowlists, bounded upload sizes, magic-byte checks for images,
  PDF and XLSX, and disallowance of NUL bytes in CSV uploads.
- Spreadsheet/import policy limits, parsing limits, row validation, preview
  review, idempotent commit, and a fresh production-like validation-policy marker.
- Random tenant-scoped R2 keys, file digests and orphan-object cleanup.
- Public responses retain Content-Security-Policy sandbox and no-sniff headers.
- All backup, migration, tenant-isolation and staging release gates remain.

## Boundaries and rollout

File signatures and parsers are **not** malware detection. Do not assume PDFs or
spreadsheets are safe to open on a staff device just because they pass validation.
Staff should only import files from trusted sources and should avoid distributing
untrusted uploaded files. Reassess antivirus or document sanitization if public
third-party uploads or higher-risk documents are introduced.

Never automatically replay old import previews: require fresh validation and
human approval. Existing stored objects are not rescanned or rewritten.

Deploy to staging first. Confirm there is no legacy `SERAMET_MALWARE_SCANNER`
service binding, run CI and smoke-test uploads, previews, commit and permissions.
Do not bypass backup, public Data API containment, queue reconciliation or
release-SHA approval to accelerate deployment. No database schema migration
is required for the scanner removal.
