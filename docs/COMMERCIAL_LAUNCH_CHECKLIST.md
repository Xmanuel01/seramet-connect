# Commercial Launch Checklist

- [ ] **Domain:** production DNS configured and owned.
- [ ] **SSL:** HTTPS enforced; HTTP redirected; callback URLs verified.
- [ ] **Database:** production PostgreSQL/Hyperdrive bound; migrations applied; version 16 verified.
- [ ] **Backup:** automated retention configured; isolated restore rehearsal passed.
- [ ] **Identity:** Supabase production Auth, email delivery, verification and revocation tested.
- [ ] **Registration:** new external owner creates a clean restaurant and first branch.
- [ ] **Multi-tenancy:** two-tenant, branch and enterprise-scope tests pass in staging.
- [ ] **RBAC:** navigation, route, API, branch switching and sensitive actions validated.
- [ ] **Workers:** Queue producer/consumer, Cron, retries, claiming and dead letters verified.
- [ ] **Storage:** R2 public/private access, scanner, size/type bounds and recovery verified.
- [ ] **Payments:** each enabled provider certified; webhooks, refunds and settlement reconciled.
- [ ] **Notifications:** enabled transactional provider and consent behavior verified.
- [ ] **Delivery:** enabled provider credentials/scopes and availability synchronization certified.
- [ ] **AI:** production provider/limits configured only when enabled; no autonomous mutation.
- [ ] **Printing:** physical KOT/bill/receipt/invoice and failure recovery accepted.
- [ ] **KDS:** physical device trust, routing, realtime update and outage recovery accepted.
- [ ] **Security:** no open P0/P1; WAF, rate limits, CSP, CORS and secret scan verified.
- [ ] **Monitoring:** alerts, dashboards, retention and escalation contacts configured.
- [ ] **Recovery:** application rollback and database/R2 recovery exercised.
- [ ] **Support:** incident owner, escalation path, support bundle and provider contacts approved.
- [ ] **Privacy:** customer/staff retention, access and breach procedures approved.
- [ ] **Pilot:** restaurant owner, branch manager, cashier, kitchen and finance sign-off recorded.

Do not check an item from code inspection alone when it requires deployed or physical evidence.
