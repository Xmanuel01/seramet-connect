# Pass 9 Security Review

## Scope

Reviewed the provider registry, managed gateway boundary, privacy minimization, query planner, evidence tools, grounding validator, sessions, cache, usage limits, briefs, worker integration, suggested actions, API, migration, and Ask Seramet UI. The threat model is in `docs/PASS_9_THREAT_MODEL.md`.

## Findings

### P0

None identified in the implemented Pass 9 boundary.

### P1

None identified after remediation and tests.

### Closed during implementation

| Risk                                                     | Resolution                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Provider could receive tenant identity                   | `tenantId` removed from provider evidence request                                                |
| Secret or credential key reaches provider                | recursive secret-key filtering plus managed server secret resolution                             |
| Untrusted menu/order/supplier text alters instructions   | untrusted-instruction and secret-exfiltration redaction before provider transfer                 |
| Model introduces money, percentages, entities, or causes | runtime schema and deterministic grounding rejection                                             |
| Model removes unexplained variance                       | validator requires an `UNEXPLAINED` finding when evidence contains one                           |
| Staff character judgment                                 | prohibited language and evidence-only staff facts                                                |
| AI bypasses source permissions                           | each allowlisted tool requires AI and source-domain permissions                                  |
| Session/cache survives permission change                 | permission fingerprint required for session and cache reuse                                      |
| Cross-tenant or branch response leakage                  | tenant-bound SQL, authorized branch resolution, scoped cache, and concurrent isolation tests     |
| AI executes high-risk mutation                           | no high-risk command exists; grounding rejects one if returned                                   |
| Low-risk action executes silently                        | explicit proposal, hashed expiring token, note, domain permission check, branch check, and audit |
| Provider outage affects ERP                              | fail-closed 503 at intelligence API only; operational facts are unchanged                        |
| Test provider reaches production                         | registry and configuration both block `DETERMINISTIC_TEST` in production-like environments       |
| Malformed provider output persists as answer             | strict schema failure before assistant message/evidence persistence                              |
| Numeric evidence labels caused false rejection           | grounded number allowlist includes numeric tokens already present in authoritative evidence text |

## Controls verified by tests

- shared-database concurrent tenant isolation;
- unauthorized branch and all-branch comparison rejection;
- finance and staff permission isolation;
- prompt injection through menu, order-note, and supplier fields;
- phone, email, payment-reference, identity, and secret minimization;
- malformed response, timeout, rate-limit, missing-provider, and outage behavior;
- concurrent per-user quotas;
- append-only usage, evidence, and prompt history;
- retention expiry;
- cache permission and evidence scope;
- explicit action confirmation and audit;
- worker idempotency, retry, and dead letter;
- production test-provider rejection; and
- sanitized plain-text rendering.

## Residual deployment risks

1. The managed gateway is an environment boundary, not a bundled live vendor implementation. Its production implementation requires separate review for TLS, provider authentication, request logging, data retention, and region selection.
2. Provider contracts, data residency, DPA, and staff privacy approval remain organizational go-live requirements.
3. Operational teams must maintain source read-model quality. Grounding prevents fabrication but cannot repair missing recipes, stale metrics, or incomplete timestamps.
4. Deterministic intent classification trades breadth for security. Unsupported requests fail closed.

## Conclusion

No open P0 or P1 issue was found in the Pass 9 implementation. This conclusion applies to the repository boundary and deterministic test gateway. A production provider gateway must pass the go-live checklist and an environment-specific security review before pilot activation.
