export type EnterpriseNodeType =
  "GROUP" | "LEGAL_ENTITY" | "BRAND" | "REGION" | "AREA" | "BRANCH" | "WAREHOUSE" | "COMMISSARY";

export type EnterpriseNode = {
  id: string;
  type: EnterpriseNodeType;
  code: string;
  name: string;
  parentId?: string;
  legalEntityId?: string;
  brandId?: string;
  branchId?: string;
  warehouseId?: string;
  status: "ACTIVE" | "TEMPORARILY_CLOSED" | "SUSPENDED" | "CLOSED";
  effectiveFrom: string;
  effectiveTo?: string;
  timezone?: string;
  currency?: string;
  depth: number;
  childCount: number;
};

export type PolicyState =
  | "INHERIT"
  | "LOCAL_VALUE"
  | "LOCKED"
  | "ALLOWED_OVERRIDE"
  | "ALLOWED_WITHIN_RANGE"
  | "APPROVAL_REQUIRED"
  | "NOT_APPLICABLE";

export type PolicyTraceStep = {
  scopeNodeId: string;
  scopeName: string;
  depth: number;
  assignmentId: string;
  state: PolicyState;
  value: unknown;
  outcome: "APPLIED" | "INHERITED" | "BLOCKED_LOCK" | "BLOCKED_RANGE" | "APPROVAL_REQUIRED";
  effectiveFrom: string;
};

export type ResolvedEnterprisePolicy = {
  code: string;
  targetNodeId: string;
  effectiveValue: unknown;
  sourceScopeNodeId?: string;
  sourceScopeName?: string;
  sourceAssignmentId?: string;
  state?: PolicyState;
  locked: boolean;
  minimumValueMinor?: number;
  maximumValueMinor?: number;
  effectiveAt: string;
  trace: PolicyTraceStep[];
};

export type EnterpriseDashboard = {
  scope: EnterpriseNode;
  periodStart: string;
  periodEnd: string;
  currency?: string;
  managementAggregation: true;
  crossCurrency: boolean;
  totals: {
    branchCount: number;
    openBranchCount: number;
    netSalesMinor: number | null;
    grossProfitMinor: number | null;
    contributionMinor: number | null;
    orderCount: number;
    actionCount: number;
    rolloutIssueCount: number;
  };
  branches: Array<{
    branchId: string;
    branchName: string;
    currency: string;
    netSalesMinor: number;
    grossProfitMinor: number;
    contributionMinor: number;
    foodCostBps: number;
    orderCount: number;
    quality: string;
  }>;
};

export type EnterpriseOverview = {
  rootNodes: EnterpriseNode[];
  nodes: EnterpriseNode[];
  policies: Array<Record<string, unknown>>;
  rollouts: Array<Record<string, unknown>>;
  franchises: Array<Record<string, unknown>>;
  readiness: Array<Record<string, unknown>>;
  supplierContracts: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  policyExceptions: Array<Record<string, unknown>>;
  franchiseFees: Array<Record<string, unknown>>;
  compliance: Array<Record<string, unknown>>;
  capabilityStatus: {
    oidc: "BOUNDARY_ONLY";
    saml: "BOUNDARY_ONLY";
    scim: "SPEC_REQUIRED";
    statutoryConsolidation: "NOT_SUPPORTED";
    authoritativeFx: "NOT_CONFIGURED";
  };
};
