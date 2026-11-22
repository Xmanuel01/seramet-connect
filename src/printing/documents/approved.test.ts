import { beforeEach, describe, expect, it } from "vitest";
import { buildThermalLayout } from "../../../printing-core/thermal-layout.mjs";
// @ts-expect-error The bridge is plain JavaScript with no type declarations.
import { encodeEscPos } from "../../../local-print-bridge/escpos-encoder.mjs";
import {
  SerametPrintService,
  approvedDateTime,
  type BranchHardwareProfile,
  type OrderForPrint,
} from "@/lib/seramet-print-service";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import { renderApprovedInvoice, renderApprovedReceipt } from "./approved";

type Paper = "58mm" | "80mm";
const PAPERS: Paper[] = ["58mm", "80mm"];

function profileFor(paper: Paper): BranchHardwareProfile {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  const profile = SerametPrintService.getBranchHardwareProfile(
    DEMO_WESTLANDS_BRANCH_ID,
    DEMO_TENANT_ID,
  );
  profile.kitchenMode = "PRINTER_ONLY";
  profile.printIdentity.businessName = "Mona Swahili Restaurant";
  profile.printIdentity.receiptBrand = "Mona Swahili Restaurant";
  profile.printIdentity.address = "Kipro Centre, Westlands, Sports Road, Nairobi";
  profile.printIdentity.phone = "+254 719 427 919";
  profile.printIdentity.tillNumber = "4235484";
  profile.printIdentity.timeZone = "Africa/Nairobi";
  profile.printIdentity.currency = "KES";
  profile.printIdentity.paymentInstructions = [];
  for (const template of Object.values(profile.templateSettings)) template.width = paper;
  for (const route of Object.values(profile.documentRoutes)) route.template = paper;
  return profile;
}

const line = (
  id: string,
  name: string,
  quantity: number,
  unitPrice: number,
  productionStation: OrderForPrint["lines"][number]["productionStation"],
  extra: Partial<OrderForPrint["lines"][number]> = {},
): OrderForPrint["lines"][number] => ({
  id,
  name,
  category: "Menu",
  quantity,
  unitPrice,
  productionStation,
  ...extra,
});

function baseOrder(overrides: Partial<OrderForPrint> = {}): OrderForPrint {
  return {
    orderId: "ORD-06551",
    branch: "Westlands",
    terminalId: "WEST-POS-01",
    orderType: "Uber Eats",
    customer: "Uber Eats",
    requestedBy: "Emmanuel O.",
    cashier: "Emmanuel O.",
    waiter: "Emmanuel O.",
    // 10:24 in Nairobi.
    createdAt: "2026-11-22T07:24:00.000Z",
    invoiceNumber: "INV-0633U",
    receiptNumber: "RCP-0386S",
    lines: [
      line("l1", "Mbuzi Stew + Rice", 2, 1150, "MAIN KITCHEN"),
      line("l2", "Ugali", 3, 150, "MAIN KITCHEN"),
    ],
    subtotal: 2750,
    deliveryCharge: 100,
    tax: 0,
    total: 2850,
    ...overrides,
  };
}

function bounded(content: string, paper: Paper) {
  const width = paper === "58mm" ? 32 : 42;
  for (const text of content.split("\n")) {
    expect(text.length, text).toBeLessThanOrEqual(width);
    expect(text, text).toMatch(/^[\x20-\x7e]*$/);
    if (text.startsWith("|") || text.startsWith("+")) expect(text.length, text).toBe(width);
  }
  // Both rendering modes accept the document as is.
  expect(() => buildThermalLayout(content, paper)).not.toThrow();
  expect(() =>
    encodeEscPos(content, { paperWidth: paper, encoding: "ascii", cutter: "partial" }),
  ).not.toThrow();
}

function station(profile: BranchHardwareProfile, order: OrderForPrint, kind = "NEW" as const) {
  const jobs = SerametPrintService.createProductionTicketJobs(profile, order, [], kind).jobs.filter(
    (job) => job.kitchenDelivery !== "KDS_DISPLAY",
  );
  return {
    kot: jobs.find((job) => job.documentType === "FOOD_KOT")?.content,
    bot: jobs.find((job) => job.documentType === "BAR_TICKET")?.content,
    jobs,
  };
}

const doc = (profile: BranchHardwareProfile, order: OrderForPrint, type: "BILL" | "RECEIPT") =>
  SerametPrintService.createDocumentJob(profile, order, type).content;

const flat = (content: string) => content.replace(/[\s|]+/g, " ");
/** The left column of the number / DATE-TIME block, without the right column. */
const leftColumn = (content: string) =>
  content
    .split("\n")
    .map((row) => row.split(" | ")[0]!.trim())
    .join(" ");

describe("approved date and time", () => {
  it("prints in the branch time zone as on the approved tickets", () => {
    expect(approvedDateTime("2026-11-22T07:24:00.000Z", "Africa/Nairobi")).toEqual({
      date: "22 Nov 2026",
      time: "10:24 AM",
    });
    expect(approvedDateTime("2026-11-21T12:00:00.000Z", "Africa/Nairobi").time).toBe("3:00 PM");
  });
});

for (const paper of PAPERS) {
  describe(`approved KOT and BOT on ${paper}`, () => {
    let profile: BranchHardwareProfile;
    beforeEach(() => {
      profile = profileFor(paper);
    });

    it("reproduces the approved KOT structure for a marketplace order", () => {
      const { kot } = station(
        profile,
        baseOrder({
          kitchenNote: "Pack items separately",
          lines: [
            line("l1", "Mbuzi Stew + Rice", 2, 1150, "MAIN KITCHEN", {
              itemNote: "Extra soup on the side",
            }),
            line("l2", "Ugali", 3, 150, "MAIN KITCHEN"),
          ],
        }),
      );
      bounded(kot!, paper);
      const rows = kot!.split("\n");
      expect(rows[0]!.trim()).toBe("KITCHEN ORDER");
      expect(rows[1]).toMatch(/^NEW ORDER\s+KITCHEN$/);
      expect(rows[2]).toMatch(/^-+$/);
      expect(rows.slice(3, 6)).toEqual(["ORDER #06551", "DATE: 22 Nov 2026", "TIME: 10:24 AM"]);
      expect(rows[6]).toMatch(/^(- )+-?$/);
      expect(rows[7]).toBe("CUSTOMER: Uber Eats");
      // Item instructions directly under their item, general ones once under all items.
      expect(kot).toMatch(/^2 x Mbuzi Stew \+ Rice\n {4}Item instructions: Extra/m);
      expect(flat(kot!)).toContain("Item instructions: Extra soup on the side");
      expect(kot!.indexOf("GENERAL INSTRUCTIONS")).toBeGreaterThan(kot!.indexOf("3 x Ugali"));
      expect(kot).toMatch(/\|\s+Pack items separately\s+\|/);
      expect(kot).toContain("REQUESTED BY: Emmanuel O.");
      expect(rows.at(-1)!.trim()).toBe("END OF KITCHEN ORDER");
      for (const absent of [
        "MONA",
        "Mona",
        "Kipro",
        "1,150.00",
        "2,850.00",
        "KES",
        "DELIVERY",
        "Delivery",
        "Service",
        "SERVICE",
        "[if provided]",
      ])
        expect(kot).not.toContain(absent);
    });

    it("prints single items, long names and no empty instruction sections", () => {
      const long = "Slow-cooked coastal coconut fish curry with saffron pilau and kachumbari";
      const { kot } = station(
        profile,
        baseOrder({ lines: [line("l1", long, 1, 900, "MAIN KITCHEN")], kitchenNote: "  " }),
      );
      bounded(kot!, paper);
      expect(flat(kot!)).toContain(`1 x ${long}`);
      // Continuation lines sit under the item name, not under the quantity.
      expect(kot!.split("\n").find((row) => row.startsWith("    "))).toBeDefined();
      expect(kot).not.toContain("Item instructions");
      expect(kot).not.toContain("GENERAL INSTRUCTIONS");
      expect(kot).not.toContain("[if provided]");
    });

    it("shows the table for dine-in and Walk-in when no customer is named", () => {
      const dineIn = station(
        profile,
        baseOrder({ orderType: "Dine-In", customer: "Table 08", table: "08" }),
      ).kot!;
      expect(dineIn).toContain("CUSTOMER: Dine-in");
      expect(dineIn).toContain("TABLE: 08");
      for (const customer of [undefined, "Walk-in Customer", ""]) {
        const takeaway = station(profile, baseOrder({ orderType: "Takeaway", customer })).kot!;
        expect(takeaway).toContain("CUSTOMER: Walk-in");
        expect(takeaway).not.toContain("TABLE:");
      }
    });

    it("splits kitchen and bar items, with beverage modifiers on the BOT only", () => {
      const order = baseOrder({
        customer: "Walk-in Customer",
        kitchenNote: "Chilled",
        lines: [
          line("l1", "Ugali", 1, 150, "MAIN KITCHEN"),
          line("l2", "Still Water 500ml", 1, 150, "BAR", {
            modifiers: ["Large", "No ice"],
            itemNote: "Slice of lemon",
          }),
          line("l3", "Gin & Tonic", 2, 600, "BAR", { modifiers: ["Double", "Tonic: Fever-Tree"] }),
          line("l4", "Delivery fee", 1, 100, "NONE"),
        ],
      });
      const { kot, bot } = station(profile, order);
      bounded(bot!, paper);
      expect(bot!.split("\n")[0]!.trim()).toBe("BAR ORDER");
      expect(bot).toMatch(/^NEW ORDER\s+BAR$/m);
      expect(bot).toMatch(
        /^1 x Still Water 500ml\n {4}- Large\n {4}- No ice\n {4}Item instructions:/m,
      );
      expect(bot).toMatch(/^2 x Gin & Tonic\n {4}- Double\n {4}- Tonic: Fever-Tree$/m);
      expect(bot).toContain("CUSTOMER: Walk-in");
      expect(bot!.split("\n").at(-1)!.trim()).toBe("END OF BAR ORDER");
      expect(bot).not.toContain("Ugali");
      expect(kot).not.toContain("Still Water");
      for (const ticket of [kot!, bot!]) {
        expect(ticket).not.toContain("Delivery fee");
        expect(ticket).not.toMatch(/Prepared by|Issued by/i);
      }
    });

    it("marks additions, cancellations and reprints without re-sending other items", () => {
      const addition = station(
        profile,
        baseOrder({ lines: [line("l9", "Chapati", 2, 50, "MAIN KITCHEN")] }),
        "ADDITION" as never,
      ).kot!;
      expect(addition).toMatch(/^ADDED ITEMS\s+KITCHEN$/m);
      expect(addition).toContain("2 x Chapati");
      expect(addition).not.toContain("Mbuzi");

      const cancelled = station(
        profile,
        baseOrder({
          lines: [line("l2", "Ugali", 1, 150, "MAIN KITCHEN")],
          voidReason: "Guest changed order",
          voidedBy: "Collins K.",
          voidApprovedBy: "Manuel",
        }),
        "VOID" as never,
      ).kot!;
      expect(cancelled).toMatch(/^CANCELLED\s+KITCHEN$/m);
      expect(cancelled).toContain("DO NOT PREPARE THESE ITEMS");
      expect(cancelled).toContain("REQUESTED BY: Collins K.");
      expect(cancelled).toContain("REASON: Guest changed order");
      expect(cancelled).toContain("APPROVED BY: Manuel");

      const reprint = station(
        profile,
        baseOrder({ requestedBy: "Manuel" }),
        "REPRINT" as never,
      ).kot!;
      expect(reprint).toMatch(/^REPRINT\s+KITCHEN$/m);
      expect(reprint).toContain("REQUESTED BY: Manuel");

      // A second NEW plan for the same order is skipped, so nothing is prepared twice.
      const first = SerametPrintService.createProductionTicketJobs(profile, baseOrder(), [], "NEW");
      const again = SerametPrintService.createProductionTicketJobs(
        profile,
        baseOrder(),
        first.jobs,
        "NEW",
      );
      expect(again.jobs).toHaveLength(0);
      expect(again.skipped.length).toBeGreaterThan(0);
    });
  });

  describe(`approved invoice on ${paper}`, () => {
    let profile: BranchHardwareProfile;
    beforeEach(() => {
      profile = profileFor(paper);
    });

    it("reproduces the approved invoice with delivery kept apart from food", () => {
      const invoice = doc(profile, baseOrder(), "BILL");
      bounded(invoice, paper);
      const rows = invoice.split("\n");
      expect(rows[0]!.trim()).toBe("MONA SWAHILI RESTAURANT");
      expect(flat(invoice)).toContain("Kipro Centre, Westlands, Sports Road, Nairobi");
      expect(invoice).toContain("Tel: +254 719 427 919");
      expect(rows.some((row) => row.trim() === "INVOICE")).toBe(true);
      expect(invoice).toMatch(/^INV #0633U\s+\| DATE:$/m);
      expect(invoice).toMatch(/\| 22 Nov 2026$/m);
      expect(invoice).toMatch(/\| 10:24 AM$/m);
      expect(leftColumn(invoice)).toContain("CUSTOMER: Uber Eats");
      if (paper === "80mm") {
        expect(invoice).toMatch(/^\|QTY\|ITEM\s+\|UNIT \(KES\)\|TOTAL \(KES\)\|$/m);
        expect(invoice).toMatch(/^\| 3 \|Ugali\s+\|\s+150\.00\|\s+450\.00\|$/m);
      } else {
        expect(invoice).toMatch(/^\|QTY\|ITEM\s+\|TOTAL \(KES\)\|$/m);
        expect(invoice).toMatch(/^\| {3}\|@ 150\.00\s+\|\s+\|$/m);
      }
      expect(invoice).toMatch(/^\s+SUBTOTAL\s+2,750\.00$/m);
      expect(invoice).toMatch(/^\s+DELIVERY CHARGE\s+100\.00$/m);
      // VAT is not configured on this order, so no VAT row is invented.
      expect(invoice).not.toMatch(/\bVAT\b/);
      const grand = rows.findIndex((row) => row.startsWith("GRAND TOTAL"));
      expect(rows[grand]).toMatch(/^GRAND TOTAL\s+KES 2,850\.00$/);
      expect(rows[grand - 1]).toMatch(/^-+$/);
      expect(rows[grand + 1]).toMatch(/^-+$/);
      // The till appears only in the payment section, never in the header.
      expect(invoice.indexOf("4235484")).toBeGreaterThan(grand);
      expect(invoice).toContain("Till No. 4235484");
      expect(invoice).toContain("Amount: KES 2,850.00");
      expect(invoice).toContain("Dynamic QR payment unavailable.");
      expect(invoice).not.toMatch(/UNPAID|SCAN TO PAY/);
      // Delivery is a charge, never an item row.
      expect(invoice).not.toMatch(/^\|.*Delivery/m);
    });

    it("prints VAT from the recorded tax, added on top or included", () => {
      const exclusive = doc(
        profile,
        baseOrder({ deliveryCharge: 0, subtotal: 2750, tax: 440, total: 3190 }),
        "BILL",
      );
      expect(exclusive).toMatch(/^\s+VAT\s+440\.00$/m);
      expect(exclusive).toMatch(/^GRAND TOTAL\s+KES 3,190\.00$/m);
      const inclusive = doc(
        profile,
        baseOrder({ deliveryCharge: 0, subtotal: 2750, tax: 379.31, total: 2750 }),
        "BILL",
      );
      expect(inclusive).toMatch(/^\s+VAT \(incl\.\)\s+379\.31$/m);
      expect(inclusive).toMatch(/^GRAND TOTAL\s+KES 2,750\.00$/m);
      profile.templateSettings.BILL.showTax = false;
      expect(doc(profile, baseOrder({ tax: 440, total: 3290 }), "BILL")).not.toMatch(/\bVAT\b/);
    });

    it("shows a partial payment and asks only for the balance", () => {
      const invoice = doc(profile, baseOrder({ paid: 1000 }), "BILL");
      expect(invoice).toMatch(/^\s+AMOUNT PAID\s+1,000\.00$/m);
      expect(invoice).toMatch(/^\s+BALANCE DUE\s+1,850\.00$/m);
      expect(invoice).toContain("Amount: KES 1,850.00");
      expect(invoice).not.toMatch(/\bPAID\b(?! )/);
    });

    it("prints a scan-to-pay QR only when a real payload is supplied", () => {
      const ctx = { paper, currency: "KES" } as const;
      const input = {
        business: { name: "Mona Swahili Restaurant" },
        invoiceNumber: "INV-1",
        date: "22 Nov 2026",
        time: "10:25 AM",
        lines: [{ name: "Ugali", quantity: 1, unitPrice: 150 }],
        totals: { subtotal: 150, total: 150 },
      };
      const live = renderApprovedInvoice(
        { ...input, mpesa: { till: "4235484", qrPayload: "00020101021229300012..." } },
        ctx,
      );
      expect(live.qrCodes).toEqual([
        {
          payload: "00020101021229300012...",
          caption: "Scan to pay with M-Pesa",
          purpose: "PAYMENT",
        },
      ]);
      expect(live.content).toContain("SCAN TO PAY WITH M-PESA");
      expect(live.content).not.toContain("unavailable");
      const fallback = renderApprovedInvoice({ ...input, mpesa: { till: "4235484" } }, ctx);
      expect(fallback.qrCodes).toEqual([]);
      expect(fallback.content).toContain("PAY WITH M-PESA");
      expect(fallback.content).not.toContain("SCAN TO PAY");
      const settled = renderApprovedInvoice(
        { ...input, paid: 150, mpesa: { till: "4235484" } },
        ctx,
      );
      expect(settled.content).not.toContain("M-PESA");
    });
  });

  describe(`approved receipt on ${paper}`, () => {
    let profile: BranchHardwareProfile;
    beforeEach(() => {
      profile = profileFor(paper);
    });

    const paidOrder = (overrides: Partial<OrderForPrint> = {}) =>
      baseOrder({
        customer: "Walk-in Customer",
        orderType: "Takeaway",
        deliveryCharge: 0,
        lines: [
          line("l1", "Chicken Samosa", 2, 100, "MAIN KITCHEN"),
          line("l2", "Eggs", 1, 250, "MAIN KITCHEN"),
          line("l3", "Still Water 500ml", 1, 150, "BAR"),
          line("l4", "Kenyan Tea / African Tea", 1, 250, "BAR"),
          line("l5", "Toast Plain", 1, 150, "MAIN KITCHEN"),
        ],
        subtotal: 1000,
        tax: 0,
        total: 1000,
        paid: 1000,
        paymentBreakdown: [{ method: "M-Pesa", amount: 1000, reference: "TKM3QX81ZP" }],
        ...overrides,
      });

    it("reproduces the approved receipt after confirmed payment", () => {
      const receipt = doc(profile, paidOrder(), "RECEIPT");
      bounded(receipt, paper);
      const rows = receipt.split("\n");
      expect(rows[0]!.trim()).toBe("MONA SWAHILI RESTAURANT");
      expect(receipt).toMatch(/^RECEIPT\s+\[ PAID \]$/m);
      expect(receipt).toMatch(/^RCPT #0386S\s+\| DATE:$/m);
      expect(leftColumn(receipt)).toContain("CUSTOMER: Walk-in");
      expect(receipt.match(/^\| 1 \|/gm)?.length).toBe(4);
      expect(receipt.match(/^\| 2 \|/gm)?.length).toBe(1);
      expect(receipt).toMatch(/^\s+SUBTOTAL\s+1,000\.00$/m);
      expect(receipt).toMatch(/^GRAND TOTAL\s+KES 1,000\.00$/m);
      expect(receipt).toMatch(
        /^PAYMENT DETAILS\nMethod: M-Pesa\nReference: TKM3QX81ZP\nAmount Paid: KES 1,000\.00$/m,
      );
      expect(rows.at(-1)!.trim()).toBe("THANK YOU FOR YOUR BUSINESS");
      // No eTIMS data from an integration, so no fiscal section or placeholder.
      expect(receipt).not.toMatch(/eTIMS|Fiscal|CU Serial|\[(?! PAID \])/);
      expect(receipt).not.toContain("4235484");
    });

    it("prints cash, card and split payments as recorded", () => {
      const cash = doc(
        profile,
        paidOrder({
          paymentBreakdown: [{ method: "Cash", amount: 1000, reference: "CASH-INV-1" }],
          change: 500,
        }),
        "RECEIPT",
      );
      expect(cash).toMatch(/^Method: Cash\nAmount Paid: KES 1,500\.00$/m);
      expect(cash).toContain("Change: KES 500.00");
      expect(cash).not.toContain("CASH-INV");
      const card = doc(
        profile,
        paidOrder({
          paymentBreakdown: [{ method: "Card", amount: 1000, reference: "AUTH 551203" }],
        }),
        "RECEIPT",
      );
      expect(card).toMatch(/^Method: Card\nReference: AUTH 551203$/m);
      const split = doc(
        profile,
        paidOrder({
          paymentBreakdown: [
            { method: "M-Pesa", amount: 600, reference: "TKM3QX81ZP" },
            { method: "Cash", amount: 400 },
          ],
        }),
        "RECEIPT",
      );
      expect(split).toMatch(/Amount Paid: KES 600\.00\n\nMethod: Cash\nAmount Paid: KES 400\.00/);
      expect(split).toMatch(/^RECEIPT\s+\[ PAID \]$/m);
    });

    it("never marks a partly paid transaction as PAID", () => {
      const partial = doc(
        profile,
        paidOrder({
          paid: 600,
          paymentBreakdown: [{ method: "M-Pesa", amount: 600, reference: "TKM3QX81ZP" }],
        }),
        "RECEIPT",
      );
      expect(partial).toMatch(/^RECEIPT$/m);
      expect(partial).not.toContain("PAID ]");
      expect(partial).toContain("Balance Due: KES 400.00");
      expect(partial).toMatch(/^GRAND TOTAL\s+KES 1,000\.00$/m);
    });

    it("shows VAT only when charged and eTIMS only from real fiscal data", () => {
      const vat = doc(profile, paidOrder({ tax: 160, total: 1160, paid: 1160 }), "RECEIPT");
      expect(vat).toMatch(/^\s+VAT\s+160\.00$/m);
      const ctx = { paper, currency: "KES" } as const;
      const input = {
        business: { name: "Mona Swahili Restaurant" },
        receiptNumber: "RCP-1",
        date: "22 Nov 2026",
        time: "11:36 AM",
        lines: [{ name: "Eggs", quantity: 1, unitPrice: 250 }],
        totals: { subtotal: 250, total: 250 },
        payments: [{ method: "M-Pesa", amount: 250, reference: "TKM3QX81ZP" }],
        paid: 250,
      };
      const signed = renderApprovedReceipt(
        {
          ...input,
          etims: {
            status: "SIGNED",
            cuSerial: "KRAMW017202207012345",
            cuInvoiceNumber: "0170123450000012345",
            verifyUrl: "https://etims.kra.go.ke/verify/0170123450000012345",
          },
        },
        ctx,
      );
      bounded(signed.content, paper);
      expect(signed.content).toContain("eTIMS VERIFY");
      expect(flat(signed.content)).toContain("KRAMW017202207012345");
      expect(signed.qrCodes).toEqual([
        {
          payload: "https://etims.kra.go.ke/verify/0170123450000012345",
          caption: "Scan to verify on KRA eTIMS",
          purpose: "ETIMS_VERIFY",
        },
      ]);
      const pending = renderApprovedReceipt({ ...input, etims: { status: "PENDING" } }, ctx);
      expect(pending.content).toContain("eTIMS PENDING");
      expect(pending.qrCodes).toEqual([]);
      expect(renderApprovedReceipt(input, ctx).qrCodes).toEqual([]);
    });

    it("keeps printed totals equal to the order and payment records", () => {
      const order = paidOrder({
        subtotal: 1000,
        serviceCharge: 100,
        discount: 50,
        tax: 168,
        total: 1218,
        paid: 1218,
        paymentBreakdown: [{ method: "M-Pesa", amount: 1218, reference: "TKM3QX81ZP" }],
      });
      for (const content of [doc(profile, order, "RECEIPT"), doc(profile, order, "BILL")]) {
        expect(content).toMatch(/^\s+SUBTOTAL\s+1,000\.00$/m);
        expect(content).toMatch(/^\s+SERVICE CHARGE\s+100\.00$/m);
        expect(content).toMatch(/^\s+DISCOUNT\s+\(50\.00\)$/m);
        expect(content).toMatch(/^\s+VAT\s+168\.00$/m);
        expect(content).toMatch(/^GRAND TOTAL\s+KES 1,218\.00$/m);
      }
    });
  });
}
