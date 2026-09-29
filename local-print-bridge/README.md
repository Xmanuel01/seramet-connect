# Seramet Local Print Bridge

This is the POS-machine bridge for printing outside the browser print dialog.

## Setup

1. Copy `config.example.json` to `config.local.json`.
2. Replace `token` with a random secret of at least 16 characters.
3. Set the printer as the OS default printer, or pass `printerName` in the print job.
4. Start the bridge:

```powershell
npm run bridge
```

## Endpoints

- `GET /health` is public and returns bridge status.
- `GET /printers` requires `Authorization: Bearer <token>` and discovers OS printers.
- `POST /jobs` requires the same token and accepts a trusted Seramet print job.

The bridge binds to `127.0.0.1` by default, validates every job, writes a spool file, appends `bridge-events.jsonl`, and then sends the file to the operating-system print spooler.

Set `SERAMET_BRIDGE_DRY_RUN=true` during testing to spool and log jobs without sending them to a physical printer.
