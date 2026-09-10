# Seramet Local Print Bridge

This is the POS-machine bridge for printing outside the browser print dialog.

## Setup

1. Copy `config.example.json` to `config.local.json`.
2. Replace `token` with a random secret of at least 16 characters.
3. Add the Seramet web-app origin to `allowedOrigins` if it is not already listed.
4. Printer routing uses `printerName` when provided. On Windows the bridge sends the text job to that exact printer using PowerShell `Out-Printer`; otherwise it uses the OS default printer.
5. Start the bridge:

```powershell
npm run bridge
```

## Endpoints

- `GET /health` is public and returns bridge status.
- `GET /printers` requires `Authorization: Bearer <token>` and discovers OS printers.
- `POST /jobs` requires the same token and accepts a trusted Seramet print job.

The bridge binds to `127.0.0.1` by default, validates every job, writes a spool file, appends `bridge-events.jsonl`, and then sends the file to the operating-system print spooler.

Set `SERAMET_BRIDGE_DRY_RUN=true` during testing to spool and log jobs without sending them to a physical printer.

## Physical printer mode

In **Hardware Setup > Printers**, enable the installed bridge and save the same endpoint/token configured on this machine. When enabled, Seramet sends queued bill, receipt, invoice, KOT, bar and dispatch jobs to this bridge. If the mapped printer fails and a branch fallback is configured, Seramet attempts the fallback printer and records `Fallback Printed`.

The bridge token is a local machine secret. Keep it out of source control and do not use the example value in production.

## Windows quick setup

From PowerShell in the project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\local-print-bridge\install-windows.ps1
```

The installer generates a random 64-character local token and writes `config.local.json`. Add `-InstallStartup` if the POS computer should start the bridge automatically when the Windows user signs in:

```powershell
powershell -ExecutionPolicy Bypass -File .\local-print-bridge\install-windows.ps1 -InstallStartup
```

Copy the generated endpoint and token into **Hardware Setup > Printers** in Seramet. Do not commit `config.local.json`.
