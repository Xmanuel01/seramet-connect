import { describe, expect, it } from "vitest";
import { getVisibleNavGroups, roleCanAccessPath } from "@/components/app/nav";
import { products } from "@/data/mock";
import {
  createInvoicePdfBytes,
  invoiceEmailLink,
  invoiceWhatsAppLink,
  type InvoiceDeliveryRecord,
} from "@/lib/document-delivery";
import { mapImageNamesToMenu } from "@/lib/menu-image-mapping";
import { DarajaMpesaProvider } from "@/lib/payment-providers";
import {
  confirmMenuImport,
  exportMenuErrorReport,
  exportMenuImportTemplate,
  exportMenuToCsv,
  parseMenuFile,
  parseMenuText,
} from "@/lib/menu-import-export";
import {
  applyPosMigrationOverrides,
  createPosMigrationPlan,
  migrationCoverage,
  posMigrationProfiles,
  posMigrationTargetFields,
  previewPosMigrationCsv,
  type PosMigrationEntity,
} from "@/lib/pos-migration";
import { convertRgbaToMonochrome } from "@/lib/receipt-logo";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import {
  SerametHttpError,
  authenticateSerametRequest,
  authorizeSerametMutation,
  type SerametEnv,
} from "@/lib/seramet-auth";
import {
  SerametPrintService,
  branchHardwareProfiles,
  type BranchHardwareProfile,
  type KitchenOperatingMode,
  type OrderForPrint,
} from "@/lib/seramet-print-service";
import {
  TransactionEngine,
  createInitialTransactionState,
  type OrderDraft,
  type TransactionState,
} from "@/lib/transaction-engine";

const csv = `name,category,price,prep,productionStation,popular,out,westlandsPrice,ngongRoadPrice,westlandsAvailable,ngongRoadAvailable
Chicken Shawarma,Main Meals,850,14,MAIN KITCHEN,yes,no,900,850,yes,yes
Tamarind Juice,Drinks,260,3,BAR,yes,no,280,260,yes,yes`;

const invalidCsv = `name,category,price,prep,productionStation
,Main Meals,850,14,MAIN KITCHEN
Fish Curry,Swahili,-1,22,UNKNOWN`;

const order: OrderForPrint = {
  orderId: "#T-100",
  branch: "Westlands",
  terminalId: "WEST-POS-01",
  table: "08",
  orderType: "Dine-In",
  requestedBy: "Amina W.",
  cashier: "Amina W.",
  waiter: "Joan A.",
  createdAt: "12:46",
  kitchenNote: "No chilli on one biryani. Serve all meals together.",
  lines: [
    {
      id: "p1",
      name: "Chicken Biryani",
      category: "Main Meals",
      quantity: 1,
      unitPrice: 1250,
      productionStation: "MAIN KITCHEN",
      itemNote: "Extra gravy",
    },
    {
      id: "p8",
      name: "Passion Juice",
      category: "Drinks",
      quantity: 2,
      unitPrice: 300,
      productionStation: "BAR",
      modifiers: ["No ice"],
      itemNote: "One glass room temperature",
    },
  ],
  subtotal: 1850,
  tax: 296,
  total: 2146,
};

describe("menu import and export", () => {
  it("validates pasted CSV, confirms rows, and exports branch-aware menu data", () => {
    const preview = parseMenuText(csv, "menu.csv");
    expect(preview.canConfirm).toBe(true);
    expect(preview.validRows).toBe(2);
    expect(preview.categories).toEqual(["Drinks", "Main Meals"]);

    const confirmed = confirmMenuImport(products, preview);
    expect(confirmed.imported).toBe(2);
    expect(confirmed.products.some((product) => product.name === "Tamarind Juice")).toBe(true);

    const exported = exportMenuToCsv(confirmed.products, "Westlands");
    expect(exported).toContain("Tamarind Juice,Drinks,280");
    expect(exported).toContain("westlandsAvailable");
  });

  it("blocks confirmation when required fields and station values are invalid", () => {
    const preview = parseMenuText(invalidCsv, "bad-menu.csv");
    expect(preview.canConfirm).toBe(false);
    expect(preview.issues.filter((issue) => issue.severity === "error")).toHaveLength(3);

    const confirmed = confirmMenuImport(products, preview);
    expect(confirmed.imported).toBe(0);
    expect(confirmed.products).toBe(products);
  });

  it("exports a downloadable template and a downloadable validation error report", () => {
    const preview = parseMenuText(invalidCsv, "bad-menu.csv");
    const template = exportMenuImportTemplate();
    const report = exportMenuErrorReport(preview);

    expect(template).toContain("itemCode,name,category");
    expect(template).toContain("imageFilename");
    expect(template).toContain("MS-001.jpg");
    expect(report).toContain("sourceName,row,field,severity,message");
    expect(report).toContain("bad-menu.csv");
    expect(report).toContain("productionStation");
  });

  it("maps bulk menu images by item code, SKU, image filename and item name", () => {
    const mappedProducts = [
      { ...products[0]!, itemCode: "MS-001", sku: "FOOD-001", imageFilename: "chicken-main.jpg" },
      { ...products[7]!, itemCode: "DR-008", sku: "DRINK-008" },
    ];
    const mappings = mapImageNamesToMenu(
      ["MS-001.jpg", "FOOD-001.webp", "chicken-main.png", "passion-juice.jpeg", "unknown.jpg"],
      mappedProducts,
    );

    expect(mappings.slice(0, 4).every((mapping) => mapping.status === "Matched")).toBe(true);
    expect(mappings[0]?.productId).toBe(products[0]?.id);
    expect(mappings[1]?.productId).toBe(products[0]?.id);
    expect(mappings[2]?.productId).toBe(products[0]?.id);
    expect(mappings[3]?.productId).toBe(products[7]?.id);
    expect(mappings[4]?.status).toBe("Unmatched");
  });

  it("reads a real XLSX workbook package and validates its menu rows", async () => {
    const workbook = makeStoredXlsx([
      ["name", "category", "price", "prep", "productionStation"],
      ["Coconut Beans", "Main Meals", "520", "11", "MAIN KITCHEN"],
      ["Spiced Tea", "Drinks", "180", "4", "BAR"],
    ]);
    const file = new File([workbook], "menu.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const preview = await parseMenuFile(file);

    expect(preview.sourceType).toBe("xlsx");
    expect(preview.canConfirm).toBe(true);
    expect(preview.products.map((product) => product.name)).toEqual([
      "Coconut Beans",
      "Spiced Tea",
    ]);
  });
});

describe("receipt logo and invoice delivery", () => {
  it("packs transparent RGBA logo pixels into printer-compatible monochrome bytes", () => {
    const mono = convertRgbaToMonochrome(
      new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 20, 20, 20, 255]),
      2,
      2,
      150,
    );

    expect(Array.from(mono.pixels)).toEqual([1, 0, 0, 1]);
    expect(mono.packedHex).toBe("8040");
  });

  it("generates invoice PDF bytes and delivery links for email and WhatsApp", () => {
    const invoice: InvoiceDeliveryRecord = {
      id: "INV-TEST-01",
      customer: "Acme Catering",
      branch: "Westlands",
      issued: "13 Aug",
      due: "20 Aug",
      amount: 15000,
      paid: 5000,
      status: "Partial",
      email: "accounts@example.com",
      phone: "+254 700 111 222",
      lines: [{ description: "Lunch package", quantity: 2, unitPrice: 7500 }],
    };

    const text = new TextDecoder().decode(createInvoicePdfBytes(invoice));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("INV-TEST-01");
    expect(text).toContain("Acme Catering");
    expect(invoiceEmailLink(invoice)).toContain("mailto:accounts@example.com");
    expect(invoiceWhatsAppLink(invoice)).toContain("https://wa.me/254700111222");
  });
});

describe("kitchen hardware modes", () => {
  it.each<KitchenOperatingMode>([
    "KDS_ONLY",
    "PRINTER_ONLY",
    "KDS_AND_PRINTER",
    "NO_DEDICATED_KITCHEN_SYSTEM",
  ])("applies analytics adjustment for %s", (mode) => {
    const profile = profileForMode(mode);
    const adjustment = SerametPrintService.getKitchenAnalyticsAdjustment(profile);
    expect(adjustment.mode).toBe(mode);
    expect(adjustment.captureMethod.length).toBeGreaterThan(4);
    expect(adjustment.notes.length).toBeGreaterThan(0);
  });

  it("creates display jobs instead of printer jobs in KDS only mode", () => {
    const profile = profileForMode("KDS_ONLY");
    const plan = SerametPrintService.createProductionTicketJobs(profile, order, []);
    const processed = SerametPrintService.processQueuedJobs(plan.jobs);

    expect(plan.skipped).toEqual([]);
    expect(plan.jobs.every((job) => job.documentType === "KDS_TICKET")).toBe(true);
    expect(processed.every((job) => job.status === "Displayed")).toBe(true);
  });

  it("routes printer jobs in printer-only mode without requiring KDS interaction", () => {
    const profile = profileForMode("PRINTER_ONLY");
    const plan = SerametPrintService.createProductionTicketJobs(profile, order, []);
    const processed = SerametPrintService.processQueuedJobs(plan.jobs);

    expect(
      plan.jobs.some((job) => job.documentType === "FOOD_KOT" || job.documentType === "BAR_TICKET"),
    ).toBe(true);
    expect(plan.jobs.every((job) => job.kitchenDelivery === "PRODUCTION_PRINT")).toBe(true);
    expect(
      processed.every((job) => job.status === "Printed" || job.status === "Fallback Printed"),
    ).toBe(true);
  });

  it("creates one kitchen ticket record with both KDS and printer delivery in combined mode", () => {
    const profile = profileForMode("KDS_AND_PRINTER");
    const plan = SerametPrintService.createProductionTicketJobs(profile, order, []);
    const processed = SerametPrintService.processQueuedJobs(plan.jobs);
    const firstTicketJobs = plan.jobs.filter(
      (job) => job.kitchenTicketId === "KT-T100-MAINKITCHEN",
    );

    expect(firstTicketJobs).toHaveLength(2);
    expect(new Set(firstTicketJobs.map((job) => job.kitchenTicketRecordId))).toHaveLength(1);
    expect(firstTicketJobs.map((job) => job.kitchenDelivery).sort()).toEqual([
      "KDS_DISPLAY",
      "PRODUCTION_PRINT",
    ]);
    expect(processed.some((job) => job.status === "Displayed")).toBe(true);
    expect(
      processed.some((job) => job.status === "Printed" || job.status === "Fallback Printed"),
    ).toBe(true);
  });

  it("prints production copies at the POS/front printer when no dedicated kitchen system is configured", () => {
    const profile = profileForMode("NO_DEDICATED_KITCHEN_SYSTEM");
    const plan = SerametPrintService.createProductionTicketJobs(profile, order, []);
    const processed = SerametPrintService.processQueuedJobs(plan.jobs);

    expect(plan.skipped).toEqual([]);
    expect(plan.jobs.length).toBeGreaterThan(0);
    expect(plan.jobs.every((job) => job.kitchenDelivery === "POS_FRONT_PRINT")).toBe(true);
    expect(plan.jobs.every((job) => job.destination === "FRONT")).toBe(true);
    expect(
      processed.every((job) => job.status === "Printed" || job.status === "Fallback Printed"),
    ).toBe(true);
  });
});

describe("branch capabilities and module visibility", () => {
  it("exposes every spec capability flag on every branch profile", () => {
    const expected = [
      "POS_ENABLED",
      "TABLE_SERVICE",
      "KDS_ENABLED",
      "KITCHEN_PRINTING",
      "BAR_PRINTING",
      "RESERVATIONS",
      "TAKEAWAY",
      "DELIVERY",
      "ONLINE_ORDERS",
      "LOYALTY",
      "CUSTOMER_DISPLAY",
      "BAR_MODULE",
      "RECEIPT_PRINTING",
      "INVOICE_PRINTING",
    ];

    Object.values(branchHardwareProfiles).forEach((profile) => {
      expect(Object.keys(profile.capabilities).sort()).toEqual([...expected].sort());
    });
  });

  it("derives online orders and bar module visibility from branch capabilities", () => {
    const westlands = getVisibleNavGroups("General Manager", "Westlands").flatMap((group) =>
      group.items.map((item) => item.to),
    );
    const ngongRoad = getVisibleNavGroups("General Manager", "Ngong Road").flatMap((group) =>
      group.items.map((item) => item.to),
    );

    expect(westlands).toContain("/online-orders");
    expect(westlands).toContain("/bar");
    expect(ngongRoad).not.toContain("/online-orders");
    expect(ngongRoad).not.toContain("/bar");
    expect(roleCanAccessPath("General Manager", "/online-orders", "Ngong Road")).toBe(false);
    expect(roleCanAccessPath("General Manager", "/bar", "Ngong Road")).toBe(false);
  });

  it("exposes every first-class brief route through role-aware navigation", () => {
    const westlands = getVisibleNavGroups("General Manager", "Westlands").flatMap((group) =>
      group.items.map((item) => item.to),
    );

    ["/purchase-orders", "/payables", "/crm", "/decisions", "/online-orders", "/bar"].forEach(
      (path) => {
        expect(westlands).toContain(path);
        expect(roleCanAccessPath("General Manager", path, "Westlands")).toBe(true);
      },
    );
  });

  it("keeps the sensitive dashboard hidden from frontline operational roles by default", () => {
    (["Cashier", "Storekeeper", "Chef"] as const).forEach((role) => {
      const items = getVisibleNavGroups(role, "Westlands").flatMap((group) => group.items);
      expect(items.find((item) => item.to === "/")).toBeUndefined();
      expect(roleCanAccessPath(role, "/", "Westlands")).toBe(false);
    });
    expect(roleCanAccessPath("General Manager", "/", "Westlands")).toBe(true);
    expect(roleCanAccessPath("Branch Manager", "/", "Westlands")).toBe(true);
  });
});

describe("Seramet POS acceptance scenarios", () => {
  it("supports one-printer restaurants without KDS interaction or blocked completion", () => {
    const profile = profileWithPrinters("Restaurant A", "PRINTER_ONLY", [
      {
        id: "A-THERMAL-01",
        name: "Single Thermal Printer",
        branch: "Restaurant A",
        roles: ["FRONT", "RECEIPT", "BILL", "INVOICE", "KITCHEN", "BAR", "DISPATCH", "REPORT"],
        connection: "Connected",
        lastPrintAt: "now",
        queue: 0,
        failures: 0,
      },
    ]);
    const production = SerametPrintService.createProductionTicketJobs(
      profile,
      { ...order, branch: "Restaurant A" },
      [],
    );
    const bill = SerametPrintService.createDocumentJob(
      profile,
      { ...order, branch: "Restaurant A" },
      "BILL",
    );
    const receipt = SerametPrintService.createDocumentJob(
      profile,
      { ...order, branch: "Restaurant A" },
      "RECEIPT",
    );

    expect(production.jobs.map((job) => job.printerId)).toEqual(["A-THERMAL-01", "A-THERMAL-01"]);
    expect(production.jobs.every((job) => job.kitchenDelivery === "PRODUCTION_PRINT")).toBe(true);
    expect(bill.printerId).toBe("A-THERMAL-01");
    expect(receipt.printerId).toBe("A-THERMAL-01");
    expect(
      SerametPrintService.processQueuedJobs([...production.jobs, bill, receipt]).every(
        (job) => job.status === "Printed",
      ),
    ).toBe(true);
  });

  it("routes two-printer restaurants with bar tickets configured to the front printer", () => {
    const profile = profileWithPrinters("Restaurant B", "PRINTER_ONLY", [
      {
        id: "B-FRONT-01",
        name: "Front Printer",
        branch: "Restaurant B",
        roles: ["FRONT", "RECEIPT", "BILL", "INVOICE", "BAR", "REPORT"],
        connection: "Connected",
        lastPrintAt: "now",
        queue: 0,
        failures: 0,
      },
      {
        id: "B-KITCHEN-01",
        name: "Kitchen Printer",
        branch: "Restaurant B",
        roles: ["KITCHEN", "DISPATCH"],
        connection: "Connected",
        lastPrintAt: "now",
        queue: 0,
        failures: 0,
      },
    ]);
    const production = SerametPrintService.createProductionTicketJobs(
      profile,
      { ...order, branch: "Restaurant B" },
      [],
    );
    const food = production.jobs.find((job) => job.documentType === "FOOD_KOT");
    const bar = production.jobs.find((job) => job.documentType === "BAR_TICKET");
    const bill = SerametPrintService.createDocumentJob(
      profile,
      { ...order, branch: "Restaurant B" },
      "BILL",
    );
    const receipt = SerametPrintService.createDocumentJob(
      profile,
      { ...order, branch: "Restaurant B" },
      "RECEIPT",
    );

    expect(food?.printerId).toBe("B-KITCHEN-01");
    expect(bar?.printerId).toBe("B-FRONT-01");
    expect(bill.printerId).toBe("B-FRONT-01");
    expect(receipt.printerId).toBe("B-FRONT-01");
  });

  it("routes three-printer restaurants to front, kitchen and bar printers separately", () => {
    const profile = profileWithPrinters("Restaurant C", "PRINTER_ONLY", [
      {
        id: "C-FRONT-01",
        name: "Front Printer",
        branch: "Restaurant C",
        roles: ["FRONT", "RECEIPT", "BILL", "INVOICE", "REPORT"],
        connection: "Connected",
        lastPrintAt: "now",
        queue: 0,
        failures: 0,
      },
      {
        id: "C-KITCHEN-01",
        name: "Kitchen Printer",
        branch: "Restaurant C",
        roles: ["KITCHEN", "DISPATCH"],
        connection: "Connected",
        lastPrintAt: "now",
        queue: 0,
        failures: 0,
      },
      {
        id: "C-BAR-01",
        name: "Bar Printer",
        branch: "Restaurant C",
        roles: ["BAR"],
        connection: "Connected",
        lastPrintAt: "now",
        queue: 0,
        failures: 0,
      },
    ]);
    const production = SerametPrintService.createProductionTicketJobs(
      profile,
      { ...order, branch: "Restaurant C" },
      [],
    );

    expect(production.jobs.find((job) => job.documentType === "FOOD_KOT")?.printerId).toBe(
      "C-KITCHEN-01",
    );
    expect(production.jobs.find((job) => job.documentType === "BAR_TICKET")?.printerId).toBe(
      "C-BAR-01",
    );
    expect(
      SerametPrintService.createDocumentJob(
        profile,
        { ...order, branch: "Restaurant C" },
        "RECEIPT",
      ).printerId,
    ).toBe("C-FRONT-01");
  });

  it("keeps KDS-only production on KDS while bills and receipts print at the front", () => {
    const profile = profileWithPrinters("Restaurant D", "KDS_ONLY", [
      {
        id: "D-FRONT-01",
        name: "Front Printer",
        branch: "Restaurant D",
        roles: ["FRONT", "RECEIPT", "BILL", "INVOICE", "REPORT"],
        connection: "Connected",
        lastPrintAt: "now",
        queue: 0,
        failures: 0,
      },
    ]);
    const production = SerametPrintService.createProductionTicketJobs(
      profile,
      { ...order, branch: "Restaurant D" },
      [],
    );
    const processedProduction = SerametPrintService.processQueuedJobs(production.jobs);

    expect(production.jobs.every((job) => job.documentType === "KDS_TICKET")).toBe(true);
    expect(processedProduction.every((job) => job.status === "Displayed")).toBe(true);
    expect(
      SerametPrintService.createDocumentJob(profile, { ...order, branch: "Restaurant D" }, "BILL")
        .printerId,
    ).toBe("D-FRONT-01");
    expect(
      SerametPrintService.createDocumentJob(
        profile,
        { ...order, branch: "Restaurant D" },
        "RECEIPT",
      ).printerId,
    ).toBe("D-FRONT-01");
  });

  it("renders receipt acceptance content without internal cost or profit fields", () => {
    const receipt = SerametPrintService.createDocumentJob(
      profileForMode("PRINTER_ONLY"),
      {
        ...order,
        paid: 2500,
        change: 354,
        paymentMethod: "M-Pesa",
        paymentReference: "TH7XXXXXXX",
        paymentBreakdown: [{ method: "M-Pesa", amount: 2146, reference: "TH7XXXXXXX" }],
      },
      "RECEIPT",
    );

    [
      "Mona Swahili",
      "RECEIPT",
      "RCP #T-100",
      "Order: #T-100",
      "Cashier: Amina W.",
      "Chicken Biryani",
      "No ice",
      "SUBTOTAL",
      "TAX",
      "TOTAL",
      "PAID",
      "M-PESA",
      "Ref: TH7XXXXXXX",
      "Thank you for dining",
    ].forEach((text) => {
      expect(receipt.content).toContain(text);
    });
    expect(receipt.content.toLowerCase()).not.toContain("cost");
    expect(receipt.content.toLowerCase()).not.toContain("profit");
  });

  it("renders KOT and bar tickets with station-specific items, notes and no prices by default", () => {
    const production = SerametPrintService.createProductionTicketJobs(
      profileForMode("PRINTER_ONLY"),
      order,
      [],
    );
    const kot = production.jobs.find((job) => job.documentType === "FOOD_KOT");
    const bar = production.jobs.find((job) => job.documentType === "BAR_TICKET");

    expect(kot?.content).toContain("KITCHEN ORDER");
    expect(kot?.content).toContain("KOT #T-100");
    expect(kot?.content).toContain("1 x CHICKEN BIRYANI");
    expect(kot?.content).toContain("- EXTRA GRAVY");
    expect(kot?.content).toContain("SPECIAL REQUEST");
    expect(kot?.content).toContain("No chilli on one biryani");
    expect(kot?.content).not.toContain("KSh");
    expect(bar?.content).toContain("BAR ORDER");
    expect(bar?.content).toContain("2 x PASSION JUICE");
    expect(bar?.content).toContain("NO ICE");
    expect(bar?.content).not.toContain("Chicken Biryani");
  });

  it("renders unpaid bills, paid receipts and A4 invoices as separate document types", () => {
    const profile = profileForMode("PRINTER_ONLY");
    const bill = SerametPrintService.createDocumentJob(profile, order, "BILL");
    const receipt = SerametPrintService.createDocumentJob(
      profile,
      {
        ...order,
        paid: order.total,
        paymentMethod: "M-Pesa",
        paymentBreakdown: [{ method: "M-Pesa", amount: order.total, reference: "TH7XXXXXXX" }],
      },
      "RECEIPT",
    );
    const invoice = SerametPrintService.createDocumentJob(profile, order, "INVOICE");

    expect(bill.content).toContain("BILL");
    expect(bill.content).toContain("PAYMENT PENDING");
    expect(bill.content).not.toContain("PAID");
    expect(receipt.content).toContain("RECEIPT");
    expect(receipt.content).toContain("PAID");
    expect(receipt.content).toContain("M-PESA");
    expect(invoice.content).toContain("TAX INVOICE");
    expect(invoice.content).toContain("PAYMENT INFORMATION");
    expect(invoice.content).toContain("Authorised Signatory");
  });

  it("marks addition, cancelled item and duplicate production tickets clearly", () => {
    const profile = profileForMode("PRINTER_ONLY");
    const addition = SerametPrintService.createProductionTicketJobs(profile, order, [], "ADDITION")
      .jobs[0];
    const cancelled = SerametPrintService.createProductionTicketJobs(profile, order, [], "VOID")
      .jobs[0];
    const original = SerametPrintService.createProductionTicketJobs(profile, order, [], "NEW")
      .jobs[0]!;
    const reprint = SerametPrintService.createReprintJob(
      profile,
      original,
      "Branch Manager",
      "Customer requested copy",
      [],
    );

    expect(addition?.content).toContain("*** ADDITION ***");
    expect(cancelled?.content).toContain("*** CANCEL ITEM ***");
    expect(reprint.job?.content).toContain("*** DUPLICATE COPY ***");
    expect(reprint.job?.content).toContain("Original job:");
  });

  it("validates and confirms a larger menu import with categories, stations, barcodes and branch availability", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => {
      const station = ["MAIN KITCHEN", "GRILL", "BAR", "DESSERT"][index % 4]!;
      return [
        `MS-${String(index + 1).padStart(3, "0")}`,
        `Imported Item ${index + 1}`,
        `Category ${index % 10}`,
        String(200 + index),
        String(5 + (index % 20)),
        station,
        `616000${String(index + 1).padStart(6, "0")}`,
        index % 3 === 0 ? "no" : "yes",
        "yes",
      ];
    });
    const workbook = makeStoredXlsx([
      [
        "itemCode",
        "name",
        "category",
        "price",
        "prep",
        "productionStation",
        "barcode",
        "westlandsAvailable",
        "ngongRoadAvailable",
      ],
      ...rows,
    ]);
    const preview = await parseMenuFile(
      new File([workbook], "full-menu.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const confirmed = confirmMenuImport(products, preview);

    expect(preview.rowsRead).toBe(100);
    expect(preview.categories).toHaveLength(10);
    expect(new Set(preview.products.map((product) => product.productionStation))).toEqual(
      new Set(["MAIN KITCHEN", "GRILL", "BAR", "DESSERT"]),
    );
    expect(preview.canConfirm).toBe(true);
    expect(confirmed.imported).toBe(100);
  });
});

describe("existing POS migration mapping", () => {
  it("defines mapping targets for every required migration entity in the spec", () => {
    const entities: PosMigrationEntity[] = [
      "Items",
      "Categories",
      "Prices",
      "Customers",
      "Suppliers",
      "Opening Stock",
      "Employees",
      "Historical Sales",
    ];

    expect(Object.keys(posMigrationTargetFields).sort()).toEqual([...entities].sort());
    entities.forEach((entity) => {
      expect(posMigrationTargetFields[entity].some((field) => field.required)).toBe(true);
    });
  });

  it("auto maps common Toast Square Lightspeed style menu exports", () => {
    const csv = `SKU,Menu Item,Sales Category,Base Price,Food Cost,Prep Station,Image URL
FOOD-001,Chicken Biryani,Main Meals,1200,650,MAIN KITCHEN,chicken.jpg`;
    const plan = previewPosMigrationCsv(csv, "menu-export.csv", posMigrationProfiles[1]);
    const items = plan.entities.find((entity) => entity.entity === "Items");
    const coverage = migrationCoverage(plan);

    expect(items?.canImport).toBe(true);
    expect(items?.mappings.find((mapping) => mapping.targetField === "name")?.sourceColumn).toBe(
      "Menu Item",
    );
    expect(
      items?.mappings.find((mapping) => mapping.targetField === "sellingPrice")?.sourceColumn,
    ).toBe("Base Price");
    expect(
      items?.mappings.find((mapping) => mapping.targetField === "imageFilename")?.sourceColumn,
    ).toBe("Image URL");
    expect(coverage.mapped).toBeGreaterThan(0);
  });

  it("supports multi-entity migration plans and manual mapping overrides", () => {
    const plan = createPosMigrationPlan(
      [
        {
          name: "Employees",
          columns: ["Staff Name", "Position", "Outlet"],
          rows: [{ "Staff Name": "Amina", Position: "Cashier", Outlet: "Westlands" }],
        },
        {
          name: "Sales",
          columns: ["Ticket No", "Business Date", "Qty", "Net Sales"],
          rows: [{ "Ticket No": "T-1", "Business Date": "13 Aug", Qty: "1", "Net Sales": "1200" }],
        },
      ],
      "legacy-pos.xlsx",
      posMigrationProfiles[1],
    );
    const overridden = applyPosMigrationOverrides(plan, [
      { entity: "Employees", targetField: "name", sourceColumn: "Staff Name" },
    ]);

    expect(
      overridden.entities
        .find((entity) => entity.entity === "Employees")
        ?.mappings.find((mapping) => mapping.targetField === "name")?.sourceColumn,
    ).toBe("Staff Name");
    expect(
      overridden.entities.find((entity) => entity.entity === "Historical Sales")?.canImport,
    ).toBe(true);
  });
});

describe("transaction engine order to reconciliation lifecycle", () => {
  const draft: OrderDraft = {
    branch: "Westlands",
    table: "04",
    customer: "Table 04",
    channel: "Dine-In",
    cashier: "Amina W.",
    waiter: "Joan A.",
    lines: [
      {
        id: "ln-1",
        productId: "p1",
        name: "Chicken Biryani",
        category: "Main Meals",
        quantity: 1,
        unitPrice: 1250,
        productionStation: "MAIN KITCHEN",
      },
      {
        id: "ln-2",
        productId: "p8",
        name: "Passion Juice",
        category: "Drinks",
        quantity: 1,
        unitPrice: 300,
        productionStation: "BAR",
      },
    ],
  };

  const blank = (): TransactionState => ({
    orders: [],
    bills: [],
    paymentIntents: [],
    payments: [],
    receipts: [],
    externalTransactions: [],
    reconciliationMatches: [],
    journalEntries: [],
    cashDrawers: [],
    refunds: [],
    auditEvents: [],
  });

  it("stores held orders permanently without creating bills, payments or receipts", () => {
    const state = TransactionEngine.holdOrder(blank(), draft);
    const order = state.orders[0]!;

    expect(order.status).toBe("HELD");
    expect(order.id).toMatch(/^ORD-/);
    expect(state.bills).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
    expect(state.receipts).toHaveLength(0);
    expect(state.auditEvents[0]?.action).toContain("held order");
  });

  it("releases a held order, sends it to kitchen, then creates exactly one bill when requested", () => {
    let state = TransactionEngine.holdOrder(blank(), draft);
    const orderId = state.orders[0]!.id;

    state = TransactionEngine.releaseHeldOrder(state, orderId, "Amina W.");
    state = TransactionEngine.sendToKitchen(state, orderId, "Amina W.");
    state = TransactionEngine.sendToKitchen(state, orderId, "Amina W.");

    expect(state.orders[0]?.status).toBe("SENT_TO_KITCHEN");
    expect(state.bills).toHaveLength(0);
    state = TransactionEngine.requestBill(state, orderId, "Amina W.");
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]?.orderIds).toEqual([orderId]);
    expect(state.bills[0]?.status).toBe("OPEN");
    expect(state.orders[0]?.status).toBe("BILL_REQUESTED");
    expect(state.receipts).toHaveLength(0);
  });

  it("keeps POS active orders out of invoices until the cashier requests the bill", () => {
    let state = TransactionEngine.holdOrder(blank(), draft);
    const orderId = state.orders[0]!.id;

    expect(state.orders[0]?.status).toBe("HELD");
    expect(state.bills).toHaveLength(0);

    state = TransactionEngine.updateOrderDraft(
      state,
      orderId,
      {
        ...draft,
        lines: [
          ...draft.lines,
          {
            id: "ln-3",
            productId: "p7",
            name: "Chips",
            category: "Sides",
            quantity: 2,
            unitPrice: 250,
            productionStation: "MAIN KITCHEN",
          },
        ],
      },
      "Amina W.",
    );
    state = TransactionEngine.sendToKitchen(state, orderId, "Amina W.");

    expect(state.orders[0]?.status).toBe("SENT_TO_KITCHEN");
    expect(state.orders[0]?.lines).toHaveLength(3);
    expect(state.bills).toHaveLength(0);

    state = TransactionEngine.requestBill(state, orderId, "Amina W.");

    expect(state.orders[0]?.status).toBe("BILL_REQUESTED");
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]?.lines).toHaveLength(3);
    expect(state.bills[0]?.total).toBe(state.orders[0]?.total);
  });

  it("keeps payment intent separate from confirmed payment and blocks duplicate callback receipts", () => {
    let state = TransactionEngine.createOrder(blank(), draft, "OPEN");
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Amina W.");
    state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Amina W.");
    const bill = state.bills[0]!;
    const result = TransactionEngine.createPaymentIntent(state, bill.id, {
      amount: bill.total,
      method: "MPESA_PROMPT",
      provider: "M-Pesa STK",
      customerPhone: "0700000000",
      createdBy: "Amina W.",
    });

    expect(result.intent?.status).toBe("AWAITING_CUSTOMER");
    expect(result.state.payments).toHaveLength(0);

    state = TransactionEngine.confirmPaymentIntent(result.state, result.intent!.id, "MPESA-OK-1");
    state = TransactionEngine.confirmPaymentIntent(state, result.intent!.id, "MPESA-OK-1");

    expect(state.paymentIntents[0]?.status).toBe("SUCCEEDED");
    expect(state.payments).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.bills[0]?.status).toBe("PAID");
    expect(state.orders[0]?.status).toBe("PAID");
  });

  it("records cash, card, bank and manual till payments as distinct payment types", () => {
    let state = TransactionEngine.createOrder(
      blank(),
      { ...draft, lines: [{ ...draft.lines[0]!, quantity: 4 }] },
      "OPEN",
    );
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Amina W.");
    state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Amina W.");
    const billId = state.bills[0]!.id;

    state = TransactionEngine.recordManualTillPayment(state, billId, {
      amount: 1000,
      reference: "MPESA-1",
      cashier: "Amina W.",
      terminal: "WEST-POS-01",
    });
    state = TransactionEngine.recordCashPayment(state, billId, {
      received: 1000,
      cashier: "Amina W.",
      terminal: "WEST-POS-01",
    });
    state = TransactionEngine.recordCardPayment(state, billId, {
      amount: 1000,
      reference: "CARD-1",
      cashier: "Amina W.",
      terminal: "CARD-01",
      acquirer: "KCB",
      batch: "B-12",
    });
    state = TransactionEngine.recordBankPayment(state, billId, {
      amount: state.bills[0]!.total - state.bills[0]!.paid,
      reference: "BANK-1",
      cashier: "Amina W.",
      bankAccount: "Mona Equity",
      sender: "Customer",
    });

    expect(state.payments.map((payment) => payment.method).sort()).toEqual([
      "BANK_TRANSFER",
      "CARD",
      "CASH",
      "MPESA_TILL_MANUAL",
    ]);
    expect(state.payments.find((payment) => payment.method === "CARD")?.card?.batch).toBe("B-12");
    expect(
      state.payments.find((payment) => payment.method === "BANK_TRANSFER")?.bank?.bankAccount,
    ).toBe("Mona Equity");
    expect(state.receipts).toHaveLength(1);
    expect(state.receipts[0]?.paymentBreakdown).toHaveLength(4);
  });

  it("merges and splits bills while preserving order lineage and avoiding duplicate payments", () => {
    let state = TransactionEngine.createOrder(blank(), draft, "OPEN");
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Amina W.");
    state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Amina W.");
    state = TransactionEngine.createOrder(
      state,
      { ...draft, table: "04B", lines: [{ ...draft.lines[1]!, quantity: 2 }] },
      "OPEN",
    );
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Amina W.");
    state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Amina W.");

    const sourceBills = state.bills.map((bill) => bill.id);
    state = TransactionEngine.mergeBills(
      state,
      sourceBills,
      "Emmanuel K.",
      "Guests requested one bill",
    );
    const merged = state.bills[0]!;

    expect(merged.sourceBillIds?.sort()).toEqual(sourceBills.sort());
    expect(merged.orderIds).toHaveLength(2);
    expect(state.bills.filter((bill) => bill.status === "MERGED")).toHaveLength(2);
    expect(state.payments).toHaveLength(0);

    state = TransactionEngine.splitBill(
      state,
      merged.id,
      [
        { label: "Guest 1", amount: Math.floor(merged.total / 2) },
        { label: "Guest 2", amount: merged.total - Math.floor(merged.total / 2) },
      ],
      "Amina W.",
    );

    expect(state.bills.filter((bill) => bill.splitFromBillId === merged.id)).toHaveLength(2);
    expect(state.payments).toHaveLength(0);
  });

  it("matches external provider transactions by reference, amount and branch", () => {
    let state = TransactionEngine.createOrder(blank(), draft, "OPEN");
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Amina W.");
    state = TransactionEngine.requestBill(state, state.orders[0]!.id, "Amina W.");
    state = TransactionEngine.recordManualTillPayment(state, state.bills[0]!.id, {
      amount: state.bills[0]!.total,
      reference: "MPESA-MATCH-1",
      cashier: "Amina W.",
      terminal: "WEST-POS-01",
    });
    state = TransactionEngine.importExternalTransaction(state, {
      provider: "M-Pesa",
      sourceAccount: "Customer",
      destination: "Till 123456",
      branch: "Westlands",
      amount: state.payments[0]!.amount,
      direction: "INBOUND",
      currency: "KES",
      reference: "MPESA-MATCH-1",
      timestamp: "2026-08-14T12:50:00+03:00",
      description: "Customer till payment",
      providerMetadata: {},
    });

    expect(state.externalTransactions[0]?.reconciliationStatus).toBe("RECONCILED");
    expect(state.payments[0]?.reconciliationStatus).toBe("RECONCILED");
    expect(state.reconciliationMatches[0]?.confidence).toBeGreaterThanOrEqual(95);
  });

  it("keeps unmatched TendePay expenses out of the ledger until authorized review", () => {
    const state = TransactionEngine.importExternalTransaction(blank(), {
      provider: "TendePay",
      sourceAccount: "Mona Operating",
      destination: "KPLC",
      branch: "Westlands",
      amount: 18400,
      direction: "OUTBOUND",
      currency: "KES",
      reference: "KPLC-UNMATCHED",
      timestamp: "2026-08-14T09:00:00+03:00",
      description: "Electricity payment",
      providerMetadata: { category: "Utilities" },
    });

    expect(state.externalTransactions[0]?.reconciliationStatus).toBe("UNMATCHED");
    expect(state.journalEntries).toHaveLength(0);
    expect(state.reconciliationMatches).toHaveLength(0);
  });

  it("calculates cash drawer variance and records an audit event", () => {
    let state = createInitialTransactionState();
    state = TransactionEngine.closeCashDrawer(state, "CDR-00001", 6000, "Emmanuel K.");

    expect(state.cashDrawers[0]?.status).toBe("VARIANCE_REVIEW");
    expect(state.cashDrawers[0]?.variance).toBe(-200);
    expect(state.auditEvents[0]?.action).toBe("Closed cash drawer");
  });
});

describe("server persistence, provider boundaries and enforcement", () => {
  it("authenticates bearer tokens and enforces branch-scoped mutations server-side", () => {
    const env: SerametEnv = {
      SERAMET_API_TOKENS: JSON.stringify({
        token123: {
          id: "cashier-west",
          name: "Cashier West",
          role: "Cashier",
          branch: "Westlands",
        },
      }),
    };
    const actor = authenticateSerametRequest(
      new Request("https://seramet.test/api/seramet/transactions", {
        headers: { Authorization: "Bearer token123" },
      }),
      env,
    );

    expect(actor.role).toBe("Cashier");
    expect(() => authorizeSerametMutation(actor, "sendToKitchen", "Ngong Road")).toThrow(
      SerametHttpError,
    );
    expect(() => authorizeSerametMutation(actor, "sendToKitchen", "Westlands")).not.toThrow();
  });

  it("requires idempotency keys for server mutations and replays duplicate requests safely", async () => {
    const draft: OrderDraft = {
      branch: "Westlands",
      table: "IDEMP",
      customer: "Idempotency Test",
      channel: "Dine-In",
      cashier: "Amina W.",
      lines: [
        {
          id: "ln-idem",
          name: "Tea",
          category: "Drinks",
          quantity: 1,
          unitPrice: 150,
          productionStation: "BAR",
        },
      ],
    };
    const requestBody = {
      action: "holdOrder",
      idempotencyKey: "test-hold-order-001",
      payload: { draft },
    };

    const first = await handleSerametApiRequest(
      apiRequest("/api/seramet/transactions/mutate", requestBody),
      {},
    );
    const replay = await handleSerametApiRequest(
      apiRequest("/api/seramet/transactions/mutate", requestBody),
      {},
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-seramet-idempotent-replay")).toBe("true");
  });

  it("blocks cross-branch transaction mutations through the API", async () => {
    const state = createInitialTransactionState();
    const ngongOrder = state.orders.find((item) => item.branch === "Ngong Road");
    const response = await handleSerametApiRequest(
      apiRequest("/api/seramet/transactions/mutate", {
        action: "sendToKitchen",
        idempotencyKey: "test-cross-branch-001",
        payload: { orderId: ngongOrder?.id },
      }),
      {},
    );

    expect(response.status).toBe(403);
  });

  it("fails closed when live M-Pesa Daraja credentials are missing", async () => {
    const state = createInitialTransactionState();
    const intent = state.paymentIntents[0]!;
    const result = await new DarajaMpesaProvider({}).createPrompt(intent, "0700000000");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MISSING_CONFIG");
  });

  it("requires provider webhook secrets before importing bank feed transactions", async () => {
    const rejected = await handleSerametApiRequest(
      apiRequest("/api/seramet/webhooks/bank", {
        reference: "BANK-WEBHOOK-001",
        amount: 2500,
        branch: "Westlands",
      }),
      { SERAMET_BANK_WEBHOOK_SECRET: "secret" },
    );

    const accepted = await handleSerametApiRequest(
      apiRequest(
        "/api/seramet/webhooks/bank",
        {
          reference: "BANK-WEBHOOK-001",
          amount: 2500,
          branch: "Westlands",
        },
        { "x-seramet-webhook-secret": "secret" },
      ),
      { SERAMET_BANK_WEBHOOK_SECRET: "secret" },
    );

    expect(rejected.status).toBe(401);
    expect(accepted.status).toBe(200);
  });
});

function profileForMode(mode: KitchenOperatingMode): BranchHardwareProfile {
  return {
    ...branchHardwareProfiles.Westlands,
    kitchenMode: mode,
  };
}

function profileWithPrinters(
  branch: string,
  mode: KitchenOperatingMode,
  printers: BranchHardwareProfile["printers"],
): BranchHardwareProfile {
  return {
    ...branchHardwareProfiles.Westlands,
    branch,
    kitchenMode: mode,
    printers,
    stationRoutes: {
      "MAIN KITCHEN": "KITCHEN",
      GRILL: "KITCHEN",
      BAR: "BAR",
      DESSERT: "KITCHEN",
      DISPATCH: "DISPATCH",
      NONE: "FRONT",
    },
  };
}

function makeStoredXlsx(rows: string[][]) {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return makeZip({
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook><sheets><sheet name="Menu" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

function makeZip(files: Record<string, string>) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = header(30);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 8, 0);
    write32(local, 18, data.length);
    write32(local, 22, data.length);
    write16(local, 26, nameBytes.length);
    chunks.push(local, nameBytes, data);

    const directory = header(46);
    write32(directory, 0, 0x02014b50);
    write16(directory, 4, 20);
    write16(directory, 6, 20);
    write16(directory, 10, 0);
    write32(directory, 20, data.length);
    write32(directory, 24, data.length);
    write16(directory, 28, nameBytes.length);
    write32(directory, 42, offset);
    central.push(directory, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  });

  const centralOffset = offset;
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const eocd = header(22);
  write32(eocd, 0, 0x06054b50);
  write16(eocd, 8, Object.keys(files).length);
  write16(eocd, 10, Object.keys(files).length);
  write32(eocd, 12, centralSize);
  write32(eocd, 16, centralOffset);
  return new Blob([...chunks, ...central, eocd] as BlobPart[]);
}

function header(length: number) {
  return new Uint8Array(length);
}

function write16(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint16(offset, value, true);
}

function write32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

function columnName(index: number) {
  let value = "";
  let cursor = index + 1;
  while (cursor > 0) {
    const remainder = (cursor - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return value;
}

function xml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function apiRequest(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(`https://seramet.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seramet-dev-auth": "enabled",
      "x-seramet-user": "Amina W.",
      "x-seramet-role": "Cashier",
      "x-seramet-branch": "Westlands",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}
