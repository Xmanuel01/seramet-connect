# Production Device Agent Deployment

The local print bridge is a device agent, not an application database. Install it on a branch-managed
Windows host that can reach configured printers.

1. Register the device in Seramet and assign the correct tenant, branch and device type.
2. Approve it through the device-trust workflow; do not reuse a development device identity.
3. Create `local-print-bridge/config.local.json` from the example with the production HTTPS origin,
   server-issued enrollment material and configured printer routes.
4. Install with `local-print-bridge/install-windows.ps1` under a restricted service account.
5. Test KOT, addition, cancellation, bill, receipt, invoice, reprint audit and recovery after network
   interruption.
6. Verify heartbeat and failed-job visibility, then revoke the test credential.

The agent must reject unapproved origins and devices. Printer failures remain queued/audited and do
not rewrite the order or payment. Device revocation must prevent new jobs without deleting history.
