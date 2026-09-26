import type { CustomerCreateInput } from "./types";

export function customerSearchPath(input: {
  query: string;
  cursor?: string | null;
  branchId: string;
  isAllBranches: boolean;
  limit?: number;
}) {
  const params = new URLSearchParams({ limit: String(input.limit ?? 30) });
  if (input.query.trim()) params.set("query", input.query.trim());
  if (input.cursor) params.set("cursor", input.cursor);
  if (!input.isAllBranches) {
    if (!input.branchId) throw new Error("Select a branch before searching customers");
    params.set("branchId", input.branchId);
  }
  return `/api/seramet/crm/customers?${params.toString()}`;
}

export function customerCreatePayload(input: {
  displayName: string;
  phone: string;
  email: string;
  accountType: "INDIVIDUAL" | "CORPORATE";
  companyName: string;
  branchId: string;
  isAllBranches: boolean;
}): CustomerCreateInput {
  const displayName = input.displayName.trim();
  const companyName = input.companyName.trim();
  if (!displayName || displayName.length > 160) {
    throw new Error("Enter a customer name of at most 160 characters");
  }
  if (input.accountType === "CORPORATE" && !companyName) {
    throw new Error("Enter the company's name");
  }
  if (!input.isAllBranches && !input.branchId) {
    throw new Error("Select a branch before creating the customer");
  }
  return {
    displayName,
    accountType: input.accountType,
    ...(input.phone.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.email.trim() ? { email: input.email.trim() } : {}),
    ...(input.accountType === "CORPORATE" ? { companyName } : {}),
    ...(!input.isAllBranches ? { preferredBranchId: input.branchId } : {}),
    createdSource: "SERAMET_CRM_UI",
  };
}
