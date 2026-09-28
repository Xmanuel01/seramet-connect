# Staging branch recovery: Westlands and Ngong Road

**Not applied to live staging.** The connected Supabase SQL identity is
read-only. Do not create branches by pasting raw INSERTs into PostgreSQL:
OnboardingService creates an entire branch with warehouse/policy/enterprise
records, duplicate/idempotency checks and an audit event.

Verified on 28 September: the tenant's sole branch is bootstrap
MONA_SWAHILI_01, display name Mona Swahili, lifecycle CONFIGURING.
The first onboarding wizard is COMPLETED, but tenant is still SETUP.
This generic branch already owns 2 device records and 3 menu-branch
settings. There are no orders, invoices, payment transactions or
employees linked to it. These facts do **not** prove the devices belong
to Westlands or Ngong Road. Do not blindly rename, delete, or move it.

The previously reported deadlock is fixed on the integration branch:
after the first wizard COMPLETED, an authorized all-branch owner may
create another CONFIGURING branch without requiring tenant-wide LIVE.

## Owner-approved identity mapping before any change

1. In owner-authenticated setup, inspect both existing hardware devices
   and the 3 existing menu settings. Explicitly determine whether the
   current bootstrap ID belongs to **Westlands**, **Ngong Road**, or to a
   generic setup shell. Record an approved mapping and current backup.
2. If bootstrap is a real physical site, use the existing guided setup
   workflow (reopen first-branch configuration only when intended) to
   update its name/code to that site while **preserving the existing branch
   ID** and its device bindings. Re-complete the guided wizard, then create
   the second named physical branch via the owner-only POST
   /api/seramet/setup/branches endpoint, using a new idempotency key,
   the correct brand, timezone, site code and warehouse configuration.
   If bootstrap is only a generic shell, create the two physical branches
   and separately review retirement/deactivation of the generic shell
   after its devices and menu settings are reconciled. Do not invent a
   physical mapping.
3. Verify both actual sites have separate immutable IDs, intended brand
   and warehouse/device assignments and independently CONFIGURING/ACTIVE
   status. Check tenant and branch permissions for cashiers, managers and
   kitchen. Both branches must be created by the product's authorized
   service; a successful raw SQL INSERT alone is NOT correct provisioning.
4. Once an operational ClamAV-backed scanner and Queue/Cron have passed
   private tests and the three old unscanned imports have been
   administratively quarantined after a verified backup and isolated
   restore, create ONE fresh V3 menu preview. Explicitly select the
   intended Westlands/Ngong branch IDs, validate kitchen/bar station
   mappings and only then commit. A tenant-master-only preview is not
   automatically available for POS selling.
5. Verify branch-local menu/catalogue, users, devices, print routing,
   inventory and reporting are isolated; do not open live payments
   or start trading until owner acceptance.

No staging branch mutation, device reassignment or CSV replay happens
just because the code branch builds or this document exists.
