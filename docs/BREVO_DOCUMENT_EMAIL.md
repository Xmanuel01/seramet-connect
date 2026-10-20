# Brevo document and closing-report email

## Implemented boundary

Invoice, receipt and POS-checkout email actions collect a recipient name and email,
then queue a server-generated PDF. They no longer open a mail application. The server
loads the document from its authoritative tenant/branch state; clients cannot submit
PDF bytes, document totals, sender identities or provider credentials.

Customer PDF bytes are frozen in a bounded, private `worker_jobs` obligation with a
SHA-256 fingerprint. One attachment is limited to 1 MB. The existing scheduler and
Queue consumer dispatch the obligation; a queue dispatch failure does not lose it.
The customer endpoint uses a 4 KB streamed request limit and a per-operator limit of
10 new requests per five minutes. Duplicate submissions reuse the same job; changed
recipient/document details under the same key are rejected. Audit creation and the
job insert share a database transaction.

Daily closing retains its existing atomic notification enqueue and re-renders the
report exclusively from the immutable closing snapshot. It does not recalculate live
sales. Authorized management recipients are rechecked before every attempt. A
reopened or superseded closing revision cannot send a pending stale report.

Both types use the same Brevo transactional delivery boundary and existing worker
lease/backoff infrastructure. The worker persists an in-flight marker before calling
Brevo and accepts only a verified `messageId` response. Recipient/sender identity and
PDF fingerprints must remain unchanged across retries.

## Outcome Handling

| Outcome                                                                  | Behavior                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Job committed                                                            | QUEUED; not called sent                                                        |
| Brevo returns valid acceptance                                           | PROVIDER_ACCEPTED; not confirmed inbox delivery                                |
| Confirmed HTTP 429                                                       | Existing bounded retry/backoff, maximum eight attempts                         |
| Configuration missing                                                    | No fabricated success; closing stays closed and notification remains retryable |
| Timeout, ambiguous 5xx, malformed success, interrupted in-flight attempt | Reconciliation required; no automatic resend                                   |
| Permanent provider rejection or revoked operator/recipient permission    | Terminal failure, visible for investigation                                    |
| Previously prepared Resend request                                       | Reconciliation required; never silently switched to Brevo                      |

The browser stores only a scoped request key and job identifier in session storage,
not recipient names, email addresses, PDF contents or credentials. Reopening the
dialog resumes status checks instead of automatically queueing another email. After
provider acceptance, sending another copy requires an explicit new operator action.
The dialog polls status only, with a bounded schedule; it never reloads the POS or
invalidates transaction forms.

## Protected Configuration

Use a Brevo API key and a Brevo-verified sender. Supabase Auth's working Brevo SMTP
configuration remains unchanged; it does not provide the Worker with an API key.

An authorized administrator must set this protected **Worker secret**, independently
for the approved environment:

```text
SERAMET_TRANSACTIONAL_EMAIL_CONFIG
```

Its JSON shape is:

```json
{
  "authorized-tenant-id": {
    "apiKey": "<protected Brevo API key>",
    "from": "Restaurant <verified-sender@example.com>"
  }
}
```

Do not put this value in a frontend variable, source control, chat, CI output, or a
customer-facing configuration field. Existing Resend credentials are not reused.
Configure closing-report recipients in branch closing settings; recipients need an
active user account, assigned branch, valid email and reconciliation-view permission.
Customer email submission requires the corresponding invoice-view or receipt-view
permission. The worker rechecks the requesting operator's current access before send.

Customer attachments and recipient evidence remain in the existing private database
job records; there is no public PDF URL, new bucket or new paid service. No new purge
schedule is introduced: these records must be included in the administrator's approved
financial/privacy retention policy. Unknown outcomes must retain evidence until
reconciled; deleting a job or inventing a replacement key is not a safe recovery method.

## Verification Evidence

- 154 tests passed across eight affected files; one additional focused scheduler/
  queue-outage recovery test passed. Its eight filtered tests had already passed in
  the full affected-file run, not been excluded from acceptance.
- Provider fixtures check the genuine Brevo request shape, actual PDF bytes, recipient
  name/address, atomic duplicate suppression, tamper rejection, permission revocation,
  permanent failures, ambiguous outcomes and bounded retries.
- PDF captures for invoice, receipt and complex multi-page closing reports are retained
  locally under `.seramet/brevo-email-evidence/` and `.seramet/daily-closing/`.
- Browser coverage distinguishes real local POS/printing/closing behavior from the
  intercepted email-status fixture. UI acceptance does not prove real Brevo delivery.
- Two distinct browser scenarios passed: supervisor closing/PDF download and operational
  POS/printing with recipient entry, a recoverable email-request failure, duplicate-click
  protection, stable request identity and provider-acceptance presentation. The first
  combined attempt hit `ECONNRESET` on a local transaction read before the email checks;
  the operational scenario passed alone without changing assertions or timeouts. The
  underlying cause of that one connection reset was not established.
- Official request contract: [Brevo transactional email API](https://developers.brevo.com/reference/send-transac-email).

## Live Acceptance Still Required

No live API credential was provisioned or read, no real financial email sent, and no
deployment or live database mutation performed. Deployment, a Queue/Cron consumer
smoke test and an explicitly authorized send to a disposable recipient are required
before claiming protected-staging email operation. Check receipt and invoice PDF
attachments plus a closing report, then inspect Brevo's acceptance/delivery records
and the actual recipient inbox. Inbox delivery webhooks are not implemented here;
provider acceptance must never be labelled confirmed inbox delivery.

The separately confirmed missing invoice-to-GL sales posting remains an accounting
release blocker. Emailing a closing report does not correct or certify that posting.
