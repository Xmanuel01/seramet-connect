# Print document templates

`src/printing/documents/` renders Seramet's 16 printed documents for any paper
width from one set of templates. They are pure functions: data in, ruled text
out. There's no I/O and no time-zone or currency lookups, so they're easy to
test and to call from the POS, the server or the print bridge.

| Kind                  | Function                  | Usual paper |
| --------------------- | ------------------------- | ----------- |
| KOT / BOT             | `renderProductionTicket`  | 58 / 80mm   |
| Customer bill         | `renderCustomerBill`      | 58 / 80mm   |
| Sales receipt         | `renderSalesReceipt`      | 58 / 80mm   |
| Tax invoice           | `renderTaxInvoice`        | A4 or 80mm  |
| Payment receipt       | `renderPaymentReceipt`    | 58 / 80mm   |
| Credit note           | `renderCreditNote`        | A4 or 80mm  |
| Void / cancellation   | `renderVoidTicket`        | 58 / 80mm   |
| Order amendment       | `renderAmendmentTicket`   | 58 / 80mm   |
| Dispatch / delivery   | `renderDispatchTicket`    | 58 / 80mm   |
| Rider cash collection | `renderRiderCashSlip`     | 58 / 80mm   |
| X / Z shift report    | `renderShiftReport`       | 58 / 80mm   |
| Purchase order        | `renderPurchaseOrder`     | A4          |
| Goods received note   | `renderGoodsReceivedNote` | A4          |
| Stock transfer note   | `renderStockTransferNote` | A4          |

## Layout rules

- **Continuous ruled tables, no dotted lines.** Output uses the `+---+` / `|`
  format that `printing-core/thermal-layout.mjs` already parses, so raster
  printers draw solid lines. `printing-core` is unchanged, so installed print
  bridges keep validating jobs.
- **Any width.** `paper` is `58mm` (32 columns), `80mm` (42) or `A4` (78).
  Narrow paper folds columns into the item cell (unit price, packed tick, GRN
  counts) instead of squeezing them.
- **Paper saving.** Stacked tables share one merged border. Empty optional
  fields are dropped. The unit price only prints when the quantity is above
  one. "Amounts in KES" only prints on A4.
- **Bold where it matters.** Titles (`BILL`, `RECEIPT`, `TAX INVOICE`, the
  first line of every ticket), the `TOTAL` row, allergy notes and `REPRINT`
  lines use the patterns printing-core already treats as strong.
- **Reprints.** Pass `ctx.copy` and the document prints
  `REPRINT #n <time> by <user>`.

## Tax and eTIMS

- `TaxSettings` switches VAT on or off, chooses inclusive or exclusive prices
  and adds levies such as the 2% catering levy. A non-VAT restaurant gets no
  VAT lines and an `INVOICE` instead of a `TAX INVOICE`.
- Omit `etims` when a restaurant has eTIMS off; no block prints. `PENDING`
  prints a clear "not yet signed" notice. `SIGNED` prints the CU numbers and
  returns the KRA verification QR.

## QR codes

Every render returns `{ content, qrCodes }`. Bills and unpaid invoices return a
`PAYMENT` QR when `payment.qrPayload` is set (for example a Daraja dynamic QR
carrying till/paybill, account and amount). Signed receipts and invoices return
an `ETIMS_VERIFY` QR. The content always carries the manual details too, so a
printer that can't print QR codes still produces a complete document.

**Not done yet:** the bridge doesn't print `qrCodes` yet, and these templates
aren't wired into `SerametPrintService`. Next steps are:

1. Map `OrderForPrint` and the other records onto these inputs.
2. Add a QR band to the raster renderer, or use `GS ( k` in text mode.
3. Switch the existing BILL, RECEIPT, INVOICE and production renderers over
   one at a time, updating the printing acceptance fixtures as you go.

## Previews

```
npx vite-node scripts/render-print-previews.ts
```

This writes every document at every width to `docs/print-previews/`. Tests are
in `src/printing/documents/documents.test.ts`.
