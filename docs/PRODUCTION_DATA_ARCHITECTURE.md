# Production Data Architecture

## Sources of truth

| Data | Production authority | Browser use |
| --- | --- | --- |
| Orders, invoices, receipts | Server database | Replaceable read cache and pending offline command |
| Payments, allocations, refunds | Server database | Display cache only; no offline digital confirmation |
| Journals, settlements, reconciliation | Server database | Display cache only |
| Inventory and receiving | Server database append-only movements | Draft count/command cache only |
| Cash drawer and EOD | Server database | Pending permitted cash command only |
| Provider events and outbox | Server database plus durable queue | None |
| Audit | Append-only server table | Read-only display |
| Configuration | Server normalized tables | In-memory copy; local persistence disabled in authoritative mode |
| UI theme, branch-view preference, print bridge endpoint | Device localStorage | Authoritative only for that device preference |

## Repository boundary

`TransactionRepository` remains the domain contract. `D1AuthoritativeTransactionRepository` is selected only in a server-only factory. Client bundles can use shared transition logic for optimistic/offline presentation but cannot import or construct the D1 implementation.

Each authoritative mutation:

1. authenticates and authorizes the actor;
2. verifies tenant/branch ownership;
3. checks idempotency and current revision;
4. calculates server business date;
5. enforces closed-day policy;
6. applies the existing domain transition;
7. persists changed records, read-model revision, audit record and mutation result in one database batch.

The read model accelerates reconstruction. It is derived and cannot bypass record constraints.

## Database model

Migration `0001` creates tenant, identity, operations, payment, accounting, inventory, procurement, people, printing, audit and authoritative-record tables. `0002` adds provider runtime, outbox, workers, offline commands, rate limits, secret versions, feature/entitlement, retention, backup and migration metadata. `0003` adds indexes and immutability/capacity locks. `0004` adds runtime records and authoritative triggers. `0005` applies uniqueness to the current record-level repository. `0006` adds invoice allocation, refund-correlation and posting-transition guards.

All tenant data uses tenant-qualified primary/foreign keys where a parent is tenant owned. Branch rows include tenant and branch. Server repository methods require tenant scope and never derive it solely from request payload.

## Atomicity and concurrency

- D1 `batch` commits record diffs, revision and mutation metadata atomically.
- The unique base revision allows one writer from a state revision; losers receive `CONFLICT`, reload and retry.
- Idempotency keys replay the original response only when the request hash matches.
- Provider references, event IDs, outbox keys, document sequences and normalized resource mappings are unique in the database.
- Refund and payment-allocation triggers prevent capacity overrun under concurrent requests.
- Status predicates and immutable-state triggers prevent double close/post.

## Time, money and querying

Timestamps are UTC. Business date is calculated server-side from branch timezone and cutoff. Money remains integer minor units in normalized storage and the Pass 4 money abstraction. Cross-currency allocation is rejected. High-volume operational tables are indexed by tenant, branch, status, business date and provider reference. `/api/seramet/query/:collection` uses a bounded (maximum 200) branch-scoped cursor, and `/api/seramet/query/aggregates/operations` computes status counts server-side rather than loading history into React.
