# Seramet Lite file scanning

Spreadsheet imports use an isolated, asynchronous scanner boundary. The POS
frontend and primary API Worker do not contain or run an antivirus engine.
Imports remain unavailable unless every required binding and the shared scanner
authentication secret are configured.

## Isolated architecture

`authenticated upload -> private R2 quarantine -> scan queue -> dedicated scanner Worker -> on-demand ClamAV container -> authenticated verdict -> existing import worker`

- The database import job is the source of truth. A queue message contains only
  the tenant, job and correlation identifiers and grants no authority by itself.
- The scanner claims the job from the primary Worker using an HMAC-authenticated
  internal request. The claim returns the authorized immutable R2 object identity.
- The scanner reads the private object directly, verifies size, object version,
  metadata and SHA-256, then streams it to ClamAV.
- A verdict is accepted only when its job, object key/version, SHA-256, scanner
  identity, engine/signature versions and timestamp match the claimed file.
- Only authenticated `CLEAN` evidence makes the parser job runnable. Missing,
  malformed, expired, replayed, infected or error evidence remains fail-closed.

The initial raw upload limit is 10 MiB. The scan queue uses one-message batches,
one concurrent consumer, three bounded retries and a dead-letter queue. The
ClamAV container uses the account-supported `durable_object` scheduling policy.
Only the fixed private `scanner` Durable Object identity may start an instance;
other identities and non-scan routes are rejected without starting capacity.
It selects the digest-pinned named image and `standard-1` size at startup, checks
engine readiness, and shuts down after two idle minutes using a persistent alarm.
An alarm persistence failure destroys the container rather than leaking capacity.
Normal POS requests do not invoke or wait for the scanner.

The unused legacy `ClamAvContainer` namespace is retained for rollback. The new
`DurableClamAvScanner` class has a separate namespace and application; no existing
Durable Object state or file data is transferred or deleted. The account rejected
the previous `default` scheduling policy before creating any Container instance.

## Protected secrets

`SERAMET_SCANNER_EVIDENCE_SECRET` is a random value of at least 32 bytes stored
only as a protected staging environment secret and as a secret on both Workers.
It must not be committed, logged, returned to the browser or regenerated during
an ordinary deployment. Rotate it as a coordinated scanner/primary-Worker
maintenance operation while imports are disabled.

Production uses a distinct production evidence key, scanner Worker, queues and
private production bucket; it never binds staging resources. See
[the guarded production release runbook](SCANNER_PRODUCTION_RELEASE.md) for
resource identities, exact-commit approvals and certification prerequisites.
Production support in the configuration generator is not deployed acceptance.

## Certification

Before enabling staging imports:

1. Apply the reviewed schema and deploy the scanner Worker/container before the
   primary Worker receives its scan-queue producer binding.
2. Upload a valid menu CSV containing the standard EICAR test string. Confirm
   ClamAV returns `INFECTED`, the R2 object remains quarantined, no preview rows
   exist and the parser worker never runs.
3. Upload a harmless valid menu CSV. Confirm authenticated `CLEAN` evidence is
   stored for the exact R2 object version and SHA-256, then complete stage,
   approval, batched commit, verification and explicit publication.
4. Exercise unavailable engine, timeout, tampered SHA, wrong object version,
   expired evidence, replayed evidence and duplicate queue delivery. All unsafe
   paths must remain quarantined and must not parse or publish.
5. Record queue retry/dead-letter recovery and the ClamAV engine/signature
   versions used for the test.

Do not use EICAR against production, a real tenant or a third-party service.

## Performance and cost evidence

Run `npm run benchmark:scanner` before release. It measures the primary Worker
route-guard overhead for ordinary requests. Record Cloudflare queue operations,
container active time and scan duration during staging certification. The cost
controls above minimize idle use but are not a substitute for measured billing.

## Rollback

1. Remove the primary Worker's `SERAMET_SCAN_QUEUE` binding or scanner evidence
   secret and redeploy the previously approved primary Worker. This immediately
   disables new spreadsheet uploads without affecting POS transactions.
2. Leave quarantined R2 objects and database job/audit history intact. Do not
   mark them clean, replay them through the parser or delete evidence.
3. Stop the scanner queue consumer or redeploy the previously approved scanner
   Worker. Inspect the queue and DLQ before any later recovery.
4. After correction, rotate the HMAC secret in a coordinated maintenance window,
   deploy both Workers and repeat EICAR plus clean-file certification.

Rollback never consists of bypassing scanning or accepting client-provided scan
status.
