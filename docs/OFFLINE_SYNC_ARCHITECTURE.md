# Offline POS Synchronization

## Local stores

Production IndexedDB contains only:

- `read-cache`: replaceable tenant transaction-state cache plus server revision;
- `pending-commands`: unsynchronized commands and typed conflicts;
- `device-state`: monotonic client sequence;
- `preferences`: non-sensitive device preferences.

The cache is never submitted as an authoritative snapshot. Production rejects snapshot replacement. The bearer token is not persisted in IndexedDB/localStorage.

Development-only localStorage snapshots remain for explicit local development. Production code paths do not call them. Other localStorage entries are theme, selected branch/view, tenant/user display hints and print-bridge device configuration; server authentication and authorization ignore all of them.

## Command envelope

Each `OfflineCommand` includes ID, claimed tenant/branch/actor, registered device ID, command type, payload, UTC creation time, client sequence, idempotency key, correlation ID and sync status. The server replaces claimed identity with the authenticated actor and verifies branch/device ownership.

Responses are `accepted`, `duplicate`, `conflict` or `rejected`. Server results are retained with the command record. Financial records never use last-write-wins.

## Policy

Allowed offline commands are restricted to configured restaurant operations such as cash-capable order creation/editing and local KOT effects. API-confirmed payment, marketplace commands, reconciliation, settlement posting, permission changes and direct journal posting are unavailable offline.

An offline cash order may print its KOT locally. `localEffects.kotPrinted=true` tells the server not to create a duplicate original KOT after sync. On reconnect, the same command can be sent repeatedly and is applied once.

## Reconnect flow

```text
Offline cash order
  -> optimistic local state
  -> pending command + device sequence + idempotency key
  -> local KOT once
  -> reconnecting indicator
  -> authenticated bulk sync
  -> server transaction/number allocation
  -> duplicate/conflict handling
  -> authoritative state refresh
```

Typed conflicts include stale server state, remote cancellation, branch/device mismatch and prohibited operation. The UI reports Online, Offline, Reconnecting or Sync issues and keeps unresolved commands visible for manager action.
