import { describe, expect, it } from "vitest";
import { permissions } from "@/platform/permissions";
import { createDefaultDemoPlatformState } from "@/platform/demo/default-demo-data";
import { linkedOrderCustomer, resolvePosCustomer } from "./pos-customer-link";

const scope = { tenantId: "tenant-a", branchId: "branch-a" };
const person = { id: "customer-1", customerCode: "CUS-1", displayName: "Customer One" };

describe("POS customer selection lifecycle", () => {
  it("grants pilot cashiers masked lookup without exposing contact or spend permissions", () => {
    const cashier = createDefaultDemoPlatformState().roles.find((role) => role.code === "CASHIER");
    expect(cashier?.permissions).toContain(permissions.crmCustomerView);
    expect(cashier?.permissions).not.toContain(permissions.crmCustomerContactView);
    expect(cashier?.permissions).not.toContain(permissions.crmCustomerValueView);
  });

  it("links a verified choice to a fresh transaction draft", () => {
    const selected = resolvePosCustomer(scope, null, {
      ...scope,
      orderId: null,
      customer: person,
    });
    expect(linkedOrderCustomer(selected, "Walk-in")).toEqual({
      customer: "Customer One",
      customerId: "customer-1",
      customerCode: "CUS-1",
    });
  });

  it("preserves an existing order identity across reopen and changes", () => {
    const order = {
      id: "order-a",
      customer: "Customer One",
      customerId: "customer-1",
      customerCode: "CUS-1",
    };
    expect(resolvePosCustomer(scope, order, null)).toEqual(person);
    expect(
      resolvePosCustomer(scope, order, {
        ...scope,
        orderId: "order-b",
        customer: { ...person, id: "wrong" },
      }),
    ).toEqual(person);
  });

  it("never leaks new-order choices across a branch or into an existing order", () => {
    const selection = { ...scope, orderId: null, customer: person };
    expect(
      resolvePosCustomer({ tenantId: "tenant-a", branchId: "branch-b" }, null, selection),
    ).toBeNull();
    expect(
      resolvePosCustomer(scope, { id: "another-order", customer: "Walk-in" }, selection),
    ).toBeNull();
    expect(
      resolvePosCustomer(
        scope,
        { id: "another-order", customer: "Walk-in" },
        {
          ...scope,
          orderId: "another-order",
          customer: null,
        },
      ),
    ).toBeNull();
    expect(linkedOrderCustomer(null, "Walk-in")).toEqual({ customer: "Walk-in" });
  });
});
