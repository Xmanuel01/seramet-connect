// The four approved documents built from the same sample data as the approved
// reference image, through the real print service. Used by the visual
// regression tests and by scripts/render-approved-previews.ts.
import {
  SerametPrintService,
  type OrderForPrint,
  type PrintJob,
} from "../src/lib/seramet-print-service";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "../src/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "../src/platform/repositories/configuration-repository";

export type ReferencePaper = "58mm" | "80mm";
export type ReferenceSample = { name: "kot" | "bot" | "invoice" | "receipt"; job: PrintJob };

type Line = OrderForPrint["lines"][number];
const line = (
  id: string,
  name: string,
  quantity: number,
  unitPrice: number,
  productionStation: Line["productionStation"],
  extra: Partial<Line> = {},
): Line => ({ id, name, category: "Menu", quantity, unitPrice, productionStation, ...extra });

/**
 * Integration results the server attaches before printing: the M-Pesa QR
 * Safaricom issued for the bill, and KRA's eTIMS signature for the receipt.
 */
export type ReferenceIntegrations = {
  mpesaQrModules?: string[];
  etims?: OrderForPrint["etims"];
};

export function approvedReferenceSamples(
  paper: ReferencePaper,
  integrations: ReferenceIntegrations = {},
): ReferenceSample[] {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  const profile = SerametPrintService.getBranchHardwareProfile(
    DEMO_WESTLANDS_BRANCH_ID,
    DEMO_TENANT_ID,
  );
  profile.kitchenMode = "PRINTER_ONLY";
  Object.assign(profile.printIdentity, {
    businessName: "Mona Swahili Restaurant",
    receiptBrand: "Mona Swahili Restaurant",
    address: "Kipro Centre, Westlands, Sports Road, Nairobi",
    phone: "+254 719 427 919",
    tillNumber: "4235484",
    timeZone: "Africa/Nairobi",
    currency: "KES",
    paymentInstructions: [],
  });
  for (const template of Object.values(profile.templateSettings)) template.width = paper;
  for (const route of Object.values(profile.documentRoutes)) route.template = paper;
  const staff = {
    branch: "Westlands",
    terminalId: "WEST-POS-01",
    requestedBy: "Emmanuel O.",
    cashier: "Emmanuel O.",
    waiter: "Emmanuel O.",
  };
  const kitchenLines = [
    line("a", "Mbuzi Stew + Rice", 2, 1150, "MAIN KITCHEN", { itemNote: "Extra soup on the side" }),
    line("b", "Ugali", 3, 150, "MAIN KITCHEN"),
  ];
  const kot: OrderForPrint = {
    ...staff,
    orderId: "ORD-06551",
    orderType: "Uber Eats",
    customer: "Uber Eats",
    createdAt: "2026-11-22T07:24:00.000Z",
    kitchenNote: "Pack items separately",
    lines: kitchenLines,
    subtotal: 2750,
    tax: 0,
    total: 2750,
  };
  const bot: OrderForPrint = {
    ...staff,
    orderId: "ORD-06523",
    orderType: "Takeaway",
    customer: "Walk-in Customer",
    createdAt: "2026-11-21T12:00:00.000Z",
    kitchenNote: "Chilled",
    lines: [line("c", "Still Water 500ml", 1, 150, "BAR")],
    subtotal: 150,
    tax: 0,
    total: 150,
  };
  const invoice: OrderForPrint = {
    ...staff,
    orderId: "ORD-06551",
    orderType: "Uber Eats",
    customer: "Uber Eats",
    createdAt: "2026-11-22T07:25:00.000Z",
    invoiceNumber: "INV-0633U",
    lines: kitchenLines,
    subtotal: 2750,
    deliveryCharge: 100,
    tax: 0,
    // The reference restaurant is zero-rated: a 0% VAT rule is configured.
    taxRatesBps: [0],
    total: 2850,
    ...(integrations.mpesaQrModules ? { mpesaQrModules: integrations.mpesaQrModules } : {}),
  };
  const receipt: OrderForPrint = {
    ...staff,
    orderId: "ORD-06600",
    orderType: "Takeaway",
    customer: "Walk-in Customer",
    createdAt: "2026-11-22T08:36:00.000Z",
    receiptNumber: "RCP-0386S",
    invoiceNumber: "INV-0634U",
    lines: [
      line("d", "Chicken Samosa", 2, 100, "MAIN KITCHEN"),
      line("e", "Eggs", 1, 250, "MAIN KITCHEN"),
      line("f", "Still Water 500ml", 1, 150, "BAR"),
      line("g", "Kenyan Tea / African Tea", 1, 250, "BAR"),
      line("h", "Toast Plain", 1, 150, "MAIN KITCHEN"),
    ],
    subtotal: 1000,
    tax: 0,
    taxRatesBps: [0],
    total: 1000,
    paid: 1000,
    paymentBreakdown: [{ method: "M-Pesa", amount: 1000, reference: "TKM3QX81ZP" }],
    ...(integrations.etims ? { etims: integrations.etims } : {}),
  };
  const production = (order: OrderForPrint, type: PrintJob["documentType"]) =>
    SerametPrintService.createProductionTicketJobs(profile, order, [], "NEW").jobs.find(
      (job) => job.documentType === type,
    )!;
  return [
    { name: "kot", job: production(kot, "FOOD_KOT") },
    { name: "bot", job: production(bot, "BAR_TICKET") },
    { name: "invoice", job: SerametPrintService.createDocumentJob(profile, invoice, "BILL") },
    { name: "receipt", job: SerametPrintService.createDocumentJob(profile, receipt, "RECEIPT") },
  ];
}
