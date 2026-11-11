# Seramet email infrastructure

Outbound email goes through **Brevo**. Inbound departmental mail is forwarded by
**Cloudflare Email Routing** to Gmail. No other email service is used. This document
is the source of truth for senders, routing, rollout and rollback.

Status labels used below:

- **Implemented and tested**: in this branch, covered by automated tests.
- **Awaiting deployment**: code is ready, not yet deployed or migrated.
- **Awaiting external configuration**: needs a Brevo, Cloudflare, Supabase or Gmail
  dashboard change by the owner.
- **Blocked**: needs access or approval that has not been given.

## 1. Audit (11 November 2026, read-only)

| Email                                                    | Path                                                               | Sender in production                | Evidence                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------- |
| Signup confirmation, password recovery, staff invite     | Supabase Auth → Brevo SMTP `smtp-relay.brevo.com:587`              | `Seramet POS <admin@seramet.co.ke>` | Custom SMTP enabled in production; recovery and invite sent 8 Nov |
| Daily summary PDF (`DAILY_SUMMARY_EMAIL`)                | Worker → Brevo API (`src/server/transactional-email.ts`)           | admin@                              | 3 accepted; 4 dead-lettered 9 Nov with unknown outcome (see §11)  |
| Daily closing report PDF (`DAILY_CLOSING_EMAIL`)         | Same                                                               | admin@                              | Never sent in production                                          |
| Customer invoice/receipt PDF (`CUSTOMER_DOCUMENT_EMAIL`) | Same                                                               | admin@                              | Never sent in production                                          |
| CRM campaigns (marketing)                                | Worker → Brevo API, per-restaurant `SERAMET_CAMPAIGN_EMAIL_CONFIG` | Each restaurant's own sender        | Unchanged by this work; has List-Unsubscribe                      |

- **Resend**: no active path. `SERAMET_CLOSING_EMAIL_API_KEY/FROM` are legacy and unused.
  A job prepared by the old Resend path is never resent through Brevo.
- **Not present before this work**: HTML emails, logo, reply-to, delivery webhooks,
  per-category senders, weekly/monthly report emails, low-stock emails, subscription
  emails, welcome email, an in-app password-reset page, a platform-admin UI.
- **Branding**: official mark `public/brand/seramet-mark-light.png`, publicly served at
  `https://pos.seramet.co.ke/brand/seramet-mark-light.png` (HTTP 200, image/png).
- **Cloudflare Email Routing** (zone seramet.co.ke): enabled, DNS locked, one rule
  `admin@seramet.co.ke → seramet.inc@gmail.com` (verified destination), catch-all
  disabled (drop).
- **DNS** (public resolvers):
  - MX: `route1/2/3.mx.cloudflare.net` (Cloudflare Email Routing)
  - SPF: `v=spf1 include:_spf.mx.cloudflare.net ~all`
  - Brevo domain code: `brevo-code:…` TXT present
  - DKIM: `brevo1._domainkey` and `brevo2._domainkey` CNAMEs to Brevo; `cf2024-1._domainkey` (Cloudflare)
  - DMARC: `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`
  - BIMI: none

## 2. Architecture

```
Application event ──► category (server-side) ──► resolveSender()
                                                   │  verified identity? ─ yes ─► departmental From
                                                   │                      no  ─► current sender (admin@)
                                                   │  reply route live?   ─ yes ─► departmental Reply-To
                                                   ▼
                 worker_jobs (intent persisted) ──► Brevo /v3/smtp/email ──► email_delivery_log
                                                                               ▲
                              Brevo webhook (bearer token) ── delivered/bounced/blocked ┘

Inbound: someone@ ──► Cloudflare Email Routing rule ──► verified Gmail inbox (labels per department)
```

Code:

| File                                     | Purpose                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `src/server/email/senders.ts`            | The 14 identities, the category→sender map, `resolveSender`, header-safety checks |
| `src/server/email/layout.ts`             | Table-based HTML layout + plain-text twin, HTTPS-only links, logo URL             |
| `src/server/email/templates.ts`          | The 15 templates, plus the restaurant-document and Supabase Auth templates        |
| `src/server/email/delivery-log.ts`       | Delivery log writes, Brevo event mapping, 400-day retention                       |
| `src/server/email/email-api.ts`          | Brevo webhook; platform-admin read APIs                                           |
| `src/server/transactional-email.ts`      | The single Brevo dispatch path (extended, not duplicated)                         |
| `migrations/0035_email_delivery_log.sql` | Delivery log table (RLS on in Postgres) and `platform.email.view` permission      |

## 3. Departmental senders and categories

| Identity      | Address                     | Display name           | Categories                                                   |
| ------------- | --------------------------- | ---------------------- | ------------------------------------------------------------ |
| ADMIN         | admin@seramet.co.ke         | Seramet Administration | Current fallback sender for everything                       |
| SUPPORT       | support@seramet.co.ke       | Seramet Support        | Support acknowledgement; default reply-to                    |
| BILLING       | billing@seramet.co.ke       | Seramet Billing        | Subscription invoice, renewal reminder, payment confirmation |
| SALES         | sales@seramet.co.ke         | Seramet Sales          | Inbound only for now                                         |
| SECURITY      | security@seramet.co.ke      | Seramet Security       | Security alerts                                              |
| OPERATIONS    | operations@seramet.co.ke    | Seramet Operations     | Reply-to for operational alerts                              |
| PARTNERS      | partners@seramet.co.ke      | Seramet Partnerships   | Inbound only                                                 |
| LEGAL         | legal@seramet.co.ke         | Seramet Legal          | Inbound only                                                 |
| PRIVACY       | privacy@seramet.co.ke       | Seramet Privacy        | Inbound only (data-protection requests)                      |
| NOTIFICATIONS | notifications@seramet.co.ke | Seramet Notifications  | Low-stock, operational alerts, restaurant documents          |
| REPORTS       | reports@seramet.co.ke       | Seramet Reports        | Daily summary, closing report, weekly/monthly performance    |
| AUTH          | auth@seramet.co.ke          | Seramet Authentication | Password reset, email verification                           |
| ONBOARDING    | onboarding@seramet.co.ke    | Seramet Onboarding     | Welcome, onboarding confirmation, staff invite               |
| UPDATES       | updates@seramet.co.ke       | Seramet Updates        | Maintenance (transactional), product updates (marketing)     |

Rules enforced in code (**implemented and tested**):

- The sender comes only from the category. No request field, client or restaurant setting
  can choose it.
- An identity sends only once it is listed in `SERAMET_EMAIL_ACTIVE_SENDERS`. Until then
  the current working sender (`from` in `SERAMET_TRANSACTIONAL_EMAIL_CONFIG`, today admin@)
  sends. You can never send from an unverified identity.
- A departmental reply-to is set only once that address forwards and is listed in
  `SERAMET_EMAIL_REPLY_ROUTES`. Before that, replies go to the From address (admin@,
  which already forwards), so no reply is lost.
- **Restaurant documents** (invoices and receipts to a restaurant's customers) show as
  "_Business name_ via Seramet" from notifications@, reply to the branch email when it has
  one, and say the restaurant issued them. They never look like a Seramet subscription invoice.
- A retry keeps the sender chosen when the email was first prepared. Jobs prepared before
  this change finish exactly as prepared (plain text, configured sender).
- Display names and subjects are stripped of line breaks, quotes and angle brackets
  (header-injection protection). Links must be absolute HTTPS.

## 4. Configuration (no secret values here)

| Name                                 | Kind              | Value                                                                              |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------------------------- |
| `SERAMET_TRANSACTIONAL_EMAIL_CONFIG` | Secret (existing) | **Unchanged.** Its `from` stays `Seramet POS <admin@seramet.co.ke>` as fallback    |
| `SERAMET_EMAIL_ACTIVE_SENDERS`       | Plain variable    | Start empty. Add identities one at a time after Brevo verification, e.g. `REPORTS` |
| `SERAMET_EMAIL_REPLY_ROUTES`         | Plain variable    | Identities whose Cloudflare forwarding works, e.g. `SUPPORT,BILLING`               |
| `SERAMET_BREVO_WEBHOOK_TOKEN`        | Secret (new)      | Random string of at least 32 characters, also entered in Brevo's webhook           |
| `SERAMET_PLATFORM_ADMINS`            | Plain variable    | `tenantId:userId` entries allowed to read platform-wide email records              |

Set secrets with `wrangler secret put <NAME>` (never in `wrangler.jsonc`, git or chat).

## 5. Cloudflare Email Routing (awaiting your approval)

Nothing has been changed in Cloudflare. MX and DNS stay as they are. The existing admin@ rule
is kept.

**Add the departmental rules** (Cloudflare dashboard → seramet.co.ke → Email → Email Routing →
Routing rules → Create address). For each of support, billing, sales, security, operations,
partners, legal, privacy, notifications, reports, auth, onboarding and updates:

1. Custom address: e.g. `support`.
2. Action: **Send to an email** → `seramet.inc@gmail.com` (already verified).
3. Save, and check the rule shows **Active**.

**Adding a separate Gmail inbox later**: Email Routing → Destination addresses → Add
destination → enter the Gmail address → the owner of that inbox clicks Cloudflare's
verification email → edit the department's rule to send there. No code changes.

**Then** add the routed identities to `SERAMET_EMAIL_REPLY_ROUTES`. Test each address by
sending to it from an outside account and confirming it arrives in Gmail.

**Gmail labels** (in seramet.inc@gmail.com): Settings → Filters → Create filter,
`To: support@seramet.co.ke` → Apply label "Seramet/Support" (repeat per department). Gmail
matches the original To address, which Cloudflare preserves.

**Limits and facts**:

- Cloudflare Email Routing forwards; it is **not a mailbox**. There is no storage, no IMAP,
  and no sending from Cloudflare. Replies from Gmail come from the Gmail address unless you
  add a "Send mail as" alias that sends through Brevo SMTP.
- Destinations must be verified. Forwarding uses SRS, so SPF still passes at Gmail.
- Loops cannot occur: destinations are Gmail addresses, never `@seramet.co.ke`.
- Messages over Cloudflare's size limit (25 MiB) are rejected.
- Keep the catch-all disabled so unused addresses bounce instead of collecting spam.

## 6. Brevo sender verification (awaiting external configuration)

The domain seramet.co.ke is already authenticated in Brevo (code TXT + DKIM `brevo1/brevo2`).

1. Brevo → Senders, Domains & Dedicated IPs → **Senders** → Add a sender.
2. From name and email exactly as in §3 (e.g. `Seramet Reports`, `reports@seramet.co.ke`).
3. Because the domain is authenticated, Brevo normally verifies the sender immediately. If it
   asks for a code, the code arrives through Cloudflare forwarding, so add the routing rule
   (§5) first.
4. When a sender shows **Verified**, add its identity to `SERAMET_EMAIL_ACTIVE_SENDERS` and
   redeploy, one identity at a time (§9).

**Brevo free plan**: 300 emails a day across all senders. Over the limit Brevo answers
402/429; the worker treats both as "not sent, retry later" with backoff (up to 8 attempts).
Daily summaries plus closing reports are about 2 emails per recipient per branch a day.
Upgrade before that exceeds ~250 a day.

**Delivery webhook**: Brevo → Transactional → Settings → Webhooks → Add a webhook:

- URL: `https://pos.seramet.co.ke/api/seramet/email/brevo-webhook`
- Events: Delivered, Soft bounce, Hard bounce, Invalid email, Deferred, Blocked, Complaint, Error
- Authentication: Bearer token = the value of `SERAMET_BREVO_WEBHOOK_TOKEN`

## 7. DNS and authentication

| Check | Current             | Action                                                                                                                                                           |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPF   | Cloudflare only     | None needed: Brevo's envelope uses Brevo's domain and DMARC passes on aligned DKIM. Optional: `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all` |
| DKIM  | brevo1/brevo2 valid | None                                                                                                                                                             |
| DMARC | `p=none`            | **Do not change yet.** Read Brevo's DMARC reports for 2–4 weeks; when only Brevo and Cloudflare send, move to `p=quarantine; pct=25`, then 100, then `p=reject`  |
| MX    | Cloudflare          | None                                                                                                                                                             |

Validate:

```bash
nslookup -type=TXT _dmarc.seramet.co.ke 1.1.1.1
```

```bash
nslookup -type=CNAME brevo1._domainkey.seramet.co.ke 1.1.1.1
```

Then send a test email to a Gmail account, open it, and use **Show original**. SPF, DKIM and
DMARC should all show PASS, with DKIM `d=seramet.co.ke`.

### Sender avatar (BIMI): future plan, no purchase made

- Brevo cannot set the Gmail sender avatar. Gmail shows a brand logo only through BIMI.
- Gmail requires a DMARC policy of `quarantine` or `reject` at 100%, an SVG Tiny PS logo, and a
  **paid** Verified Mark Certificate (trademarked logo) or Common Mark Certificate (logo in
  public use for at least a year). Yahoo and some clients show BIMI without a certificate.
- Plan: (1) tighten DMARC as above; (2) produce an SVG Tiny PS version of the official mark;
  (3) publish `default._bimi TXT "v=BIMI1; l=https://pos.seramet.co.ke/brand/seramet-bimi.svg"`;
  (4) decide on a VMC/CMC only when the budget allows.

## 8. Templates

All templates render responsive, table-based HTML with the official logo over HTTPS, plus a
plain-text version (**implemented and tested**): daily summary, closing report, weekly report,
monthly report, subscription invoice, payment confirmation, renewal reminder, password reset,
email verification, security alert, welcome, onboarding confirmation, support acknowledgement,
maintenance notice, product update (marketing, with unsubscribe), and restaurant document.

Wired to live events in this change: **daily summary, closing report, restaurant
invoice/receipt**. The others are ready but have no trigger yet. Weekly/monthly reports,
low-stock emails, subscription billing and welcome flows need their own triggers and are
follow-up work.

**Supabase Auth emails** (awaiting external configuration). Branded versions are in
`docs/email-templates/` (`supabase-confirmSignup.html`, `supabase-resetPassword.html`,
`supabase-invite.html`, `supabase-magicLink.html`, plus subjects). To apply: Supabase →
seramet-production → Authentication → Emails → Templates → paste each subject and HTML. To
move auth email to auth@: verify auth@ in Brevo first, then change **SMTP Settings → Sender
email** to `auth@seramet.co.ke` and the sender name to `Seramet Authentication`. Leave the
host, port and password unchanged. Test signup and recovery right after.

## 9. Rollout

1. **Migrate first.** The schema version moves 34 → 35 and production refuses to start
   against an older schema. From a trusted environment run `npm run migrate:postgres`, then deploy.
2. Deploy with `SERAMET_EMAIL_ACTIVE_SENDERS` empty. Emails keep coming from admin@ but are
   now HTML with a logo and logged. Confirm the next daily summary arrives with its PDF.
3. Set `SERAMET_BREVO_WEBHOOK_TOKEN`, add the Brevo webhook, and check log rows reach DELIVERED.
4. Approve and add the Cloudflare rules (§5), then set `SERAMET_EMAIL_REPLY_ROUTES`.
5. Verify `reports@` in Brevo → `SERAMET_EMAIL_ACTIVE_SENDERS=REPORTS` → watch one day of reports.
6. Then add `NOTIFICATIONS` (restaurant documents), and the others as their emails go live.

Never switch several identities at once without a successful test of each.

## 10. Rollback

- **Sender problem**: remove the identity from `SERAMET_EMAIL_ACTIVE_SENDERS`. New emails
  return to admin@ immediately. Queued retries keep their prepared sender, which was verified
  when prepared.
- **Reply-to problem**: remove the identity from `SERAMET_EMAIL_REPLY_ROUTES`.
- **Code problem**: production refuses to start unless the database schema version matches
  the build exactly, so after migration 35 the previous Worker build will **not** start.
  Instead, revert this change's code but keep `migrations/0035_email_delivery_log.sql`, its
  entry in the migration list and `CURRENT_SCHEMA_VERSION = 35`, then deploy that build.
  The extra table and permission are harmless to the reverted code. Do not delete the
  migration row from the database.
- **Supabase Auth**: revert the sender email to admin@ and the templates to the previous text.

## 11. Manual actions for the owner

1. **Reconcile the 4 daily summaries dead-lettered on 9 Nov** (unknown outcome): check Brevo →
   Transactional → Logs for 9 Nov around 09:00 UTC from admin@. Do not resend them blindly.
2. Approve the Cloudflare routing rules (§5).
3. Verify the departmental senders in Brevo (§6) and add the delivery webhook.
4. Set `SERAMET_BREVO_WEBHOOK_TOKEN` and `SERAMET_PLATFORM_ADMINS`.
5. Optionally apply the branded Supabase Auth templates (§8).
6. Add the Gmail filters (§5).

## 12. Security and compliance

- The Brevo API key stays in the existing Worker secret and is never sent to the browser.
  Webhooks are checked against a bearer token in constant time, with a 256 KB body cap and
  rate limiting.
- `email_delivery_log` stores category, sender, recipient address, subject, Brevo message id
  and status. It stores no bodies, attachments, links, passwords or one-time codes. Rows are
  pruned after 400 days. It has RLS enabled with no policies, so Supabase's Data API cannot
  read it.
- Platform-wide email records need **both** an entry in `SERAMET_PLATFORM_ADMINS` and the
  `platform.email.view` permission. The permission is excluded from restaurant owner roles and
  from the role created when a restaurant is provisioned. Note: that provisioning step already
  grants `platform.tenants.provision` to new restaurant administrators. This is pre-existing
  and worth a separate review.
- Transactional and marketing mail are classified separately (`transactional` flag). Product
  updates require consent and always carry an unsubscribe link. CRM campaigns keep their
  existing List-Unsubscribe. This supports Kenya Data Protection Act 2019 requirements on
  direct marketing.
- Recipients are validated, and subjects and display names are header-safe. Report recipients
  are still rechecked against branch permissions before every attempt (unchanged).
