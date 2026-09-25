import { describe, expect, it } from "vitest";
import { customerCreatePayload, customerSearchPath } from "./customer-360-model";

describe("Customer 360 request model", () => {
  it("encodes search and cursor and scopes a branch without trusting client tenant IDs", () => {
    const path = customerSearchPath({
      query: " Ana & Co ",
      cursor: "customer/01+2",
      branchId: "branch-west",
      isAllBranches: false,
    });
    const url = new URL(path, "https://example.invalid");
    expect(url.pathname).toBe("/api/seramet/crm/customers");
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      limit: "30",
      query: "Ana & Co",
      cursor: "customer/01+2",
      branchId: "branch-west",
    });
    expect(
      customerSearchPath({
        query: "",
        branchId: "branch-west",
        isAllBranches: true,
      }),
    ).not.toContain("branchId");
  });

  it("requires explicit corporate identity and never invents marketing consent", () => {
    expect(() =>
      customerCreatePayload({
        displayName: " ",
        phone: "",
        email: "",
        accountType: "INDIVIDUAL",
        companyName: "",
        branchId: "branch-a",
        isAllBranches: false,
      }),
    ).toThrow("customer name");
    expect(() =>
      customerCreatePayload({
        displayName: "Corp",
        phone: "",
        email: "",
        accountType: "CORPORATE",
        companyName: "",
        branchId: "branch-a",
        isAllBranches: false,
      }),
    ).toThrow("company's name");
    const payload = customerCreatePayload({
      displayName: " Ana ",
      phone: " 0712345678 ",
      email: "",
      accountType: "INDIVIDUAL",
      companyName: "",
      branchId: "branch-a",
      isAllBranches: false,
    });
    expect(payload).toEqual({
      displayName: "Ana",
      accountType: "INDIVIDUAL",
      phone: "0712345678",
      preferredBranchId: "branch-a",
      createdSource: "SERAMET_CRM_UI",
    });
    expect(JSON.stringify(payload)).not.toMatch(/consent/i);
  });
});
