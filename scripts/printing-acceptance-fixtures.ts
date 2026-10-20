import { SerametPrintService, type OrderForPrint } from "../src/lib/seramet-print-service";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "../src/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "../src/platform/repositories/configuration-repository";

export function printingAcceptanceFixtures() {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  const examples = [];
  for (const width of ["58mm", "80mm"] as const) {
    const profile = SerametPrintService.getBranchHardwareProfile(
      DEMO_WESTLANDS_BRANCH_ID,
      DEMO_TENANT_ID,
    );
    profile.kitchenMode = "PRINTER_ONLY";
    profile.printIdentity.businessName = "Disposable Test Restaurant";
    profile.printIdentity.receiptBrand = "Disposable Test Restaurant";
    profile.printIdentity.branchName = "Disposable branch";
    profile.printIdentity.address = "Test-only address";
    profile.printIdentity.phone = "0000000000";
    profile.printIdentity.email = "contact@example.invalid";
    profile.printIdentity.footerMessage = "Please visit again.";
    profile.printIdentity.paymentInstructions = ["Diagnostic only - no payment destination"];
    for (const template of Object.values(profile.templateSettings)) template.width = width;
    for (const route of Object.values(profile.documentRoutes)) route.template = width;
    profile.printIdentity.pin = "TEST-PIN-ONLY";
    const subtotalMinor = 24690,
      taxMinor = 3200,
      totalMinor = 28390;
    const order: OrderForPrint = {
      orderId: "#ACCEPTANCE",
      branch: profile.branch,
      terminalId: "TEST-ONLY",
      requestedBy: "Disposable operator",
      cashier: "Disposable operator",
      waiter: "Disposable operator",
      createdAt: "2026-10-15T10:00:00.000Z",
      orderType: "Takeaway",
      kitchenNote: "No salt. Allergy test only.",
      receiptNumber: "RCP-TEST-ONLY",
      invoiceNumber: "INV-TEST-ONLY",
      paymentMethod: "Cash",
      subtotal: subtotalMinor / 100,
      tax: taxMinor / 100,
      total: totalMinor / 100,
      paid: totalMinor / 100,
      serviceCharge: 10,
      discount: 5,
      lines: [
        {
          id: "fixture-line",
          name: "Long named kitchen meal with distinguishing extra details",
          category: "Test",
          quantity: 2,
          unitPrice: 123.45,
          productionStation: "MAIN KITCHEN",
          modifiers: ["No onion"],
          itemNote: "Separate sauce",
        },
      ],
    };
    for (const type of ["BILL", "RECEIPT", "INVOICE"] as const) {
      const content = SerametPrintService.createDocumentJob(profile, order, type).content;
      examples.push({
        name: `${type.toLowerCase()}-${width}`,
        width,
        documentType: type,
        content,
      });
      examples.push({
        name: `${type.toLowerCase()}-copy-${width}`,
        width,
        documentType: type,
        content: SerametPrintService.formatDuplicateCopy(
          content,
          width,
          "Disposable reprint operator",
        ),
      });
    }
    for (const [name, station] of [
      ["kot", "MAIN KITCHEN"],
      ["bar", "BAR"],
    ] as const) {
      const production = {
        ...order,
        lines: order.lines.map((line) => ({ ...line, productionStation: station })),
      };
      for (const kind of ["NEW", "REPRINT"] as const) {
        const job = SerametPrintService.createProductionTicketJobs(
          profile,
          {
            ...production,
            requestedBy:
              kind === "REPRINT" ? "Disposable reprint operator" : production.requestedBy,
          },
          [],
          kind,
        ).jobs[0];
        examples.push({
          name: `${name}${kind === "REPRINT" ? "-copy" : ""}-${width}`,
          width,
          documentType: job.documentType,
          content: job.content,
        });
      }
    }
  }
  return examples;
}
