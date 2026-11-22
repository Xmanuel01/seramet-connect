import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deliverySettings,
  deliverySettingsSchema,
  validateLocalDeliveryCharge,
  withRiderDelivery,
} from "./delivery-charge";
import { applyServerMutation } from "@/lib/seramet-repository";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type OrderDraft,
} from "@/lib/transaction-engine";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import type { ServerActor } from "@/lib/seramet-auth";
import { billingRecordToPrintOrder } from "@/lib/print-order-adapter";
import { renderCustomerBill } from "@/printing/documents/front-of-house";
import { deliveryDaySummary } from "./delivery-day-summary";
import { splitInvoiceComponents } from "@/payments/invoice-components";

const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;
const actor: ServerActor = {
  id: "test-cashier",
  name: "Test Cashier",
  tenantId,
  branchId,
  branch: "Westlands",
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: "Westlands" }],
  roleIds: [],
  role: "Cashier",
  permissions: allPermissionCodes.filter((code) => code !== permissions.paymentsReconcile),
  branchScope: { type: "BRANCH", branchId },
};
const scope = {
  tenantId,
  branchId,
  businessDate: "2026-11-22",
  timeZone: "Africa/Nairobi",
  cutoffMinutes: 0,
  currency: "KES",
};
const charge = { amountMinor: 15000, beneficiary: "RIDER" as const, source: "ORDER" as const };
const draft = (): OrderDraft => ({
  tenantId,
  branchId,
  branch: "Westlands",
  channel: "NEIGHBOURHOOD",
  customer: "Guest",
  cashier: actor.name,
  delivery: {
    status: "UNASSIGNED",
    recipientName: "Test Customer",
    phone: "0700000000",
    address: "Example building, Long Road",
    doorNumber: "4B",
    charge,
  },
  lines: [{ id: "food-line", name: "Pilau", category: "Food", quantity: 1, unitPrice: 900 }],
});
beforeEach(() => {
  const platform = createDefaultDemoPlatformState();
  platform.orderChannels.push({
    ...platform.orderChannels[0]!,
    id: "custom-delivery",
    tenantId,
    code: "NEIGHBOURHOOD",
    displayName: "Neighbourhood Dispatch",
    channelType: "OTHER",
    requiresCustomer: false,
    requiresAddress: false,
    requiresTable: false,
    isExternallyPaid: false,
    enabled: true,
    metadata: { deliverySettings: withRiderDelivery(undefined, true) },
  });
  setConfigurationRepositoryForTests(new ConfigurationRepository(platform));
});
afterEach(() => setConfigurationRepositoryForTests());

describe("channel-configured rider delivery", () => {
  it("enables amount entry without provider names and preserves settings when toggled", () => {
    const original = withRiderDelivery(undefined, true);
    const disabled = withRiderDelivery(
      {
        metadata: {
          deliverySettings: {
            ...original,
            cashHandledBy: "RIDER",
            rates: [{ id: "nearby", label: "Nearby", amountMinor: 10000, branchIds: [branchId] }],
          },
        },
      },
      false,
    );
    expect(disabled).toMatchObject({
      fulfilment: "PROVIDER",
      allowOrderAmount: false,
      cashHandledBy: "RIDER",
    });
    expect(withRiderDelivery({ metadata: { deliverySettings: disabled } }, true).rates).toEqual(
      disabled.rates,
    );
    expect(
      deliverySettingsSchema.parse({
        fulfilment: "RESTAURANT",
        beneficiary: "BUSINESS",
        allowManual: false,
        rates: [],
      }).allowOrderAmount,
    ).toBe(false);
  });
  it("rejects disabled, provider-managed, negative, fractional and forged beneficiary charges", () => {
    const enabled = withRiderDelivery(undefined, true);
    expect(() => validateLocalDeliveryCharge(charge, undefined, branchId)).toThrow();
    expect(() =>
      validateLocalDeliveryCharge(charge, { ...enabled, allowOrderAmount: false }, branchId),
    ).toThrow(/disabled/);
    expect(() =>
      validateLocalDeliveryCharge(charge, { ...enabled, fulfilment: "PROVIDER" }, branchId),
    ).toThrow();
    for (const amountMinor of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        validateLocalDeliveryCharge({ ...charge, amountMinor }, enabled, branchId),
      ).toThrow();
    expect(() =>
      validateLocalDeliveryCharge({ ...charge, beneficiary: "BUSINESS" }, enabled, branchId),
    ).toThrow(/recipient/);
    expect(() =>
      validateLocalDeliveryCharge({ ...charge, source: "PROVIDER" }, enabled, branchId),
    ).toThrow();
  });
  it("persists a separate fee without a product, grants only configured entry and prints contact details", () => {
    let state = applyServerMutation(
      createEmptyTransactionState(tenantId),
      "holdOrder",
      { draft: draft() },
      actor,
    );
    const order = state.orders[0]!;
    expect(order.total).toBe(1050);
    expect(order.lines).toHaveLength(1);
    expect(order.financialComponents).toMatchObject({
      netSalesMinor: 90000,
      deliveryChargeMinor: 15000,
      deliveryPayableMinor: 15000,
      totalMinor: 105000,
    });
    state = TransactionEngine.createOpenBill(state, order.id);
    const printed = billingRecordToPrintOrder(state.bills[0]!, [], state.orders);
    expect(printed).toMatchObject({
      subtotal: 900,
      deliveryCharge: 150,
      total: 1050,
      deliveryDetails: [{ phone: "0700000000", doorNumber: "4B" }],
    });
    const document = renderCustomerBill(
      {
        business: { name: "Test Restaurant" },
        tax: { vatRegistered: false },
        billNumber: "TEST",
        orderNumber: order.id,
        issuedAt: "22 Nov 2026",
        lines: [{ name: "Pilau", quantity: 1, unitPrice: 900 }],
        deliveryDetails: printed.deliveryDetails,
        totals: {
          subtotal: printed.subtotal,
          serviceCharge: 0,
          discount: 0,
          deliveryCharge: printed.deliveryCharge,
          total: printed.total,
          levies: [],
        },
      },
      { paper: "80mm", currency: "KES" },
    );
    expect(document.content).toContain("4B");
    expect(document.content).toContain("0700000000");
    expect(document.content).toContain("Delivery");
    expect(document.content).toContain("150.00");
    expect(() =>
      applyServerMutation(
        createEmptyTransactionState(tenantId),
        "holdOrder",
        {
          draft: {
            ...draft(),
            delivery: {
              ...draft().delivery!,
              charge: { ...charge, source: "MANUAL", reason: "Override" },
            },
          },
        },
        actor,
      ),
    ).toThrow();
  });
  it("takes EOD amounts from issued invoices and conserves split fees in the branch business date", () => {
    let state = TransactionEngine.createOrder(
      createEmptyTransactionState(tenantId),
      draft(),
      "HELD",
    );
    const order = state.orders[0]!;
    state = TransactionEngine.assignDeliveryRider(state, order.id, "Test Rider", actor.name);
    state = TransactionEngine.createOpenBill(state, order.id);
    const bill = state.bills[0]!;
    bill.businessDate = scope.businessDate;
    const parts = splitInvoiceComponents(bill.financialComponents!, [52500, 52500]);
    bill.status = "SPLIT";
    state.bills.push(
      ...parts.map((financialComponents, index) => ({
        ...bill,
        id: `split-${index}`,
        status: "OPEN" as const,
        subtotal: 525,
        tax: 0,
        total: 525,
        financialComponents,
      })),
    );
    const result = deliveryDaySummary(state, scope);
    expect(result).toMatchObject({
      chargedMinor: 15000,
      riderPayableMinor: 15000,
      businessRevenueMinor: 0,
      riders: [{ name: "Test Rider", payableMinor: 15000, invoiceIds: ["split-0", "split-1"] }],
    });
    expect(deliveryDaySummary(state, { ...scope, branchId: "other" }).chargedMinor).toBe(0);
    expect(deliveryDaySummary(state, { ...scope, tenantId: "other" }).chargedMinor).toBe(0);
    expect(deliveryDaySummary(state, { ...scope, businessDate: "2026-11-21" }).chargedMinor).toBe(
      0,
    );
  });
  it("separates business fees from rider fees on merged invoices and flags legacy breakdown gaps", () => {
    let state = createEmptyTransactionState(tenantId);
    for (const beneficiary of ["RIDER", "BUSINESS"] as const) {
      state = TransactionEngine.createOrder(
        state,
        {
          ...draft(),
          delivery: {
            ...draft().delivery!,
            rider: beneficiary,
            charge: { ...charge, beneficiary },
          },
        },
        "HELD",
      );
      state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
    }
    state = TransactionEngine.mergeBills(
      state,
      state.bills.map((bill) => bill.id),
      actor.name,
      "Test merge",
    );
    state.bills.forEach((bill) => {
      bill.businessDate = scope.businessDate;
    });
    const result = deliveryDaySummary(state, scope);
    expect(result).toMatchObject({
      chargedMinor: 30000,
      riderPayableMinor: 15000,
      businessRevenueMinor: 15000,
    });
    expect(result.riders.find((row) => row.name === "BUSINESS")!.payableMinor).toBe(0);
    const merged = state.bills.find((bill) => bill.status === "OPEN")!;
    delete merged.financialComponents;
    expect(deliveryDaySummary(state, scope)).toMatchObject({
      chargedMinor: 0,
      unclassifiedInvoiceIds: [merged.id],
    });
  });
  it("uses the local cutoff and does not duplicate fees between same-name riders", () => {
    let state = TransactionEngine.createOrder(
      createEmptyTransactionState(tenantId),
      draft(),
      "HELD",
    );
    state = TransactionEngine.assignDeliveryRider(
      state,
      state.orders[0]!.id,
      "Test Rider",
      actor.name,
    );
    state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
    const bill = state.bills[0]!;
    delete bill.businessDate;
    bill.issuedAt = "2026-11-21T22:30:00Z";
    expect(deliveryDaySummary(state, scope).chargedMinor).toBe(15000);
    expect(deliveryDaySummary(state, { ...scope, cutoffMinutes: 180 }).chargedMinor).toBe(0);
    expect(
      deliveryDaySummary(state, { ...scope, cutoffMinutes: 180, businessDate: "2026-11-21" })
        .chargedMinor,
    ).toBe(15000);
    const employee = {
      id: "rider-a",
      tenantId,
      branchId,
      name: "Test Rider",
      role: "Rider",
      department: "Delivery",
      branch: "Westlands",
      shift: "Day",
      netMonthlyPay: 0,
      monthlyWorkDays: 26,
      standardDailyHours: 8,
      active: true,
    };
    state.employees.push(employee);
    expect(deliveryDaySummary(state, scope).riders[0]!.riderId).toBe("rider-a");
    state.employees.push({ ...employee, id: "rider-b" });
    expect(deliveryDaySummary(state, scope).riders).toEqual([
      expect.objectContaining({ name: "Test Rider (identity unresolved)", payableMinor: 15000 }),
    ]);
    expect(deliveryDaySummary(state, scope).riders[0]!.riderId).toBeUndefined();
  });
  it("preserves each rider's fee when a split child is merged with another order", () => {
    let state = createEmptyTransactionState(tenantId);
    const bills: string[] = [];
    for (const rider of ["Rider A", "Rider B"]) {
      state = TransactionEngine.createOrder(
        state,
        { ...draft(), delivery: { ...draft().delivery!, rider } },
        "HELD",
      );
      state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
      bills.push(state.bills[0]!.id);
    }
    state = TransactionEngine.splitBill(
      state,
      bills[0]!,
      [
        { label: "A1", amount: 525 },
        { label: "A2", amount: 525 },
      ],
      actor.name,
    );
    state = TransactionEngine.mergeBills(
      state,
      [state.bills[0]!.id, bills[1]!],
      actor.name,
      "Merge split child",
    );
    state.bills.forEach((bill) => {
      bill.businessDate = scope.businessDate;
    });
    const result = deliveryDaySummary(state, scope);
    expect(result.riderPayableMinor).toBe(30000);
    expect(result.riders.map(({ name, payableMinor }) => ({ name, payableMinor }))).toEqual([
      { name: "Rider A", payableMinor: 15000 },
      { name: "Rider B", payableMinor: 15000 },
    ]);
  });
  it("conserves odd minor units through merge, split and another merge", () => {
    let state = createEmptyTransactionState(tenantId);
    const bills: string[] = [];
    for (const [rider, amountMinor] of [
      ["Rider A", 15001],
      ["Rider B", 15002],
      ["Rider C", 15003],
    ] as const) {
      state = TransactionEngine.createOrder(
        state,
        {
          ...draft(),
          delivery: { ...draft().delivery!, rider, charge: { ...charge, amountMinor } },
        },
        "HELD",
      );
      state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
      bills.push(state.bills[0]!.id);
    }
    state = TransactionEngine.mergeBills(state, bills.slice(0, 2), actor.name, "Merge A and B");
    const merged = state.bills[0]!;
    state = TransactionEngine.splitBill(
      state,
      merged.id,
      [
        { label: "Part 1", amount: 1000.01 },
        { label: "Part 2", amount: 1100.02 },
      ],
      actor.name,
    );
    state = TransactionEngine.mergeBills(
      state,
      [state.bills[0]!.id, bills[2]!],
      actor.name,
      "Merge child with C",
    );
    state.bills.forEach((bill) => {
      bill.businessDate = scope.businessDate;
    });
    const result = deliveryDaySummary(state, scope);
    expect(result.unclassifiedInvoiceIds).toEqual([]);
    expect(result.riderPayableMinor).toBe(45006);
    expect(result.riders.map(({ name, payableMinor }) => ({ name, payableMinor }))).toEqual([
      { name: "Rider A", payableMinor: 15001 },
      { name: "Rider B", payableMinor: 15002 },
      { name: "Rider C", payableMinor: 15003 },
    ]);
  });
  it("can merge a delivery invoice with an invoice without a delivery fee", () => {
    let state = createEmptyTransactionState(tenantId);
    for (const delivery of [{ ...draft().delivery!, rider: "Rider A" }, undefined]) {
      state = TransactionEngine.createOrder(state, { ...draft(), delivery }, "HELD");
      state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
    }
    state = TransactionEngine.mergeBills(
      state,
      state.bills.map((bill) => bill.id),
      actor.name,
      "Merge",
    );
    state.bills.forEach((bill) => {
      bill.businessDate = scope.businessDate;
    });
    expect(deliveryDaySummary(state, scope)).toMatchObject({
      chargedMinor: 15000,
      riderPayableMinor: 15000,
      unclassifiedInvoiceIds: [],
      riders: [{ name: "Rider A", payableMinor: 15000 }],
    });
  });
  it.each(["missing", "cycle", "other-tenant", "other-branch"])(
    "flags %s invoice lineage without guessing a rider",
    (kind) => {
      let state = TransactionEngine.createOrder(
        createEmptyTransactionState(tenantId),
        draft(),
        "HELD",
      );
      state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
      const bill = state.bills[0]!;
      bill.businessDate = scope.businessDate;
      bill.sourceBillIds = [kind === "cycle" ? bill.id : "source"];
      if (kind.startsWith("other-"))
        state.bills.push({
          ...bill,
          id: "source",
          sourceBillIds: undefined,
          status: "MERGED",
          ...(kind === "other-tenant" ? { tenantId: "other" } : { branchId: "other" }),
        });
      expect(deliveryDaySummary(state, scope)).toMatchObject({
        chargedMinor: 15000,
        riderPayableMinor: 15000,
        unclassifiedInvoiceIds: [bill.id],
        riders: [{ name: "Unassigned", payableMinor: 15000 }],
      });
    },
  );
  it("never overwrites a provider fee or adds a second local fee", () => {
    const state = TransactionEngine.createOrder(
      createEmptyTransactionState(tenantId),
      draft(),
      "HELD",
    );
    state.orders[0]!.externalSource = { providerId: "custom-provider" } as NonNullable<
      (typeof state.orders)[0]
    >["externalSource"];
    expect(() =>
      applyServerMutation(
        state,
        "updateOrderDraft",
        {
          orderId: state.orders[0]!.id,
          draft: {
            ...draft(),
            delivery: { ...draft().delivery!, charge: { ...charge, amountMinor: 18000 } },
          },
        },
        actor,
      ),
    ).toThrow(/Provider delivery charges/);
    expect(deliverySettings({ metadata: {} })).toBeUndefined();
  });
  it("clears a held delivery fee consistently after a JSON round trip", () => {
    const state = applyServerMutation(
      createEmptyTransactionState(tenantId),
      "holdOrder",
      { draft: draft() },
      actor,
    );
    const orderId = state.orders[0]!.id;
    const payload = JSON.parse(
      JSON.stringify({
        orderId,
        draft: { ...draft(), delivery: { ...draft().delivery!, charge: undefined } },
      }),
    );
    const updated = applyServerMutation(state, "updateOrderDraft", payload, actor).orders[0]!;
    expect(updated.total).toBe(900);
    expect(updated.delivery?.charge).toBeUndefined();
    expect(updated.financialComponents?.deliveryChargeMinor ?? 0).toBe(0);
  });
});
