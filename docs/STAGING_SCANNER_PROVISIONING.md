# Real private malware scanner: required before staging deployment

A script name alone does **not** provide malware scanning. The code in
scanner-worker is a private Cloudflare WorkerEntrypoint RPC adapter, not an AV
engine. It requires a separately hosted, authenticated and monitored ClamAV
gateway at an operator-controlled HTTPS endpoint. The gateway must synchronously
scan submitted bytes with an actual, updated ClamAV engine. It must respond
HTTP 200 with JSON containing status CLEAN or INFECTED, engine "clamav",
a non-empty signatureVersion and an opaque reference. Other replies, timeouts,
invalid credentials and no backend all map to ERROR (deny file acceptance).
No public HTTP route is configured for this Worker.

**You must provision the private ClamAV gateway and approve sending staging
uploads to it** before enabling any import. Never connect an untrusted/public
third-party scanner or fake a CLEAN result; uploads can contain staff/customer
data. Protect the upstream with HTTPS, strong bearer tokens, upload-size limits,
rate limits and access logs free of raw file content or original filenames.

Once the real backend exists, from an authorized Cloudflare account:
- Deploy scanner-worker/wrangler.toml through Wrangler.
- Set the scanner Worker's AV_UPSTREAM_URL and AV_UPSTREAM_TOKEN as secrets.
- Exercise real clean and EICAR infected fixtures through a *private service
  binding*, not a public endpoint. Verify ERROR on upstream 503, timeout,
  invalid JSON and invalid signatureVersion. Record the results and confirm
  up-to-date AV signature refresh.
- Configure the GitHub staging environment variable
  SERAMET_MALWARE_SCANNER_SERVICE=seramet-staging-malware-scanner (actual deployed
  script name) and verify the Seramet binding calls scan RPC correctly.
- Only after backup/duplicate reconciliation, Data API security containment,
  reviewed unrelated-job replay and the approved release SHA can staging deploy.
  The release pipeline checks service *existence* but cannot by itself certify
  malware scanning; independently record private RPC fixture results.
