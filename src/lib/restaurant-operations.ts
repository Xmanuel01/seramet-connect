import { ksh } from "@/lib/currency";
import {
  SerametPrintService,
  type BranchHardwareProfile,
  type PrinterConnection,
} from "@/lib/seramet-print-service";
import { TransactionEngine, type TransactionState } from "@/lib/transaction-engine";
import { LOCAL_PILOT_TENANT_ID } from "@/platform/pilot-defaults";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export type OperationsSeverity = "critical" | "warning" | "info";
export type OperationsAction = {
  id: string;
  sev: OperationsSeverity;
  title: string;
  detail: string;
  branch: string;
  time: string;
  action: string;
  to: string;
  category:
    "Inventory" | "Cash" | "Kitchen" | "People" | "Payments" | "Refunds" | "Hardware" | "Menu";
};

export type HealthSignal = {
  name: "Sales" | "Inventory" | "Cash" | "Labour" | "Customers" | "Kitchen";
  state: "Healthy" | "Attention" | "Warning";
};

export type BranchOperationsSummary = {
  score: number;
  label: "Healthy" | "Attention" | "Critical";
  signals: HealthSignal[];
  actions: OperationsAction[];
  openOrders: number;
  lateKitchenTickets: number;
  lowStockItems: number;
  unreadablePayments: number;
  readiness: {
    score: number;
    checks: {
      label: string;
      ok: boolean;
      detail: string;
      to: string;
    }[];
  };
};

const branchMatches = (recordBranch: string | undefined, branch: string) =>
  isAllBranchScope(branch) || !recordBranch || recordBranch === branch;

const isAllBranchScope = (branch: string) => /^all(?:\s+branches)?$/i.test(branch.trim());

export function deriveBranchOperations(
  state: TransactionState,
  branch: string,
): BranchOperationsSummary {
  const now = Date.now();
  const branchOrders = state.orders.filter((order) => branchMatches(order.branch, branch));
  const openOrders = branchOrders.filter(
    (order) => !["PAID", "CANCELLED", "REFUNDED"].includes(order.status),
  );
  const lateKitchenOrders = openOrders.filter((order) => {
    if (!["SENT_TO_KITCHEN", "IN_PROGRESS"].includes(order.status)) return false;
    const created = new Date(order.createdAt).getTime();
    return Number.isFinite(created) && now - created >= 18 * 60_000;
  });

  const inventory = TransactionEngine.getInventoryRows(state, branch);
  const lowStock = inventory.filter((item) => item.stock < item.par);
  const criticalStock = lowStock.filter(
    (item) => item.status === "Critical" || item.stock <= item.par * 0.25,
  );
  const requestedRefunds = state.refunds.filter(
    (refund) => branchMatches(refund.branch, branch) && refund.status === "REQUESTED",
  );
  const pendingReconciliation = state.payments.filter(
    (payment) =>
      branchMatches(payment.branch, branch) &&
      ["UNMATCHED", "SUGGESTED", "MATCHED", "PARTIALLY_MATCHED"].includes(
        payment.reconciliationStatus,
      ),
  );
  const drawersNeedingAttention = state.cashDrawers.filter(
    (drawer) =>
      branchMatches(drawer.branch, branch) &&
      (drawer.status === "VARIANCE_REVIEW" || Math.abs(drawer.variance ?? 0) > 0),
  );
  const peopleExceptions = state.attendanceRecords
    .filter(
      (record) =>
        branchMatches(record.branch, branch) &&
        (record.status === "LATE" || record.status === "ABSENT"),
    )
    .map((record) => ({
      name: record.employeeName,
      status: record.status === "LATE" ? `Late ${record.minutesLate} min` : "Absent",
    }));
  const unavailableMenu = state.recipes
    .filter((recipe) => {
      if (isAllBranchScope(branch)) {
        const configuredBranches = getConfigurationRepository()
          .listBranches(state.tenantId ?? LOCAL_PILOT_TENANT_ID)
          .map((configuredBranch) => configuredBranch.name);
        return configuredBranches.every(
          (candidate) =>
            !TransactionEngine.getProductAvailability(state, candidate, recipe.productId).available,
        );
      }
      return !TransactionEngine.getProductAvailability(state, branch, recipe.productId).available;
    })
    .map((recipe) => ({ id: recipe.productId, name: recipe.dish }));

  const hardwareProfiles = profilesForBranch(branch);
  const hardwareExceptions = hardwareProfiles.flatMap((profile) =>
    profile.printers.filter((printer) => printer.connection !== "Connected"),
  );

  const actions: OperationsAction[] = [];

  if (criticalStock.length > 0) {
    actions.push({
      id: "critical-stock",
      sev: "critical",
      title: `${criticalStock.length} item${criticalStock.length === 1 ? " is" : "s are"} critically below PAR`,
      detail: criticalStock
        .slice(0, 4)
        .map(
          (item) =>
            `${item.name} ${formatQty(item.stock, item.unit)}/${formatQty(item.par, item.unit)}`,
        )
        .join(", "),
      branch: displayBranch(branch),
      time: "Live",
      action: "Generate PO",
      to: "/purchase-orders",
      category: "Inventory",
    });
  } else if (lowStock.length > 0) {
    actions.push({
      id: "low-stock",
      sev: "warning",
      title: `${lowStock.length} item${lowStock.length === 1 ? " is" : "s are"} below PAR`,
      detail: lowStock
        .slice(0, 4)
        .map((item) => item.name)
        .join(", "),
      branch: displayBranch(branch),
      time: "Live",
      action: "Review stock",
      to: "/par",
      category: "Inventory",
    });
  }

  if (lateKitchenOrders.length > 0) {
    const oldest = Math.max(
      ...lateKitchenOrders.map((order) =>
        Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 60_000)),
      ),
    );
    actions.push({
      id: "late-kitchen",
      sev: oldest >= 30 ? "critical" : "warning",
      title: `${lateKitchenOrders.length} kitchen order${lateKitchenOrders.length === 1 ? "" : "s"} above target time`,
      detail: `Oldest active production order is ${oldest} min. Review station queues before more orders become late.`,
      branch: displayBranch(branch),
      time: "Live",
      action: "Open KDS",
      to: "/kitchen",
      category: "Kitchen",
    });
  }

  if (drawersNeedingAttention.length > 0) {
    const variance = drawersNeedingAttention.reduce(
      (sum, drawer) => sum + Math.abs(drawer.variance ?? 0),
      0,
    );
    actions.push({
      id: "cash-variance",
      sev: "critical",
      title: `${drawersNeedingAttention.length} till variance${drawersNeedingAttention.length === 1 ? "" : "s"} require review`,
      detail:
        variance > 0
          ? `Unresolved cash variance: ${ksh(variance)}.`
          : "Cash close-out is awaiting supervisor review.",
      branch: displayBranch(branch),
      time: "Live",
      action: "Review reconciliation",
      to: "/reconciliation",
      category: "Cash",
    });
  }

  if (pendingReconciliation.length > 0) {
    actions.push({
      id: "payment-reconciliation",
      sev: pendingReconciliation.length >= 5 ? "warning" : "info",
      title: `${pendingReconciliation.length} payment${pendingReconciliation.length === 1 ? "" : "s"} need reconciliation`,
      detail: "Configured payment methods should be matched before shift close.",
      branch: displayBranch(branch),
      time: "Live",
      action: "Reconcile",
      to: "/reconciliation",
      category: "Payments",
    });
  }

  if (requestedRefunds.length > 0) {
    actions.push({
      id: "refund-approval",
      sev: "warning",
      title: `${requestedRefunds.length} refund request${requestedRefunds.length === 1 ? "" : "s"} awaiting approval`,
      detail: `Value: ${ksh(requestedRefunds.reduce((sum, refund) => sum + refund.amount, 0))}.`,
      branch: displayBranch(branch),
      time: "Live",
      action: "Review refunds",
      to: "/refunds",
      category: "Refunds",
    });
  }

  if (peopleExceptions.length > 0) {
    actions.push({
      id: "people-exceptions",
      sev: "warning",
      title: `${peopleExceptions.length} attendance exception${peopleExceptions.length === 1 ? "" : "s"} today`,
      detail: peopleExceptions
        .slice(0, 4)
        .map((employee) => `${employee.name} - ${employee.status}`)
        .join(", "),
      branch: displayBranch(branch),
      time: "Live",
      action: "Open attendance",
      to: "/attendance",
      category: "People",
    });
  }

  if (hardwareExceptions.length > 0) {
    actions.push({
      id: "hardware-exceptions",
      sev: hardwareExceptions.some((printer) => printer.connection === "Offline")
        ? "critical"
        : "warning",
      title: `${hardwareExceptions.length} printer${hardwareExceptions.length === 1 ? "" : "s"} need attention`,
      detail: hardwareExceptions
        .slice(0, 3)
        .map((printer) => `${printer.name} - ${printer.connection}`)
        .join(", "),
      branch: displayBranch(branch),
      time: "Live",
      action: "Open printers",
      to: "/seramet-printers",
      category: "Hardware",
    });
  }

  if (unavailableMenu.length > 0) {
    actions.push({
      id: "menu-unavailable",
      sev: "info",
      title: `${unavailableMenu.length} menu item${unavailableMenu.length === 1 ? " is" : "s are"} unavailable`,
      detail: unavailableMenu
        .slice(0, 4)
        .map((product) => product.name)
        .join(", "),
      branch: displayBranch(branch),
      time: "Live",
      action: "Review menu",
      to: "/menu-import",
      category: "Menu",
    });
  }

  const signals: HealthSignal[] = [
    { name: "Sales", state: openOrders.length > 0 ? "Healthy" : "Attention" },
    {
      name: "Inventory",
      state: criticalStock.length > 0 ? "Warning" : lowStock.length > 0 ? "Attention" : "Healthy",
    },
    {
      name: "Cash",
      state:
        drawersNeedingAttention.length > 0
          ? "Warning"
          : pendingReconciliation.length > 0
            ? "Attention"
            : "Healthy",
    },
    {
      name: "Labour",
      state:
        peopleExceptions.length > 1
          ? "Warning"
          : peopleExceptions.length > 0
            ? "Attention"
            : "Healthy",
    },
    { name: "Customers", state: requestedRefunds.length > 0 ? "Attention" : "Healthy" },
    {
      name: "Kitchen",
      state:
        lateKitchenOrders.length > 0
          ? "Warning"
          : hardwareExceptions.length > 0
            ? "Attention"
            : "Healthy",
    },
  ];

  const penalty = signals.reduce(
    (sum, signal) => sum + (signal.state === "Warning" ? 12 : signal.state === "Attention" ? 6 : 0),
    0,
  );
  const score = Math.max(0, 100 - penalty);
  const label: BranchOperationsSummary["label"] =
    score >= 80 ? "Healthy" : score >= 60 ? "Attention" : "Critical";

  const readinessChecks = buildReadinessChecks(
    branch,
    hardwareProfiles,
    criticalStock.length,
    peopleExceptions.length,
    unavailableMenu.length,
    state,
  );
  const readinessScore = Math.round(
    (readinessChecks.filter((check) => check.ok).length / Math.max(1, readinessChecks.length)) *
      100,
  );

  return {
    score,
    label,
    signals,
    actions: actions.sort((a, b) => severityRank(a.sev) - severityRank(b.sev)).slice(0, 8),
    openOrders: openOrders.length,
    lateKitchenTickets: lateKitchenOrders.length,
    lowStockItems: lowStock.length,
    unreadablePayments: pendingReconciliation.length,
    readiness: { score: readinessScore, checks: readinessChecks },
  };
}

function buildReadinessChecks(
  branch: string,
  profiles: BranchHardwareProfile[],
  criticalStockCount: number,
  peopleExceptionCount: number,
  unavailableMenuCount: number,
  state: TransactionState,
) {
  const branchDrawers = state.cashDrawers.filter((drawer) => branchMatches(drawer.branch, branch));
  const printers = profiles.flatMap((profile) => profile.printers);
  const connectedPrinter = printers.some((printer) => printer.connection !== "Offline");
  const openDrawer = branchDrawers.some((drawer) => drawer.status === "OPEN");
  return [
    {
      label: "Cash drawer",
      ok: openDrawer,
      detail: openDrawer ? "Opening cash is active." : "No open cash drawer detected.",
      to: "/reconciliation",
    },
    {
      label: "Production hardware",
      ok: connectedPrinter,
      detail: connectedPrinter
        ? "At least one production/front printer is available."
        : "No available printer route detected.",
      to: "/seramet-printers",
    },
    {
      label: "Critical stock",
      ok: criticalStockCount === 0,
      detail:
        criticalStockCount === 0
          ? "No critical PAR exceptions."
          : `${criticalStockCount} critical stock exception${criticalStockCount === 1 ? "" : "s"}.`,
      to: "/par",
    },
    {
      label: "Staff coverage",
      ok: peopleExceptionCount === 0,
      detail:
        peopleExceptionCount === 0
          ? "No lateness/absence exception in the current branch view."
          : `${peopleExceptionCount} attendance exception${peopleExceptionCount === 1 ? "" : "s"}.`,
      to: "/attendance",
    },
    {
      label: "Menu availability",
      ok: unavailableMenuCount === 0,
      detail:
        unavailableMenuCount === 0
          ? "No menu availability exception."
          : `${unavailableMenuCount} item${unavailableMenuCount === 1 ? "" : "s"} unavailable.`,
      to: "/menu-import",
    },
  ];
}

function profilesForBranch(branch: string) {
  if (isAllBranchScope(branch)) {
    return getConfigurationRepository()
      .snapshot()
      .branches.filter((configuredBranch) => configuredBranch.active)
      .flatMap((configuredBranch) => {
        try {
          return [
            SerametPrintService.getBranchHardwareProfile(
              configuredBranch.id,
              configuredBranch.tenantId,
            ),
          ];
        } catch {
          return [];
        }
      });
  }
  try {
    return [SerametPrintService.getBranchHardwareProfile(branch)];
  } catch {
    return [];
  }
}

function displayBranch(branch: string) {
  return isAllBranchScope(branch) ? "All" : branch;
}

function severityRank(severity: OperationsSeverity) {
  return severity === "critical" ? 0 : severity === "warning" ? 1 : 2;
}

function formatQty(value: number, unit: string) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
}

export function connectionNeedsAttention(connection: PrinterConnection) {
  return connection !== "Connected";
}
