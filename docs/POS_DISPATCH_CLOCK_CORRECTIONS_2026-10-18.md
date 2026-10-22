# Kitchen dispatch and POS clock corrections

## Confirmed code findings

1. Legacy print profiles required a separate document-identity record while
   enrolled printer profiles already used the registered restaurant and branch
   as a fallback. The same valid business could therefore print through one
   configuration path but fail through the other. Both now reuse the existing
   scoped fallback. No restaurant name, address, phone, tax number or printer is
   invented. Explicit branch/tenant print identities still take precedence.
2. Missing document identity was reported as a missing business profile. The
   repository now identifies the missing print-document setting precisely.
3. Recovering an already-sent order checked this browser's local print queue,
   not authoritative acknowledgements from another terminal. Recovery now
   requires scoped server obligations covering all sent production lines and
   quantities. Every original/addition obligation must be `BRIDGE_ACCEPTED`.
   Missing, partial, pending, claimed or uncertain evidence does not clear the
   order or generate an automatic retry. Reprints cannot substitute for missing
   original dispatch evidence.
4. The missing-profile check ran before checking whether there were any new
   items to send. An acknowledged order could be unnecessarily blocked by a
   later configuration failure. Existing dispatch recovery now runs before that
   check; new or additional production still requires complete routing.
5. The Kenyan UTC-onboarding-default handling recognized only literal `UTC`.
   Valid aliases `Etc/UTC`, `Etc/GMT` and `GMT` bypassed it. These now use Intl's
   canonical timezone identity. Explicit non-UTC zones and non-Kenyan branches
   retain their configured behavior. No stored timestamps are changed.
6. A recovered cart rendered before its selected authoritative order loaded.
   The second browser run reproduced a click in that window and received the
   routing error despite a later-visible sent order. Cashier actions now remain
   disabled while the selected order is unresolved, with a matching action guard.
   The regression deliberately holds the transaction response to verify this
   boundary, rather than relying on machine speed or increasing timeouts.

## Cashier experience

- A recovered, acknowledged order can leave the entry cart without producing
  another KOT. It remains in the authoritative kitchen/invoice workflow.
- Uncertain dispatch stays available for explicit printer recovery and review.
- New dispatch with missing routing retains its draft and fails closed.
- Printing errors link to Printers and document settings in Setup Centre.
- The clock exposes its resolved restaurant timezone in its tooltip.
- `2026-10-18T11:21:00Z` displays as `14:21:00` in Nairobi. This verifies display
  conversion, not the correctness of the live terminal's operating-system clock.

## Validation boundary

The focused regression suite covers POS workflow, platform configuration,
kitchen recovery/outbox, routing and printing APIs: 53/53 tests passed.
Browser acceptance uses disposable loopback data and separate browser storage:
it checks restaurant time, rejection of new dispatch without routing, retained
draft notes, cross-terminal acknowledgement recovery and uncertain outcomes.
Its bridge acknowledgement is a disposable server fixture, not physical output.

Final browser run: 2/2 passed, including the deliberately delayed authoritative
snapshot. Final TypeScript, focused ESLint, production build, formatting and
diff checks passed. The earlier intermittent browser failure is recorded above
as the evidence leading to the recovered-order loading guard, not ignored as a
timeout or counted as a passing run.

No live configuration was inspected or changed. The live branch's exact timezone,
deployed revision, printer routes and physical output remain unverified. A missing
printer route or bridge installation still needs authorized real configuration;
this correction does not bypass either requirement.

Changes are local on `codex/pilot-staff-integration`; no merge, push, deployment,
driver installation or live database mutation was performed.
