import { expect, it } from "vitest";
import { requisitionCsv } from "./requisition-export";
import type { ProcurementRequisitionRow } from "./use-inventory-control-centre";
const request = {
  requisition_number: "REQ-17",
  status: "SUBMITTED",
  required_at: null,
  requested_by: "Reviewer",
  warehouse_id: "Branch store",
  lines: [
    {
      item_name: "Rice",
      requested_quantity_minor: 2500000,
      unit_symbol: "kg",
      notes: 'No "substitute", please',
    },
  ],
} as unknown as ProcurementRequisitionRow;
it("exports actual requested quantities, units and source identity without mutating records", () => {
  const before = structuredClone(request);
  const csv = requisitionCsv([request]);
  expect(csv).toContain(
    '"REQ-17","SUBMITTED","","Reviewer","Branch store","Rice","2.5","kg","No ""substitute"", please"',
  );
  expect(request).toEqual(before);
});
it.each(["=SUM(A1)", "+cmd", "@formula", "-formula", "\t=payload"])(
  "neutralizes spreadsheet formula text: %s",
  (value) => {
    const csv = requisitionCsv([{ ...request, requested_by: value }]);
    expect(csv).toContain(`"'${value}"`);
  },
);
it("exports a header for an empty scope, not fabricated requests", () => {
  expect(requisitionCsv([]).split("\r\n")).toHaveLength(1);
});
