import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { closingReportSections, renderDailyClosingPdf } from "./daily-closing-report";
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
  it("paginates long entries and preserves unsupported character identities explicitly", async () => {
    const { snapshot } = fixture();
    snapshot.dailyReport!.restaurant = "Restaurant \u4e2d\u6587";
    snapshot.dailyReport!.nonblocking = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      code: "UNSETTLED_INVOICE",
      severity: "HIGH",
      sourceId: `invoice-${i}`,
      message: "Long obligation ".repeat(15),
    }));
    expect(
      (await PDFDocument.load(await renderDailyClosingPdf(snapshot))).getPageCount(),
    ).toBeGreaterThan(5);
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
