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
    profile.printIdentity.paymentInstructions = ["Diagnostic only - no payment destination"];
    for (const template of Object.values(profile.templateSettings)) template.width = width;
    for (const route of Object.values(profile.documentRoutes)) route.template = width;
    const subtotalMinor = 12345,
      taxMinor = 1600,
      totalMinor = 13945;
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
      lines: [
        {
          id: "fixture-line",
          name: "Long named kitchen meal with distinguishing extra details",
          category: "Test",
          quantity: 1,
          unitPrice: subtotalMinor / 100,
          productionStation: "MAIN KITCHEN",
          modifiers: ["No onion"],
          itemNote: "Separate sauce",
        },
      ],
    };
    for (const type of ["BILL", "RECEIPT"] as const)
      examples.push({
        name: `${type.toLowerCase()}-${width}`,
        width,
        content: SerametPrintService.createDocumentJob(profile, order, type).content,
      });
    examples.push({
      name: `kot-${width}`,
      width,
      content: SerametPrintService.createProductionTicketJobs(profile, order, [], "NEW").jobs[0]
        .content,
    });
  }
  return examples;
}
