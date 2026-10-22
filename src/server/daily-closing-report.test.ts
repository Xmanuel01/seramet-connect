import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  closingPdfLayout,
  closingReportSections,
  renderDailyClosingPdf,
} from "./daily-closing-report";
import { closeBusinessDay } from "@/payments/daily-closing";
import { TransactionEngine, createEmptyTransactionState } from "@/lib/transaction-engine";
import { allPermissionCodes } from "@/platform/permissions";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import type { ServerActor } from "@/lib/seramet-auth";
import { authenticateSerametRequest } from "@/lib/seramet-auth";
import { handleDailyClosingApi } from "./daily-closing-api";
import type { TransactionRepository } from "@/lib/seramet-repository";

vi.mock("@/lib/seramet-auth", async (original) => ({
  ...(await original<object>()),
  authenticateSerametRequest: vi.fn(),
}));
const actor: ServerActor = {
  id: "report-manager",
  name: "Manager",
  tenantId: DEMO_TENANT_ID,
  branchId: DEMO_WESTLANDS_BRANCH_ID,
  branch: "Branch",
  assignedBranchIds: [DEMO_WESTLANDS_BRANCH_ID],
  assignedBranches: [{ id: DEMO_WESTLANDS_BRANCH_ID, name: "Branch" }],
  roleIds: [],
  permissions: [...allPermissionCodes],
  role: "Manager",
  branchScope: { type: "BRANCH", branchId: DEMO_WESTLANDS_BRANCH_ID },
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T19:00:00Z"));
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  vi.mocked(authenticateSerametRequest).mockResolvedValue(actor);
});
afterEach(() => {
  vi.useRealTimers();
  setConfigurationRepositoryForTests();
  vi.resetAllMocks();
});
function fixture() {
  const state = closeBusinessDay(createEmptyTransactionState(actor.tenantId), actor, {
    businessDate: "2026-10-15",
    drawerCounts: [],
    confirmed: true,
  });
  const day = state.paymentOperations!.dayCloses[0]!;
  return {
    state,
    day,
    snapshot: day.snapshot!,
    repository: { loadState: vi.fn().mockResolvedValue(state) } as unknown as TransactionRepository,
  };
}
async function evidence(name: string, pdf: Uint8Array) {
  if (process.env.SERAMET_CLOSING_REPORT_EVIDENCE !== "true") return;
  const directory = resolve(".seramet/daily-closing");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, `${name}.pdf`), pdf);
}
describe("immutable closing PDF", () => {
  it("reports recorded components exactly, freezes source invoices and reproduces identical PDF bytes", async () => {
    let state = TransactionEngine.createOrder(
      createEmptyTransactionState(actor.tenantId),
      {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        branch: actor.branchId,
        customer: "Customer",
        channel: "Dine In",
        cashier: actor.name,
        lines: [{ id: "meal", name: "Meal", category: "Food", quantity: 1, unitPrice: 100 }],
        financialOverride: {
          subtotal: 95,
          tax: 14.4,
          total: 109.4,
          financialComponents: {
            version: 1,
            currency: "KES",
            grossSalesMinor: 10000,
            discountsMinor: 1000,
            netSalesMinor: 9000,
            serviceChargeMinor: 500,
            taxMinor: 1440,
            totalMinor: 10940,
          },
        },
      },
      "SERVED",
    );
    state.orders[0]!.businessDate = "2026-10-15";
    state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
    state = closeBusinessDay(state, actor, {
      businessDate: "2026-10-15",
      drawerCounts: [],
      confirmed: true,
    });
    const snapshot = state.paymentOperations!.dayCloses[0]!.snapshot!;
    const rows = closingReportSections(snapshot).flatMap((s) => s.rows);
    expect(rows).toContainEqual(["Discounts", "KES\u00a010.00"]);
    expect(rows).toContainEqual(["Service charges", "KES\u00a05.00"]);
    expect(snapshot.dailyReport!.outstandingInvoices).toEqual([
      { id: state.bills[0]!.id, balanceMinor: 10940 },
    ]);
    const before = await renderDailyClosingPdf(snapshot);
    await evidence("standard-components", before);
    state.bills[0]!.total = 99999;
    state.bills[0]!.financialComponents!.discountsMinor = 999;
    vi.setSystemTime(new Date("2026-10-20T20:00:00Z"));
    expect(await renderDailyClosingPdf(snapshot)).toEqual(before);
    delete snapshot.dailyReport!.invoices[0]!.financialComponents;
    expect(closingReportSections(snapshot).flatMap((s) => s.rows)).toContainEqual([
      "Breakdown unavailable",
      "1 of 1 invoices lack a recorded breakdown. No gross, discount or service amounts inferred.",
    ]);
  });
  it("uses persisted financial figures and creates a valid, revision-labelled PDF", async () => {
    const { snapshot } = fixture();
    snapshot.invoicedMinor = 12345;
    const sections = closingReportSections(snapshot);
    expect(sections.flatMap((s) => s.rows)).toContainEqual([
      "Invoiced (including tax)",
      "KES\u00a0123.45",
    ]);
    const pdf = await PDFDocument.load(await renderDailyClosingPdf(snapshot));
    expect(pdf.getSubject()).toBe(snapshot.dailyReport!.reference);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(pdf.getCreationDate()).toEqual(new Date(snapshot.closedAt));
  });
  it("summarizes long detail lists within three pages without changing the saved record", async () => {
    const { snapshot } = fixture();
    snapshot.dailyReport!.restaurant =
      "Long Restaurant and Hospitality Group Name ".repeat(4) + "\u4e2d\u6587";
    snapshot.dailyReport!.branch =
      "Long branch name, overnight service and consolidated daily reconciliation";
    snapshot.dailyReport!.outstandingInvoices = Array.from({ length: 40 }, (_, i) => ({
      id: `invoice-${i}`,
      balanceMinor: 10000 + i,
    }));
    snapshot.dailyReport!.nonblocking = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      code: "UNSETTLED_INVOICE",
      severity: "HIGH",
      sourceId: `invoice-${i}`,
      message: "Long obligation ".repeat(15),
    }));
    snapshot.dailyReport!.timeZone = "America/Argentina/Buenos_Aires";
    snapshot.dailyReport!.drawers = Array.from({ length: 20 }, (_, i) => ({
      id: `drawer-${i}`,
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      employeeId: `cashier-${i}`,
      baseCurrency: "KES",
      status: "CLOSED" as const,
      openedAt: snapshot.closedAt,
      closedAt: snapshot.closedAt,
      createdAt: snapshot.closedAt,
      updatedAt: snapshot.closedAt,
      openingFloatMinor: 0,
      expectedCashMinor: 0,
      countedCashMinor: 0,
      varianceMinor: 0,
      varianceReason: "Long recorded variance explanation ".repeat(8),
      currencyBalances: {
        KES: { openingFloatMinor: 0, expectedCashMinor: 0, countedCashMinor: 0, varianceMinor: 0 },
        EUR: { openingFloatMinor: 0, expectedCashMinor: 0, countedCashMinor: 0, varianceMinor: 0 },
      },
    }));
    snapshot.dailyReport!.cashMovements = ["PAID_OUT", "CASH_DROP", "PETTY_CASH"].map(
      (type, i) => ({
        id: `movement-${i}`,
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        drawerSessionId: "drawer-0",
        type: type as "PAID_OUT" | "CASH_DROP" | "PETTY_CASH",
        amountMinor: 0,
        currency: "KES",
        reason: "Layout stress fixture",
        actor: actor.id,
        timestamp: snapshot.closedAt,
      }),
    );
    snapshot.tenders = Array.from({ length: 7 }, (_, i) => ({
      method: `Method ${i}`,
      amountMinor: 0,
    }));
    const original = JSON.stringify(snapshot);
    const bytes = await renderDailyClosingPdf(snapshot);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getKeywords()).toContain(snapshot.dailyReport!.restaurant);
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(
      closingReportSections(snapshot).find((s) => s.title === "Reported nonblocking obligations")!
        .rows,
    ).toHaveLength(100);
    expect(
      closingReportSections(snapshot).find(
        (s) => s.title === "Outstanding invoices (not silently settled)",
      )!.rows,
    ).toHaveLength(40);
    await evidence("complex-long-report", bytes);
  });
  it("uses portrait A4, normal margins, twelve-point body text and double spacing", async () => {
    expect(closingPdfLayout).toMatchObject({ margin: 72, bodySize: 12, lineHeight: 24, pages: 3 });
    const { snapshot } = fixture();
    const report = snapshot.dailyReport!;
    report.restaurant = "Mona Swahili Restaurant - SAMPLE";
    report.branch = "Main Branch";
    report.reference = "SAMPLE-EOD-20261015-001";
    report.operatorNames = { [actor.id]: "Mary Njeri", cashier: "Grace Achieng" };
    report.cutoffMinutes = 240;
    let sample = createEmptyTransactionState(actor.tenantId);
    const groups = [
      {
        gross: 78250,
        discount: 3900,
        net: 74350,
        tax: 11896,
        total: 86246,
        lines: [
          { id: "biryani", name: "Chicken Biryani", quantity: 50, unitPrice: 850 },
          { id: "pilau", name: "Beef Pilau", quantity: 55, unitPrice: 650 },
        ],
      },
      {
        gross: 34900,
        discount: 1740,
        net: 33160,
        tax: 5305.6,
        total: 38465.6,
        lines: [
          { id: "beans", name: "Maharagwe", quantity: 80, unitPrice: 180 },
          { id: "chapati", name: "Chapati", quantity: 140, unitPrice: 50 },
          { id: "juice", name: "Fresh Mango Juice", quantity: 90, unitPrice: 150 },
        ],
      },
      {
        gross: 35500,
        discount: 1780,
        net: 33720,
        tax: 5395.2,
        total: 39115.2,
        lines: [
          { id: "breakfast", name: "Swahili Breakfast Combo", quantity: 90, unitPrice: 350 },
          { id: "coffee", name: "Swahili Coffee", quantity: 40, unitPrice: 100 },
        ],
      },
    ];
    for (const group of groups) {
      sample = TransactionEngine.createOrder(
        sample,
        {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          branch: actor.branchId,
          channel: "Dine In",
          customer: "Sample customer",
          cashier: "Grace Achieng",
          lines: group.lines.map((line) => ({ ...line, productId: line.id, category: "Food" })),
          financialOverride: {
            subtotal: group.net,
            tax: group.tax,
            total: group.total,
            financialComponents: {
              version: 1,
              currency: "KES",
              grossSalesMinor: Math.round(group.gross * 100),
              discountsMinor: Math.round(group.discount * 100),
              netSalesMinor: Math.round(group.net * 100),
              serviceChargeMinor: 0,
              taxMinor: Math.round(group.tax * 100),
              totalMinor: Math.round(group.total * 100),
            },
          },
        },
        "SERVED",
      );
      const order = sample.orders[0]!;
      sample = TransactionEngine.createOpenBill(sample, order.id);
    }
    report.invoices = sample.bills.map((bill) => ({
      ...bill,
      paymentStatus: "PAID",
      status: "PAID",
      paid: bill.total,
    }));
    expect(report.invoices).toHaveLength(3);
    expect(
      report.invoices.reduce((total, bill) => total + bill.financialComponents!.grossSalesMinor, 0),
    ).toBe(14865000);
    expect(
      report.invoices.reduce((total, bill) => total + bill.financialComponents!.totalMinor, 0),
    ).toBe(16382680);
    report.outstandingInvoices = [];
    snapshot.orderedMinor =
      snapshot.invoicedMinor =
      snapshot.settledMinor =
      snapshot.collectedMinor =
        16382680;
    snapshot.netRevenueMinor = 14123000;
    snapshot.taxMinor = 2259680;
    snapshot.refundsMinor = 180000;
    snapshot.cashVarianceMinor = -35000;
    snapshot.invoiceCount =
      snapshot.receiptCount =
      snapshot.orderCount =
      snapshot.settledInvoiceCount =
        3;
    snapshot.tenders = [
      { method: "Cash", amountMinor: 4560000 },
      { method: "M-Pesa", amountMinor: 9000000 },
      { method: "Card", amountMinor: 2822680 },
    ];
    report.drawers = [
      {
        id: "DRAWER-000014",
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        employeeId: "cashier",
        baseCurrency: "KES",
        businessDate: snapshot.businessDate,
        openedAt: "2026-10-15T04:00:00Z",
        closedAt: snapshot.closedAt,
        openingFloatMinor: 500000,
        expectedCashMinor: 4185000,
        countedCashMinor: 4150000,
        varianceMinor: -35000,
        status: "CLOSED",
        closedBy: actor.id,
        varianceReason: "Cash short by KES 350. Supervisor review required.",
        currencyBalances: {
          KES: {
            openingFloatMinor: 500000,
            expectedCashMinor: 4185000,
            countedCashMinor: 4150000,
            varianceMinor: -35000,
          },
        },
        createdAt: "2026-10-15T04:00:00Z",
        updatedAt: snapshot.closedAt,
      },
    ];
    report.cashMovements = [
      {
        id: "PAYOUT-SAMPLE",
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        drawerSessionId: "DRAWER-000014",
        type: "PAID_OUT",
        amountMinor: 875000,
        currency: "KES",
        reason: "Approved produce and kitchen supplies",
        actor: actor.id,
        timestamp: snapshot.closedAt,
      },
    ];
    const original = JSON.stringify(snapshot);
    const bytes = await renderDailyClosingPdf(snapshot);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28);
      expect(page.getHeight()).toBeCloseTo(841.89);
    }
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(await renderDailyClosingPdf(snapshot)).toEqual(bytes);
    await evidence("sample-three-page", bytes);
  });
  it("serves only authenticated authorized snapshot revisions with private cache controls", async () => {
    const { repository, day } = fixture();
    const response = await handleDailyClosingApi(
      new Request(`https://example.invalid/api/seramet/daily-closing/reports/${day.id}/1.pdf`),
      {},
      repository,
    );
    expect(response!.status).toBe(200);
    expect(response!.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response!.headers.get("Content-Type")).toBe("application/pdf");
    await expect(
      handleDailyClosingApi(
        new Request(`https://example.invalid/api/seramet/daily-closing/reports/${day.id}/99.pdf`),
        {},
        repository,
      ),
    ).rejects.toMatchObject({ status: 404 });
    vi.mocked(authenticateSerametRequest).mockResolvedValue({ ...actor, permissions: [] });
    await expect(
      handleDailyClosingApi(
        new Request(`https://example.invalid/api/seramet/daily-closing/reports/${day.id}/1.pdf`),
        {},
        repository,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects another branch and cannot find another tenant's report", async () => {
    const { repository, day } = fixture();
    vi.mocked(authenticateSerametRequest).mockResolvedValue({
      ...actor,
      branchId: "other",
      branchScope: { type: "BRANCH", branchId: "other" },
      assignedBranchIds: ["other"],
      permissions: ["reconciliation.view"],
    });
    const request = new Request(
      `https://example.invalid/api/seramet/daily-closing/reports/${day.id}/1.pdf`,
    );
    await expect(handleDailyClosingApi(request, {}, repository)).rejects.toMatchObject({
      status: 403,
    });
    vi.mocked(authenticateSerametRequest).mockResolvedValue({ ...actor, tenantId: "other-tenant" });
    await expect(handleDailyClosingApi(request, {}, repository)).rejects.toMatchObject({
      status: 404,
    });
  });
});
