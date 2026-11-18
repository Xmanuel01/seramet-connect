/**
 * Plain-language names for printer settings and print statuses, so the
 * Printers page reads in restaurant terms rather than internal codes.
 */
import type {
  KitchenOperatingMode,
  PrintDocumentType,
  PrinterRole,
} from "@/lib/seramet-print-service";
import type { KitchenPrintObligation } from "@/lib/transaction-engine";

export const printerRoleLabels: Record<PrinterRole, string> = {
  BILL: "Bills",
  RECEIPT: "Receipts",
  INVOICE: "Invoices",
  KITCHEN: "Kitchen tickets",
  BAR: "Bar tickets",
  DISPATCH: "Delivery tickets",
  REPORT: "Reports",
  FRONT: "Front counter (backup)",
  KDS: "Kitchen screen",
};

export const printerRoleHints: Partial<Record<PrinterRole, string>> = {
  FRONT: "Prints anything that has no other printer.",
};

export const documentTypeLabels: Record<PrintDocumentType, string> = {
  BILL: "Bill",
  RECEIPT: "Receipt",
  INVOICE: "Invoice",
  FOOD_KOT: "Kitchen ticket",
  BAR_TICKET: "Bar ticket",
  DISPATCH_TICKET: "Delivery ticket",
  KDS_TICKET: "Kitchen screen ticket",
  REPORT: "Report",
};

export const kitchenModeLabels: Record<KitchenOperatingMode, string> = {
  PRINTER_ONLY: "Kitchen printers",
  KDS_ONLY: "Kitchen screens",
  KDS_AND_PRINTER: "Kitchen screens and printers",
  NO_DEDICATED_KITCHEN_SYSTEM: "The front printer (no kitchen printer)",
};

export function connectionLabel(transport: string) {
  if (transport === "TCP") return "Network";
  if (transport === "WINDOWS") return "USB or Windows";
  return transport;
}

export const kitchenTicketKindLabels: Record<KitchenPrintObligation["kind"], string> = {
  ORIGINAL: "New order",
  ADDITION: "Added items",
  REPRINT: "Reprint",
};

export const kitchenTicketStatusLabels: Record<KitchenPrintObligation["status"], string> = {
  PENDING: "Not printed yet",
  CLAIMED: "Was printing when it stopped",
  BRIDGE_ACCEPTED: "Sent to the printer",
  UNCERTAIN: "May not have printed",
  BYPASSED: "Not printed (printer bypass was on)",
};

/** Job stages reported by the Seramet Print Bridge queue. */
const bridgeStageLabels: Record<string, string> = {
  CREATED: "Waiting",
  ASSIGNED: "Waiting",
  QUEUED: "Waiting to print",
  TRANSMITTING: "Printing",
  BYTES_SUBMITTED: "Sent to printer",
  SPOOL_ACCEPTED: "Sent to printer",
  CANCELLED: "Cancelled",
  NOT_SENT: "Didn't reach the printer",
  UNCERTAIN: "May not have printed",
};

export function bridgeStageLabel(stage: string) {
  return bridgeStageLabels[stage] ?? stage.replaceAll("_", " ").toLowerCase();
}
