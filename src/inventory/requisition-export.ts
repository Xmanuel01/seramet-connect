import type { ProcurementRequisitionRow } from "./use-inventory-control-centre";
import { QUANTITY_SCALE } from "./quantity";

/** Export only the branch-authorized rows already loaded by the existing API. */
export function requisitionCsv(rows: readonly ProcurementRequisitionRow[]) {
  const lines: unknown[][] = [
    [
      "Requisition",
      "Status",
      "Required",
      "Requested by",
      "Warehouse",
      "Item",
      "Quantity",
      "Unit",
      "Notes",
    ],
  ];
  for (const row of rows) {
    for (const line of row.lines.length ? row.lines : [undefined]) {
      lines.push([
        row.requisition_number,
        row.status,
        row.required_at ?? "",
        row.requested_by,
        row.warehouse_id,
        line?.item_name ?? "",
        line ? line.requested_quantity_minor / QUANTITY_SCALE : "",
        line?.unit_symbol ?? "",
        line?.notes ?? "",
      ]);
    }
  }
  return lines
    .map((row) =>
      row
        .map((value) => {
          let text = String(value ?? "");
          if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
