import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock,
  FileText,
  Flame,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Wifi,
  WifiOff,
  RefreshCcw,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Status } from "@/components/app/ui";
import { activeLocale, ksh } from "@/lib/currency";
import { useOperationalMenu } from "@/hooks/use-operational-menu";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import {
  nextTransactionRecordId,
  TransactionEngine,
  type OrderDraft,
} from "@/lib/transaction-engine";
import { paymentOrchestrator } from "@/payments/payment-orchestrator";
import { formatMinor, majorFromMinor, parseMajorAmount } from "@/payments/money";
import type { AcceptedCurrency, FxPaymentQuote } from "@/onboarding/location-currency-types";
import { getSerametAccessToken } from "@/lib/access-token";
import type { OrderForPrint } from "@/lib/seramet-print-service";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/pos")({
  head: () => ({
    meta: [
      { title: "Seramet POS - Fast counter & table service" },
      {
        name: "description",
        content: "Touch-optimised point of sale for dine-in, take away and delivery orders.",
      },
      { property: "og:title", content: "Seramet POS" },
      { property: "og:description", content: "Touch-optimised point of sale built for speed." },
    ],
  }),
  component: POS,
});

const productFallbackTones = [
  "bg-accent/60 text-primary",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-danger-soft text-danger",
  "bg-secondary text-foreground",
];

const tableStateStyle: Record<string, string> = {
  Available: "border-border bg-card",
  Occupied: "border-primary/40 bg-accent/50",
  Reserved: "border-info/30 bg-info-soft",
  "Needs Cleaning": "border-warning/30 bg-warning-soft",
  Unavailable: "border-border bg-secondary opacity-60",
};

function productFallbackTone(category: string) {
  const index =
    Math.abs(category.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) %
    productFallbackTones.length;
  return productFallbackTones[index];
}

function productInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function productImageSource(product: { imageUrl?: string }) {
  return product.imageUrl?.trim() ?? "";
}

function configuredChargeMinor(
  basisMinor: number,
  rule: { rate_bps: number; calculation_mode: "INCLUSIVE" | "EXCLUSIVE" },
) {
  const numerator = BigInt(basisMinor) * BigInt(rule.rate_bps);
  const denominator = BigInt(
    rule.calculation_mode === "INCLUSIVE" ? 10_000 + rule.rate_bps : 10_000,
  );
  return Number((numerator + denominator / 2n) / denominator);
}

function friendlyPosError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/no active payment methods/i.test(message)) {
    return "No usable payment method is configured for this branch. Review Payment Control settings.";
  }
  if (/open a cash drawer/i.test(message)) {
    return "Cash is unavailable until a cashier opens a drawer in Payment Control.";
  }
  if (/requires a reference/i.test(message)) {
    return message.replace(/requires a reference/i, "requires a transaction reference");
  }
  if (/must be sent to kitchen/i.test(message)) {
    return "Send the current order version to kitchen before opening payment.";
  }
  if (/printer|printing|KOT|kitchen ticket/i.test(message)) {
    return message;
  }
  return message;
}

function POS() {
  const navigate = useNavigate();
  const { activeTenantId, branch, branchId, currentUser, platformState, role } = useAppContext();
  const tenant = platformState.tenants.find((item) => item.id === activeTenantId)!;
  const branchRecord = platformState.branches.find((item) => item.id === branchId)!;
  const orderChannels = useMemo(
    () =>
      platformState.orderChannels
        .filter((channel) => channel.tenantId === activeTenantId && channel.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [activeTenantId, platformState.orderChannels],
  );
  const paymentMethods = useMemo(
    () =>
      platformState.paymentMethods
        .filter((method) => method.tenantId === activeTenantId && method.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [activeTenantId, platformState.paymentMethods],
  );
  const operationalMenu = useOperationalMenu({
    tenantId: activeTenantId,
    branchId,
    userId: currentUser.id,
    userName: currentUser.name,
    role,
  });
  const [cat, setCat] = useState("All items");
  const [searchQuery, setSearchQuery] = useState("");
  const [clockNow, setClockNow] = useState(() => new Date());
  const [orderSource, setOrderSource] = useState(() => orderChannels[0]?.id ?? "");
  const [lines, setLines] = useState<Record<string, number>>({});
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(() => paymentMethods[0]?.id ?? "");
  const [paymentMode, setPaymentMode] = useState<"full" | "split" | "partial">("full");
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitMethodId, setSplitMethodId] = useState("");
  const [splitAmount, setSplitAmount] = useState("");
  const [splitReference, setSplitReference] = useState("");
  const [splitCashReceived, setSplitCashReceived] = useState("");
  const [tendered, setTendered] = useState(0);
  const [cashReceived, setCashReceived] = useState(0);
  const [tenderCurrency, setTenderCurrency] = useState(tenant.defaultCurrency);
  const [acceptedCurrencies, setAcceptedCurrencies] = useState<AcceptedCurrency[]>([]);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const paymentSubmitRef = useRef(false);
  const [payments, setPayments] = useState<
    {
      id: string;
      methodId: string;
      method: string;
      amount: number;
      amountMinor: number;
      reference?: string;
      tenderCurrency: string;
      tenderAmountMinor: number;
      cashTenderedMinor: number;
      fxQuote?: FxPaymentQuote;
      status?: "draft" | "recorded" | "pending";
    }[]
  >([]);
  const [paymentReference, setPaymentReference] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [receiptOptions, setReceiptOptions] = useState<Record<string, boolean>>({
    Print: true,
    WhatsApp: false,
    Email: false,
  });
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [existingPaid, setExistingPaid] = useState(0);
  const [printNotice, setPrintNotice] = useState("Print routing is running in the background.");
  const [printNoticeType, setPrintNoticeType] = useState<"idle" | "success" | "warning">("idle");
  const [kitchenNote, setKitchenNote] = useState("");
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrdersOpen, setActiveOrdersOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tablePickerIntent, setTablePickerIntent] = useState<"select" | "send">("select");
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedTableNo, setSelectedTableNo] = useState<string | null>(null);
  const {
    state: transactionState,
    mutate: mutateTransaction,
    syncFromBackend,
    backendStatus,
    pendingSyncCount,
  } = useTransactionEngine();
  const {
    profile,
    configurationError,
    jobs: printJobs,
    sendKitchenTickets,
    printCustomerDocument,
  } = useSerametPrintQueue(branchId);

  const selectedChannel =
    orderChannels.find((channel) => channel.id === orderSource) ?? orderChannels[0];
  const selectedPaymentMethod =
    paymentMethods.find((method) => method.id === paymentMethod) ?? paymentMethods[0];
  const splitPaymentMethod = paymentMethods.find((method) => method.id === splitMethodId);
  const paymentCurrencies = useMemo(() => {
    const configured = acceptedCurrencies.length
      ? acceptedCurrencies
      : [
          {
            code: tenant.defaultCurrency,
            name: tenant.defaultCurrency,
            symbol: tenant.defaultCurrency,
            minorDigits: 2,
            isBase: true,
            status: "ACTIVE" as const,
            paymentEligible: true,
            cashEligible: true,
            digitalPaymentEligible: true,
            exchangeRatePolicy: "LEGAL_ENTITY" as const,
            rateFreshnessMinutes: 1_440,
            roundingPolicy: "HALF_UP" as const,
            changePolicy: "TENDER_CURRENCY" as const,
            branchIds: [],
            paymentMethodIds: [],
          },
        ];
    return configured.filter((currency) => {
      if (currency.isBase) return true;
      if (selectedPaymentMethod?.category !== "CASH" || !currency.cashEligible) return false;
      if (currency.branchIds.length && !currency.branchIds.includes(branchId)) return false;
      return (
        !currency.paymentMethodIds.length ||
        (selectedPaymentMethod && currency.paymentMethodIds.includes(selectedPaymentMethod.id))
      );
    });
  }, [acceptedCurrencies, branchId, selectedPaymentMethod, tenant.defaultCurrency]);
  const isOnlineSource =
    selectedChannel?.channelType === "MARKETPLACE" || selectedChannel?.channelType === "WEB";
  const channelUsesOnlinePrice = selectedChannel?.metadata["useOnlinePrice"] === true;
  const terminalId = `${branchRecord.code}-POS-01`;
  const branchServiceAreas = useMemo(
    () =>
      platformState.serviceAreas.filter(
        (area) => area.tenantId === activeTenantId && area.branchId === branchId && area.active,
      ),
    [activeTenantId, branchId, platformState.serviceAreas],
  );
  const billedOrderIds = useMemo(
    () => new Set(transactionState.bills.flatMap((bill) => bill.orderIds)),
    [transactionState.bills],
  );
  const activePosOrders = useMemo(
    () =>
      transactionState.orders
        .filter(
          (order) =>
            (order.tenantId ?? activeTenantId) === activeTenantId &&
            (order.branchId ?? branchId) === branchId,
        )
        .filter((order) =>
          ["HELD", "OPEN", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(
            order.status,
          ),
        )
        .filter((order) => !billedOrderIds.has(order.id)),
    [activeTenantId, billedOrderIds, branchId, transactionState.orders],
  );
  const activeOrder = activePosOrders.find((order) => order.id === activeOrderId) ?? null;
  const canPrintBill =
    activeOrder !== null &&
    ["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(activeOrder.status);
  const paymentContextOrder =
    transactionState.orders.find(
      (order) => order.id === (paymentOrderId ?? activeOrderId ?? ""),
    ) ?? activeOrder;
  const openCashDrawer =
    transactionState.paymentOperations?.drawerSessions.find(
      (drawer) =>
        drawer.tenantId === activeTenantId &&
        drawer.branchId === branchId &&
        drawer.status === "OPEN",
    ) ??
    transactionState.cashDrawers.find(
      (drawer) =>
        (drawer.tenantId ?? activeTenantId) === activeTenantId &&
        (drawer.branchId ?? branchId) === branchId &&
        drawer.status === "OPEN",
    );
  const paymentMethodIssue = (method: (typeof paymentMethods)[number]) => {
    if (method.category === "CASH" && !openCashDrawer) {
      return "Open a cash drawer in Payment Control";
    }
    if (method.metadata["providerOperation"] && backendStatus !== "synced") {
      return "Online connection required";
    }
    if (method.providerConnectionId) {
      const connection = platformState.connections.find(
        (candidate) =>
          candidate.id === method.providerConnectionId &&
          candidate.tenantId === activeTenantId &&
          (!candidate.branchId || candidate.branchId === branchId),
      );
      if (!connection) return "Provider connection not configured";
      if (!["ACTIVE", "SANDBOX", "CONFIGURED"].includes(connection.status)) {
        return `Provider is ${connection.status.toLowerCase().replaceAll("_", " ")}`;
      }
    }
    if (method.category === "CREDIT") {
      if (!paymentContextOrder?.customerId) return "Verified customer required";
      if (
        !method.receivableAccountId ||
        typeof method.metadata["revenueAccountId"] !== "string"
      ) {
        return "Receivable and revenue account mapping required";
      }
    }
    return null;
  };
  const usablePaymentMethods = paymentMethods.filter((method) => !paymentMethodIssue(method));
  const unavailablePaymentMethods = paymentMethods
    .map((method) => ({ method, issue: paymentMethodIssue(method) }))
    .filter(
      (entry): entry is { method: (typeof paymentMethods)[number]; issue: string } =>
        Boolean(entry.issue),
    );

  useEffect(() => {
    if (!paymentOpen) return;
    if (usablePaymentMethods.some((method) => method.id === paymentMethod)) return;
    setPaymentMethod(usablePaymentMethods[0]?.id ?? "");
  }, [paymentMethod, paymentOpen, usablePaymentMethods]);

  useEffect(() => {
    if (!splitOpen) return;
    if (usablePaymentMethods.some((method) => method.id === splitMethodId)) return;
    setSplitMethodId(usablePaymentMethods[0]?.id ?? "");
  }, [splitMethodId, splitOpen, usablePaymentMethods]);
  const branchMenu = useMemo(
    () =>
      operationalMenu.items
        .filter((product) => product.branchAvailability?.[branch] !== false)
        .map((product) => {
          const branchPrice = product.branchPrices?.[branch] ?? product.price;
          const availability = TransactionEngine.getProductAvailability(
            transactionState,
            branchId,
            product.id,
          );
          const onlinePriceAllowedForItem =
            channelUsesOnlinePrice &&
            product.onlinePrice !== undefined &&
            (!product.onlinePriceChannelCodes?.length ||
              (selectedChannel &&
                product.onlinePriceChannelCodes.some(
                  (code) => code === selectedChannel.code || code === selectedChannel.id,
                )));
          const price = onlinePriceAllowedForItem ? product.onlinePrice! : branchPrice;
          return {
            ...product,
            price,
            priceMinor: parseMajorAmount(price, tenant.defaultCurrency),
            currency: tenant.defaultCurrency,
            out: product.out === true || !availability.available,
            availabilityPortions: availability.portions,
          };
        }),
    [
      branch,
      branchId,
      channelUsesOnlinePrice,
      isOnlineSource,
      operationalMenu.items,
      selectedChannel,
      tenant.defaultCurrency,
      transactionState,
    ],
  );
  const floorTables = useMemo(() => {
    const serviceAreaNames = new Map(branchServiceAreas.map((area) => [area.id, area.name]));
    return platformState.tables
      .filter(
        (table) => table.tenantId === activeTenantId && table.branchId === branchId && table.active,
      )
      .map((table) => {
        const activeTableOrder = activePosOrders.find((order) => order.table === table.code);
        return {
          no: table.code,
          orderId: activeTableOrder?.id,
          seats: table.seats,
          area: table.serviceAreaId
            ? (serviceAreaNames.get(table.serviceAreaId) ?? "Dining")
            : "Dining",
          state: activeTableOrder ? "Occupied" : "Available",
          guests: Number(activeTableOrder?.customer.match(/(\d+)\s+guest/i)?.[1] ?? 0),
          amount: activeTableOrder?.total,
        };
      });
  }, [activePosOrders, activeTenantId, branchId, branchServiceAreas, platformState.tables]);

  const posCategories = useMemo(() => {
    const importedCategories = Array.from(new Set(branchMenu.map((product) => product.category)));
    return ["All items", ...importedCategories];
  }, [branchMenu]);

  useEffect(() => {
    if (!posCategories.includes(cat)) setCat("All items");
  }, [cat, posCategories]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!configurationError) return;
    setPrintNotice(`Printing unavailable: ${configurationError}`);
    setPrintNoticeType("warning");
  }, [configurationError]);

  useEffect(() => {
    const latestKitchenJob = printJobs.find((job) =>
      ["FOOD_KOT", "BAR_TICKET", "KDS_TICKET", "DISPATCH_TICKET"].includes(job.documentType),
    );
    if (!latestKitchenJob) return;
    if (latestKitchenJob.status === "Failed") {
      setPrintNotice(
        `Kitchen ticket failed: ${latestKitchenJob.failureReason ?? "printer did not accept the job"}`,
      );
      setPrintNoticeType("warning");
      return;
    }
    if (["Printed", "Displayed", "Fallback Printed"].includes(latestKitchenJob.status)) {
      setPrintNotice(
        latestKitchenJob.amendmentType && latestKitchenJob.amendmentType !== "NEW"
          ? `Kitchen ${latestKitchenJob.amendmentType.toLowerCase()} confirmed by print routing.`
          : "Kitchen ticket confirmed by print routing.",
      );
      setPrintNoticeType("success");
      return;
    }
    if (["Queued", "Sending", "Retrying"].includes(latestKitchenJob.status)) {
      setPrintNotice(`Kitchen ticket ${latestKitchenJob.status.toLowerCase()} - awaiting confirmation.`);
      setPrintNoticeType("idle");
    }
  }, [printJobs]);

  useEffect(() => {
    if (!selectedChannel && orderChannels[0]) setOrderSource(orderChannels[0].id);
  }, [orderChannels, selectedChannel]);

  useEffect(() => {
    if (!paymentMethods.length) {
      if (paymentMethod) setPaymentMethod("");
      return;
    }
    if (!paymentMethods.some((method) => method.id === paymentMethod)) {
      setPaymentMethod(paymentMethods[0]!.id);
    }
  }, [paymentMethod, paymentMethods]);

  useEffect(() => {
    if (!splitOpen || !paymentMethods.length) return;
    if (!paymentMethods.some((method) => method.id === splitMethodId)) {
      setSplitMethodId(paymentMethods[0]!.id);
    }
  }, [paymentMethods, splitMethodId, splitOpen]);

  useEffect(() => {
    const token = getSerametAccessToken();
    void fetch("/api/seramet/setup/payment-currencies", {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "x-seramet-user-id": currentUser.id,
        "x-seramet-tenant-id": activeTenantId,
        "x-seramet-branch-id": branchId,
        "x-seramet-user": currentUser.name,
        "x-seramet-role": role,
      },
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          currencies?: AcceptedCurrency[];
        };
        if (response.ok && body.currencies?.length) setAcceptedCurrencies(body.currencies);
      })
      .catch(() => undefined);
  }, [activeTenantId, branchId, currentUser.id, currentUser.name, role]);

  useEffect(() => {
    setTenderCurrency(tenant.defaultCurrency);
  }, [tenant.defaultCurrency]);

  useEffect(() => {
    if (!paymentCurrencies.some((currency) => currency.code === tenderCurrency)) {
      setTenderCurrency(tenant.defaultCurrency);
      setCashReceived(0);
    }
  }, [paymentCurrencies, tenderCurrency, tenant.defaultCurrency]);

  useEffect(() => {
    if (!activeOrder) return;
    const channel = orderChannels.find(
      (item) =>
        item.id === activeOrder.channel ||
        item.code === activeOrder.channel ||
        item.displayName === activeOrder.channel,
    );
    if (channel) setOrderSource(channel.id);
    setKitchenNote(activeOrder.kitchenNote ?? "");
    setLines(
      activeOrder.lines.reduce<Record<string, number>>((quantities, line) => {
        if (!line.productId || line.productionStatus === "CANCELLED") return quantities;
        quantities[line.productId] = (quantities[line.productId] ?? 0) + line.quantity;
        return quantities;
      }, {}),
    );
    setItemNotes(
      Object.fromEntries(
        activeOrder.lines
          .filter((line) => line.productId && line.itemNote)
          .map((line) => [line.productId!, line.itemNote!]),
      ),
    );
    setPrintNotice(`${activeOrder.id} loaded. Print routing is running in the background.`);
    setPrintNoticeType("idle");
  }, [activeOrder, orderChannels]);

  const sentQuantities = useMemo(
    () =>
      activeOrder?.lines.reduce<Record<string, number>>((quantities, line) => {
        if (!line.productId || !line.sentAt || line.productionStatus === "CANCELLED") {
          return quantities;
        }
        quantities[line.productId] = (quantities[line.productId] ?? 0) + line.quantity;
        return quantities;
      }, {}) ?? {},
    [activeOrder],
  );

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visible = branchMenu.filter((product) => {
    const categoryMatch = cat === "All items" || product.category === cat;
    if (!categoryMatch) return false;
    if (!normalizedSearch) return true;
    return [product.name, product.category, product.itemCode, product.sku]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  });
  const items = Object.entries(lines)
    .map(([id, qty]) => ({ p: branchMenu.find((x) => x.id === id)!, qty }))
    .filter((l) => l.p && l.qty > 0);
  const subtotalMinor = items.reduce((sum, line) => sum + (line.p.priceMinor ?? 0) * line.qty, 0);
  const pricingRules = new Map(operationalMenu.pricingRules.map((rule) => [rule.id, rule]));
  const taxTotals = items.reduce(
    (totals, line) => {
      const rule = line.p.taxRuleId ? pricingRules.get(line.p.taxRuleId) : undefined;
      if (!rule || rule.rule_type !== "TAX") return totals;
      const amount = configuredChargeMinor((line.p.priceMinor ?? 0) * line.qty, rule);
      totals.reported += amount;
      if (rule.calculation_mode === "EXCLUSIVE") totals.added += amount;
      return totals;
    },
    { reported: 0, added: 0 },
  );
  const serviceBasisMinor = items.reduce(
    (sum, line) =>
      line.p.serviceChargeApplicable ? sum + (line.p.priceMinor ?? 0) * line.qty : sum,
    0,
  );
  const serviceTotals = operationalMenu.pricingRules
    .filter((rule) => rule.rule_type === "SERVICE_CHARGE")
    .reduce(
      (totals, rule) => {
        const amount = configuredChargeMinor(serviceBasisMinor, rule);
        totals.reported += amount;
        if (rule.calculation_mode === "EXCLUSIVE") totals.added += amount;
        return totals;
      },
      { reported: 0, added: 0 },
    );
  const subtotal = majorFromMinor(subtotalMinor, tenant.defaultCurrency);
  const tax = majorFromMinor(taxTotals.reported + serviceTotals.reported, tenant.defaultCurrency);
  const totalMinor = subtotalMinor + taxTotals.added + serviceTotals.added;
  const total = majorFromMinor(totalMinor, tenant.defaultCurrency);
  const existingPaidMinor = parseMajorAmount(existingPaid, tenant.defaultCurrency);
  const recordedSessionPaidMinor = payments
    .filter((payment) => payment.status === "recorded")
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const pendingAllocatedMinor = payments
    .filter(
      (payment) => payment.status === "pending" || payment.status === "draft" || !payment.status,
    )
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const paidMinor = existingPaidMinor + recordedSessionPaidMinor;
  const coveredMinor = paidMinor + pendingAllocatedMinor;
  const dueMinor = Math.max(0, totalMinor - coveredMinor);
  const changeMinor = Math.max(0, coveredMinor - totalMinor);
  const paid = majorFromMinor(paidMinor, tenant.defaultCurrency);
  const pendingAllocated = majorFromMinor(pendingAllocatedMinor, tenant.defaultCurrency);
  const covered = majorFromMinor(coveredMinor, tenant.defaultCurrency);
  const due = majorFromMinor(dueMinor, tenant.defaultCurrency);
  const change = majorFromMinor(changeMinor, tenant.defaultCurrency);
  const suggestedAmount = due;
  const predictedNextOrderId = () => nextTransactionRecordId("ORD", transactionState.orders);
  const predictedNextInvoiceId = () => nextTransactionRecordId("INV", transactionState.bills);
  const predictedNextReceiptId = () => nextTransactionRecordId("RCP", transactionState.receipts);
  const currentOrderNumber = activeOrder?.id ?? predictedNextOrderId();
  const orderTable = activeOrder?.table ?? selectedTableNo ?? undefined;
  const currentTime = new Intl.DateTimeFormat(activeLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tenant.timezone,
  }).format(clockNow);
  const businessDateParts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tenant.timezone,
  }).formatToParts(clockNow);
  const businessDate = ["year", "month", "day"]
    .map((part) => businessDateParts.find((value) => value.type === part)?.value ?? "")
    .join("-");
  const operatorEmployee = transactionState.employees.find(
    (employee) =>
      (employee.tenantId ?? activeTenantId) === activeTenantId &&
      (employee.branchId ?? branchId) === branchId &&
      employee.name.trim().toLowerCase() === currentUser.name.trim().toLowerCase(),
  );
  const operatorAttendance = transactionState.attendanceRecords.find(
    (attendance) =>
      (attendance.tenantId ?? activeTenantId) === activeTenantId &&
      (attendance.branchId ?? branchId) === branchId &&
      attendance.date === businessDate &&
      (attendance.employeeId === operatorEmployee?.id ||
        attendance.employeeName.trim().toLowerCase() === currentUser.name.trim().toLowerCase()),
  );
  const operatorAttendanceLabel =
    operatorAttendance?.status.replaceAll("_", " ") ?? "Not clocked in";
  const posStateLabel = paymentOpen
    ? "Paying"
    : activeOrder?.status === "HELD"
      ? "Held"
      : activeOrder?.status === "READY"
        ? "Ready"
        : activeOrder?.status === "SERVED"
          ? "Served"
          : activeOrder &&
              ["SENT_TO_KITCHEN", "IN_PROGRESS"].includes(activeOrder.status)
            ? "Kitchen"
            : activeOrder
              ? "Open"
              : "New";
  const orderContextLabel = activeOrder
    ? `${activeOrder.status.replaceAll("_", " ")} - ${activeOrder.customer}`
    : isOnlineSource
      ? `${selectedChannel?.displayName ?? "Online"} channel order`
      : selectedChannel?.channelType === "TAKEAWAY"
        ? "Take away order"
        : selectedTableNo
          ? `Table ${selectedTableNo} selected`
          : "Select table when sending to kitchen";

  const buildPrintOrder = (tableNo = orderTable): OrderForPrint => ({
    orderId: currentOrderNumber,
    branch,
    terminalId,
    ...(tableNo ? { table: tableNo } : {}),
    orderType: selectedChannel?.displayName ?? "Configured channel",
    requestedBy: currentUser.name,
    cashier: currentUser.name,
    waiter: currentUser.name,
    createdAt: activeOrder?.createdAt ?? new Date().toISOString(),
    customer: isOnlineSource
      ? (selectedChannel?.displayName ?? "Online customer")
      : tableNo
        ? `Table ${tableNo}`
        : "Walk-in Customer",
    ...(kitchenNote.trim() ? { kitchenNote: kitchenNote.trim() } : {}),
    ...(profile?.printIdentity.tillNumber ? { tillNumber: profile.printIdentity.tillNumber } : {}),
    receiptNumber: predictedNextReceiptId(),
    invoiceNumber: predictedNextInvoiceId(),
    lines: items.map((line) => ({
      id: line.p.id,
      name: line.p.name,
      category: line.p.category,
      quantity: line.qty,
      unitPrice: line.p.price,
      productionStation: line.p.productionStation ?? "NONE",
      ...(itemNotes[line.p.id]?.trim() ? { itemNote: itemNotes[line.p.id]!.trim() } : {}),
    })),
    subtotal,
    tax,
    total,
    paid,
    change,
    paymentMethod:
      payments.map((payment) => payment.method).join(" + ") ||
      selectedPaymentMethod?.displayName ||
      "Configured payment",
    paymentBreakdown: payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      ...(payment.reference ? { reference: payment.reference } : {}),
    })),
  });

  const buildTransactionDraft = (tableNo = orderTable): OrderDraft => {
    const draftLines = activeOrder
      ? [
          ...activeOrder.lines.filter((line) => line.sentAt).map((line) => ({ ...line })),
          ...items.flatMap((line) => {
            const sentQuantity = activeOrder.lines
              .filter(
                (candidate) =>
                  candidate.productId === line.p.id &&
                  candidate.sentAt &&
                  candidate.productionStatus !== "CANCELLED",
              )
              .reduce((sum, candidate) => sum + candidate.quantity, 0);
            if (line.qty < sentQuantity) {
              throw new Error(
                `${line.p.name} has already been sent to production. Use the authorized cancellation workflow to reduce it.`,
              );
            }
            const remainingQuantity = line.qty - sentQuantity;
            if (remainingQuantity === 0) return [];
            const existingUnsent = activeOrder.lines.find(
              (candidate) => candidate.productId === line.p.id && !candidate.sentAt,
            );
            return [
              {
                ...(existingUnsent ?? {}),
                id: existingUnsent?.id ?? `${line.p.id}-${crypto.randomUUID()}`,
                productId: line.p.id,
                name: line.p.name,
                category: line.p.category,
                quantity: remainingQuantity,
                unitPrice: line.p.price,
                productionStation: line.p.productionStation ?? "NONE",
                ...(itemNotes[line.p.id]?.trim() ? { itemNote: itemNotes[line.p.id]!.trim() } : {}),
              },
            ];
          }),
        ]
      : items.map((line) => ({
          id: `${line.p.id}-${crypto.randomUUID()}`,
          productId: line.p.id,
          name: line.p.name,
          category: line.p.category,
          quantity: line.qty,
          unitPrice: line.p.price,
          productionStation: line.p.productionStation ?? "NONE",
          ...(itemNotes[line.p.id]?.trim() ? { itemNote: itemNotes[line.p.id]!.trim() } : {}),
        }));

    return {
      tenantId: activeTenantId,
      branchId,
      branch,
      ...(tableNo ? { table: tableNo } : {}),
      customer: isOnlineSource
        ? (selectedChannel?.displayName ?? "Online customer")
        : selectedChannel?.channelType === "TAKEAWAY"
          ? "Walk-in"
          : tableNo
            ? `Table ${tableNo}`
            : "Unassigned table",
      channel: selectedChannel?.code ?? selectedChannel?.id ?? "UNCONFIGURED",
      cashier: currentUser.name,
      waiter: currentUser.name,
      ...(kitchenNote.trim() ? { kitchenNote: kitchenNote.trim() } : {}),
      financialOverride: { subtotal, tax, total },
      lines: draftLines,
    };
  };

  const buildKitchenAmendmentDraft = (tableNo = orderTable): OrderDraft => {
    if (!activeOrder) return buildTransactionDraft(tableNo);
    const draftLines = items.flatMap((line) => {
      let remaining = line.qty;
      const note = itemNotes[line.p.id]?.trim() ?? "";
      const existing = activeOrder.lines.filter(
        (candidate) =>
          candidate.productId === line.p.id && candidate.productionStatus !== "CANCELLED",
      );
      const desired = existing.flatMap((candidate) => {
        if (remaining <= 0) return [];
        const quantity = Math.min(candidate.quantity, remaining);
        remaining -= quantity;
        const { itemNote: _itemNote, ...base } = candidate;
        return [
          {
            ...base,
            quantity,
            ...(note ? { itemNote: note } : {}),
          },
        ];
      });
      if (remaining > 0) {
        desired.push({
          id: `${line.p.id}-${crypto.randomUUID()}`,
          productId: line.p.id,
          name: line.p.name,
          category: line.p.category,
          quantity: remaining,
          unitPrice: line.p.price,
          productionStation: line.p.productionStation ?? "NONE",
          ...(note ? { itemNote: note } : {}),
        });
      }
      return desired;
    });
    return {
      tenantId: activeTenantId,
      branchId,
      branch,
      ...(tableNo ? { table: tableNo } : {}),
      customer: isOnlineSource
        ? (selectedChannel?.displayName ?? "Online customer")
        : selectedChannel?.channelType === "TAKEAWAY"
          ? "Walk-in"
          : tableNo
            ? `Table ${tableNo}`
            : "Unassigned table",
      channel: selectedChannel?.code ?? selectedChannel?.id ?? "UNCONFIGURED",
      cashier: currentUser.name,
      waiter: currentUser.name,
      ...(kitchenNote.trim() ? { kitchenNote: kitchenNote.trim() } : {}),
      financialOverride: { subtotal, tax, total },
      lines: draftLines,
    };
  };

  const kitchenStarted = Boolean(
    activeOrder &&
      ["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(activeOrder.status),
  );
  const activeQuantities = activeOrder?.lines.reduce<Record<string, number>>((result, line) => {
    if (!line.productId || line.productionStatus === "CANCELLED") return result;
    result[line.productId] = (result[line.productId] ?? 0) + line.quantity;
    return result;
  }, {}) ?? {};
  const desiredProductIds = new Set([...Object.keys(activeQuantities), ...Object.keys(lines)]);
  const quantityChanged = [...desiredProductIds].some(
    (productId) => (lines[productId] ?? 0) !== (activeQuantities[productId] ?? 0),
  );
  const noteChanged = Boolean(
    activeOrder?.lines
      .filter((line) => line.productId && line.productionStatus !== "CANCELLED")
      .some((line) => (itemNotes[line.productId!] ?? "").trim() !== (line.itemNote ?? "").trim()),
  );
  const hasKitchenChanges =
    !activeOrder || !kitchenStarted
      ? items.length > 0
      : quantityChanged || noteChanged;
  const payMayAutoSendKitchen =
    selectedChannel?.channelType === "TAKEAWAY" ||
    selectedChannel?.channelType === "KIOSK" ||
    selectedChannel?.metadata["payBeforeKitchen"] === true;
  const kitchenRouteUnavailable = !profile || Boolean(configurationError);

  const bump = (id: string, d: number) =>
    setLines((current) => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + d),
    }));

  const clearCurrentOrder = (
    message = "Ready for the next POS order.",
    noticeType: "idle" | "success" | "warning" = "idle",
  ) => {
    setActiveOrderId(null);
    setLines({});
    setKitchenNote("");
    setItemNotes({});
    setPaymentReference("");
    setSelectedTableNo(null);
    setPrintNotice(message);
    setPrintNoticeType(noticeType);
  };

  const createOrUpdateActiveOrder = async (targetStatus: "HELD" | "OPEN", tableNo = orderTable) => {
    const knownOrderIds = new Set(transactionState.orders.map((order) => order.id));
    const draft = buildTransactionDraft(tableNo);
    const result = await mutateTransaction("upsertOrderDraft", {
      ...(activeOrder?.id ? { orderId: activeOrder.id } : {}),
      draft,
      targetStatus,
    });
    const order = activeOrder?.id
      ? result?.state.orders.find((candidate) => candidate.id === activeOrder.id)
      : result?.state.orders.find((candidate) => !knownOrderIds.has(candidate.id));
    if (!order) throw new Error("Server did not return the active order");
    return order.id;
  };

  const openPayment = async () => {
    if (!items.length || paymentBusy) return;
    if (selectedChannel?.requiresTable && !orderTable) {
      setTablePickerIntent("select");
      setTablePickerOpen(true);
      setPrintNotice("Select a table before taking payment for this dine-in order.");
      setPrintNoticeType("warning");
      return;
    }

    let orderId = activeOrder?.id;

    if (!activeOrder || !kitchenStarted || hasKitchenChanges) {
      if (!payMayAutoSendKitchen) {
        setPrintNotice(
          activeOrder && kitchenStarted
            ? "Send the kitchen update before taking payment."
            : "Send the dine-in order to kitchen before taking payment.",
        );
        setPrintNoticeType("warning");
        return;
      }
      setPaymentBusy(true);
      try {
        orderId = await queueKitchenTicketsForTable(orderTable, { retainOrder: true });
      } catch (error) {
        setPrintNotice(
          friendlyPosError(error, "The takeaway order could not be sent to kitchen before payment."),
        );
        setPrintNoticeType("warning");
        return;
      } finally {
        setPaymentBusy(false);
      }
      if (!orderId) {
        setPrintNotice(
          "Payment is blocked until the takeaway KOT is accepted by a configured printer or KDS route.",
        );
        setPrintNoticeType("warning");
        return;
      }
    }

    if (!orderId) {
      setPrintNotice("Select or create an order before taking payment.");
      setPrintNoticeType("warning");
      return;
    }

    const readyMethods = usablePaymentMethods;
    if (!readyMethods.length) {
      const reason = unavailablePaymentMethods[0]?.issue;
      setPrintNotice(
        reason
          ? `No payment method is currently usable: ${reason}.`
          : "No active payment methods are configured for this restaurant.",
      );
      setPrintNoticeType("warning");
      return;
    }
    const defaultMethod =
      (selectedChannel?.isExternallyPaid
        ? readyMethods.find((method) => method.category === "CREDIT")
        : readyMethods.find((method) => method.category === "DIGITAL_WALLET")) ??
      readyMethods[0];
    setPaymentMode("full");
    setPaymentMethod(defaultMethod?.id ?? "");
    setTendered(total);
    setCashReceived(total);
    setTenderCurrency(tenant.defaultCurrency);
    setPayments([]);
    setPaymentReference("");
    setPaymentConfirmed(false);
    setExistingPaid(0);
    setPaymentInvoiceId(null);
    setPaymentOrderId(null);
    setPaymentBusy(true);
    try {
      const prepared = await mutateTransaction("prepareInvoiceForPayment", {
        orderId,
      });
      const order = prepared?.state.orders.find((candidate) => candidate.id === orderId);
      const bill = prepared?.state.bills.find(
        (candidate) =>
          candidate.orderIds.includes(orderId) &&
          ["OPEN", "PARTIAL", "PENDING"].includes(candidate.status),
      );
      if (!order) throw new Error("The selected order is no longer available");
      if (!bill) throw new Error("The server could not prepare this bill for payment");
      if (
        (bill.tenantId ?? activeTenantId) !== activeTenantId ||
        (bill.branchId ?? branchId) !== branchId
      ) {
        throw new Error("The prepared invoice is outside the active restaurant branch");
      }
      setExistingPaid(bill.paid);
      setPaymentOrderId(orderId);
      setPaymentInvoiceId(bill.id);
      setPaymentOpen(true);
    } catch (error) {
      setPrintNotice(friendlyPosError(error, "Payment could not be prepared."));
      setPrintNoticeType("warning");
    } finally {
      setPaymentBusy(false);
    }
  };

  const addPayment = async () => {
    const requestedAmount =
      paymentMode === "partial" ? tendered : tendered || suggestedAmount;
    const amount = Math.min(due, Math.max(0, requestedAmount));
    if (!selectedPaymentMethod) return;
    if (!amount) {
      setPrintNotice(
        paymentMode === "partial"
          ? "Enter the exact partial-payment amount before adding it."
          : "Enter a payment amount greater than zero.",
      );
      setPrintNoticeType("warning");
      return;
    }
    const methodIssue = paymentMethodIssue(selectedPaymentMethod);
    if (methodIssue) {
      setPrintNotice(`${selectedPaymentMethod.displayName} is unavailable: ${methodIssue}.`);
      setPrintNoticeType("warning");
      return;
    }
    if (selectedPaymentMethod.requiresReference && !paymentReference.trim()) {
      setPrintNotice(`${selectedPaymentMethod.displayName} requires a transaction reference.`);
      setPrintNoticeType("warning");
      return;
    }
    const reference = paymentReference.trim().toUpperCase();
    const amountMinor = parseMajorAmount(amount, tenant.defaultCurrency);
    let quote: FxPaymentQuote | undefined;
    let tenderAmountMinor = amountMinor;
    let cashTenderedMinor =
      selectedPaymentMethod.category === "CASH"
        ? parseMajorAmount(Math.max(amount, cashReceived || amount), tenant.defaultCurrency)
        : amountMinor;
    if (tenderCurrency !== tenant.defaultCurrency) {
      if (backendStatus !== "synced" || !paymentInvoiceId) {
        setPrintNotice("Foreign-currency tender requires an online authoritative bill.");
        setPrintNoticeType("warning");
        return;
      }
      setPaymentBusy(true);
      try {
        const token = getSerametAccessToken();
        const response = await fetch("/api/seramet/setup/fx-quotes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "x-seramet-user-id": currentUser.id,
            "x-seramet-tenant-id": activeTenantId,
            "x-seramet-branch-id": branchId,
            "x-seramet-user": currentUser.name,
            "x-seramet-role": role,
          },
          body: JSON.stringify({
            branchId,
            invoiceId: paymentInvoiceId,
            paymentMethodId: selectedPaymentMethod.id,
            baseAmountMinor: amountMinor,
            tenderCurrency,
            idempotencyKey: `fx-quote:${crypto.randomUUID()}`,
          }),
        });
        const body = (await response.json()) as { quote?: FxPaymentQuote; message?: string };
        if (!response.ok || !body.quote) {
          throw new Error(body.message ?? "An authoritative FX quote is unavailable");
        }
        quote = body.quote;
        tenderAmountMinor = quote.tenderAmountMinor;
        cashTenderedMinor = cashReceived
          ? parseMajorAmount(cashReceived, quote.tenderCurrency)
          : quote.tenderAmountMinor;
        if (cashTenderedMinor < quote.tenderAmountMinor) {
          throw new Error("Cash received is below the quoted tender amount");
        }
      } catch (error) {
        setPrintNotice(error instanceof Error ? error.message : "FX quote could not be created.");
        setPrintNoticeType("warning");
        return;
      } finally {
        setPaymentBusy(false);
      }
    }
    setPayments((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        methodId: selectedPaymentMethod.id,
        method: selectedPaymentMethod.displayName,
        amount,
        tenderCurrency,
        tenderAmountMinor,
        cashTenderedMinor,
        status: "draft",
        ...(quote ? { fxQuote: quote } : {}),
        ...(reference ? { reference } : {}),
      },
    ]);
    setTendered(Math.max(0, due - amount));
    setCashReceived(Math.max(0, due - amount));
    setTenderCurrency(tenant.defaultCurrency);
    setPaymentReference("");
  };

  const removePayment = (id: string) => {
    setPayments((current) => current.filter((payment) => payment.id !== id));
    setPaymentConfirmed(false);
  };

  const addSplitPayment = () => {
    const method = usablePaymentMethods.find((candidate) => candidate.id === splitMethodId);
    const amount = Number(splitAmount);
    if (!method || !Number.isFinite(amount) || amount <= 0) {
      setPrintNotice("Choose an available payment method and enter a valid split amount.");
      setPrintNoticeType("warning");
      return;
    }
    if (amount > due) {
      setPrintNotice(`Split amount cannot exceed the remaining balance of ${ksh(due)}.`);
      setPrintNoticeType("warning");
      return;
    }
    const reference = splitReference.trim().toUpperCase();
    if (method.requiresReference && !reference) {
      setPrintNotice(`${method.displayName} requires a transaction reference.`);
      setPrintNoticeType("warning");
      return;
    }
    const cashAmount =
      method.category === "CASH" ? Number(splitCashReceived || splitAmount) : amount;
    if (method.category === "CASH" && (!Number.isFinite(cashAmount) || cashAmount < amount)) {
      setPrintNotice("Cash received must be at least the split amount.");
      setPrintNoticeType("warning");
      return;
    }
    const amountMinor = parseMajorAmount(amount, tenant.defaultCurrency);
    setPayments((current) => [
      ...current,
      {
        id: `split-${Date.now()}-${current.length}`,
        methodId: method.id,
        method: method.displayName,
        amount,
        tenderCurrency: tenant.defaultCurrency,
        tenderAmountMinor: amountMinor,
        cashTenderedMinor:
          method.category === "CASH"
            ? parseMajorAmount(cashAmount, tenant.defaultCurrency)
            : amountMinor,
        status: "draft",
        ...(reference ? { reference } : {}),
      },
    ]);
    setPaymentMode("split");
    setSplitOpen(false);
    setSplitAmount("");
    setSplitReference("");
    setSplitCashReceived("");
    setPrintNotice(`${method.displayName} split of ${ksh(amount)} added. ${ksh(due - amount)} remains.`);
    setPrintNoticeType("idle");
  };

  const holdOrder = async () => {
    if (!items.length) return;
    try {
      await createOrUpdateActiveOrder("HELD");
      clearCurrentOrder("Order held in active orders.");
    } catch (error) {
      setPrintNotice(error instanceof Error ? error.message : "The order could not be held.");
      setPrintNoticeType("warning");
    }
  };

  const queueKitchenTicketsForTable = async (
    tableNo = orderTable,
    options: { retainOrder?: boolean } = {},
  ): Promise<string | undefined> => {
    if (!items.length && !(activeOrder && kitchenStarted && hasKitchenChanges)) return undefined;
    if (!profile || configurationError) {
      setPrintNotice(
        `Kitchen send blocked: ${configurationError ?? "configure a kitchen printer or KDS route first"}.`,
      );
      setPrintNoticeType("warning");
      return undefined;
    }

    if (activeOrder && kitchenStarted) {
      if (!hasKitchenChanges) {
        setPrintNotice("This order is already up to date in the kitchen.");
        setPrintNoticeType("idle");
        return activeOrder.id;
      }
      const knownAmendmentIds = new Set(
        transactionState.productionAmendments.map((amendment) => amendment.id),
      );
      const resultState = await mutateTransaction(
        "amendKitchenOrder",
        {
          orderId: activeOrder.id,
          draft: buildKitchenAmendmentDraft(tableNo),
        },
        undefined,
        { kotPrinted: true },
      );
      const amendments =
        resultState?.state.productionAmendments.filter(
          (amendment) =>
            amendment.orderId === activeOrder.id && !knownAmendmentIds.has(amendment.id),
        ) ?? [];
      let routedJobs = 0;
      let failedJobs = 0;
      const skipped: string[] = [];
      for (const amendment of amendments) {
        const result = sendKitchenTickets(
          {
            ...buildPrintOrder(tableNo),
            orderId: activeOrder.id,
            lines: amendment.lines.map((line) => ({
              id: line.id,
              name: line.name,
              category: line.category,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              productionStation: line.productionStation ?? "NONE",
              ...(line.itemNote ? { itemNote: line.itemNote } : {}),
            })),
          },
          amendment.type === "ADDITION" ? "ADDITION" : "VOID",
        );
        const jobIds = new Set(result.jobs.map((job) => job.id));
        routedJobs += result.jobs.length;
        failedJobs += result.queue.filter(
          (job) => jobIds.has(job.id) && job.status === "Failed",
        ).length;
        skipped.push(...result.skipped);
      }
      const changeLabel =
        amendments
          .map((amendment) => (amendment.type === "ADDITION" ? "addition" : "cancel item"))
          .join(" + ") || "update";
      const routeOk = routedJobs > 0 && failedJobs < routedJobs;
      const message =
        routedJobs === 0
          ? `Kitchen update saved, but no KOT route accepted it. ${skipped[0] ?? "Check printer/KDS routing."}`
          : failedJobs > 0
            ? `Kitchen ${changeLabel} queued, but ${failedJobs} print route(s) failed. Check the printer queue.`
            : `Kitchen ${changeLabel} queued. Awaiting print/KDS confirmation.`;
      const noticeType: "idle" | "warning" = routedJobs > 0 && failedJobs === 0 ? "idle" : "warning";
      if (options.retainOrder) {
        setActiveOrderId(activeOrder.id);
        if (tableNo) setSelectedTableNo(tableNo);
        setPrintNotice(message);
        setPrintNoticeType(noticeType);
        return routeOk ? activeOrder.id : undefined;
      }
      clearCurrentOrder(message, noticeType);
      return routeOk ? activeOrder.id : undefined;
    }

    const knownOrderIds = new Set(transactionState.orders.map((order) => order.id));
    const draft = buildTransactionDraft(tableNo);
    const draftState = await mutateTransaction("upsertOrderDraft", {
      ...(activeOrder?.id ? { orderId: activeOrder.id } : {}),
      draft,
      targetStatus: "OPEN",
    });
    const authoritativeOrder = activeOrder?.id
      ? draftState?.state.orders.find((candidate) => candidate.id === activeOrder.id)
      : draftState?.state.orders.find((candidate) => !knownOrderIds.has(candidate.id));
    if (!authoritativeOrder) {
      throw new Error("Kitchen order did not receive an authoritative identity");
    }
    const ticketLines = authoritativeOrder.lines.filter(
      (line) => line.productionStatus !== "CANCELLED",
    );
    if (ticketLines.length === 0) {
      setActiveOrderId(authoritativeOrder.id);
      setPrintNotice("The order has no kitchen items to send.");
      setPrintNoticeType("warning");
      return undefined;
    }
    const result = sendKitchenTickets(
      {
        ...buildPrintOrder(tableNo),
        orderId: authoritativeOrder.id,
        lines: ticketLines.map((line) => ({
          id: line.id,
          name: line.name,
          category: line.category,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          productionStation: line.productionStation ?? "NONE",
          ...(line.itemNote ? { itemNote: line.itemNote } : {}),
        })),
      },
      "NEW",
    );
    const jobIds = new Set(result.jobs.map((job) => job.id));
    const failedJobs = result.queue.filter(
      (job) => jobIds.has(job.id) && job.status === "Failed",
    ).length;
    if (result.jobs.length === 0 || failedJobs === result.jobs.length) {
      setActiveOrderId(authoritativeOrder.id);
      if (tableNo) setSelectedTableNo(tableNo);
      setPrintNotice(
        result.jobs.length === 0
          ? `Order saved, but kitchen send was not completed: ${result.skipped[0] ?? "no printer/KDS route accepted the KOT"}.`
          : "Order saved, but the KOT failed on every route. Fix printing/KDS and send again.",
      );
      setPrintNoticeType("warning");
      return undefined;
    }

    const sentState = await mutateTransaction(
      "sendToKitchen",
      { orderId: authoritativeOrder.id },
      undefined,
      { kotPrinted: true },
    );
    const sentOrder =
      sentState?.state.orders.find((candidate) => candidate.id === authoritativeOrder.id) ??
      authoritativeOrder;
    const message =
      failedJobs > 0
        ? `Order sent to kitchen; ${failedJobs} KOT route(s) failed. Check the printer queue.`
        : "Kitchen ticket queued. Awaiting print/KDS confirmation.";
    const noticeType: "idle" | "warning" = failedJobs > 0 ? "warning" : "idle";
    if (options.retainOrder) {
      setActiveOrderId(sentOrder.id);
      if (tableNo) setSelectedTableNo(tableNo);
      setPrintNotice(message);
      setPrintNoticeType(noticeType);
      return sentOrder.id;
    }
    clearCurrentOrder(message, noticeType);
    return sentOrder.id;
  };

  const queueKitchenTickets = () => {
    if (!items.length && !(activeOrder && kitchenStarted && hasKitchenChanges)) return;
    if (selectedChannel?.requiresTable && !orderTable) {
      setTablePickerIntent("send");
      setTablePickerOpen(true);
      return;
    }
    void queueKitchenTicketsForTable().catch((error: unknown) => {
      setPrintNotice(
        error instanceof Error ? error.message : "The kitchen order could not be sent.",
      );
      setPrintNoticeType("warning");
    });
  };

  const moveOrderToInvoice = async (printBill: boolean) => {
    if (!activeOrder || !canPrintBill) {
      setPrintNotice("Send the order to kitchen before printing a bill or creating an invoice.");
      setPrintNoticeType("warning");
      return;
    }
    try {
      const orderForPrint = buildPrintOrder();
      await mutateTransaction("requestBillWithDraft", {
        orderId: activeOrder.id,
        draft: buildTransactionDraft(),
      });
      if (printBill) {
        const result = printCustomerDocument(orderForPrint, "BILL");
        clearCurrentOrder(
          result.jobs.length > 0
            ? "Customer bill printed and moved to Invoices."
            : `Invoice created without printing. ${result.skipped[0] ?? "Printing is not configured."}`,
          result.jobs.length > 0 ? "success" : "warning",
        );
        return;
      }
      clearCurrentOrder(`${activeOrder.id} moved to Invoices without printing a customer bill.`);
    } catch (error) {
      setPrintNotice(error instanceof Error ? error.message : "The invoice could not be created.");
      setPrintNoticeType("warning");
    }
  };

  const toggleReceipt = (option: string) => {
    if (option === "No receipt") {
      setReceiptOptions({ Print: false, WhatsApp: false, Email: false });
      return;
    }
    setReceiptOptions((current) => ({ ...current, [option]: !current[option] }));
  };

  const confirmPayment = async () => {
    if (covered < total && paymentMode !== "partial") return;
    if (paymentSubmitRef.current || paymentBusy) return;
    const draftPayments = payments.filter(
      (payment) => !payment.status || payment.status === "draft",
    );
    if (!draftPayments.length) {
      setPrintNotice("Add at least one new payment allocation before confirming.");
      setPrintNoticeType("warning");
      return;
    }
    if (!paymentInvoiceId || !paymentOrderId) {
      setPrintNotice("Payment session is no longer valid. Reopen payment from the invoice.");
      setPrintNoticeType("warning");
      return;
    }
    paymentSubmitRef.current = true;
    setPaymentBusy(true);
    let recordedThisAttempt = 0;
    let processedParts = 0;
    try {
      const refreshed = await syncFromBackend();
      let nextState = refreshed?.state;
      const bill = nextState?.bills.find((candidate) => candidate.id === paymentInvoiceId);
      if (
        !bill ||
        !bill.orderIds.includes(paymentOrderId) ||
        (bill.tenantId ?? activeTenantId) !== activeTenantId ||
        (bill.branchId ?? branchId) !== branchId ||
        !["OPEN", "PARTIAL", "PENDING"].includes(bill.status)
      ) {
        throw new Error("Payment session is no longer valid. Reopen payment from the invoice.");
      }

      const providerJobs: Array<{
        localPaymentId: string;
        invoiceId: string;
        methodCode: string;
        amount: number;
        operation: "prompt" | "qr";
      }> = [];
      let hasPendingVerification = false;
      for (const payment of draftPayments) {
        const method = paymentMethods.find((item) => item.id === payment.methodId);
        if (!method) continue;
        const issue = paymentMethodIssue(method);
        if (issue) {
          throw new Error(`${method.displayName} is unavailable: ${issue}`);
        }
        const providerOperation = method.metadata["providerOperation"];
        if (providerOperation === "PAYMENT_PROMPT" || providerOperation === "QR_PAYMENT") {
          if (backendStatus !== "synced") {
            throw new Error(`${method.displayName} cannot be initiated while the POS is offline`);
          }
          providerJobs.push({
            localPaymentId: payment.id,
            invoiceId: bill.id,
            methodCode: method.code,
            amount: payment.amount,
            operation: providerOperation === "QR_PAYMENT" ? "qr" : "prompt",
          });
          hasPendingVerification = true;
          continue;
        }
        if (backendStatus !== "synced" && method.category !== "CASH") {
          throw new Error(`${method.displayName} cannot be confirmed while the POS is offline`);
        }
        try {
          const result = await mutateTransaction("applyConfiguredPayment", {
            invoiceId: bill.id,
            paymentMethodId: method.id,
            amountMinor: parseMajorAmount(payment.amount, tenant.defaultCurrency),
            cashTenderedMinor: payment.cashTenderedMinor,
            ...(payment.fxQuote
              ? {
                  fxQuoteId: payment.fxQuote.id,
                  tenderCurrency: payment.tenderCurrency,
                  tenderedAmountMinor: payment.cashTenderedMinor,
                }
              : {}),
            ...(payment.reference ? { reference: payment.reference } : {}),
            terminalId,
          });
          nextState = result?.state ?? nextState;
          const pending = ["BANK_TRANSFER", "DIGITAL_WALLET", "CREDIT"].includes(method.category);
          setPayments((current) =>
            current.map((candidate) =>
              candidate.id === payment.id
                ? { ...candidate, status: pending ? "pending" : "recorded" }
                : candidate,
            ),
          );
          if (pending) {
            hasPendingVerification = true;
          } else {
            recordedThisAttempt += payment.amount;
          }
          processedParts += 1;
        } catch (error) {
          const base = friendlyPosError(error, "Payment could not be recorded.");
          throw new Error(
            processedParts
              ? `${base} ${processedParts} earlier payment allocation(s) were already recorded and will not be submitted again.`
              : base,
          );
        }
      }

      for (const job of providerJobs) {
        try {
          await initiateProviderPayment(job);
          setPayments((current) =>
            current.map((candidate) =>
              candidate.id === job.localPaymentId
                ? { ...candidate, status: "pending" }
                : candidate,
            ),
          );
          processedParts += 1;
        } catch (error) {
          const base = friendlyPosError(error, "Payment provider request failed.");
          throw new Error(
            processedParts
              ? `${base} ${processedParts} earlier payment allocation(s) were already submitted and will not be duplicated.`
              : base,
          );
        }
      }
      if (providerJobs.length) nextState = (await syncFromBackend())?.state ?? nextState;
      const updatedBill = nextState?.bills.find((candidate) => candidate.id === bill.id);
      const completedInvoice = updatedBill?.paymentStatus === "PAID";
      const partialRecorded =
        paymentMode === "partial" && recordedThisAttempt > 0 && !hasPendingVerification;
      if (
        receiptOptions["Print"] &&
        completedInvoice &&
        !hasPendingVerification &&
        backendStatus === "synced"
      ) {
        const receipt = nextState?.receipts.find((candidate) => candidate.invoiceId === bill.id);
        const paidOrder = nextState?.orders.find((candidate) => candidate.id === paymentOrderId);
        if (!receipt || !paidOrder || !updatedBill) {
          throw new Error(
            "Payment was confirmed but the authoritative receipt is not available yet",
          );
        }
        const result = printCustomerDocument(
          {
            orderId: paidOrder.id,
            branch: receipt.branch,
            terminalId,
            ...(updatedBill.table ? { table: updatedBill.table } : {}),
            orderType: paidOrder.channel,
            requestedBy: currentUser.name,
            cashier: receipt.cashier,
            waiter: paidOrder.waiter ?? paidOrder.cashier,
            createdAt: receipt.issuedAt,
            customer: receipt.customer,
            receiptNumber: receipt.id,
            invoiceNumber: updatedBill.id,
            lines: updatedBill.lines.map((line) => ({
              id: line.id,
              name: line.name,
              category: line.category,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              productionStation: line.productionStation ?? "NONE",
              ...(line.itemNote ? { itemNote: line.itemNote } : {}),
            })),
            subtotal: updatedBill.subtotal,
            tax: updatedBill.tax,
            total: updatedBill.total,
            paid: receipt.paidAmount,
            change: receipt.change,
            paymentMethod: receipt.paymentBreakdown.map((entry) => entry.method).join(" + "),
            paymentBreakdown: receipt.paymentBreakdown.map((entry) => ({
              method: entry.method,
              amount: entry.amount,
              reference: entry.reference,
            })),
          },
          "RECEIPT",
        );
        setPrintNotice(
          result.jobs.length > 0
            ? "Payment confirmed and receipt queued for printing."
            : `Payment confirmed without printing. ${result.skipped[0] ?? "Printing is not configured."}`,
        );
        setPrintNoticeType(result.jobs.length > 0 ? "success" : "warning");
      } else if (backendStatus !== "synced" && completedInvoice) {
        setPrintNotice(`Cash sale saved offline. ${pendingSyncCount + 1} command(s) pending sync.`);
        setPrintNoticeType("warning");
      } else if (partialRecorded) {
        const remaining = Math.max(0, (updatedBill?.total ?? total) - (updatedBill?.paid ?? 0));
        setPrintNotice(`Partial payment recorded. ${ksh(remaining)} remains on the invoice.`);
        setPrintNoticeType("success");
      } else if (hasPendingVerification) {
        setPrintNotice(
          providerJobs.length
            ? "Payment request sent. The invoice remains open until provider confirmation."
            : "Payment recorded for verification. No paid receipt has been created.",
        );
        setPrintNoticeType("warning");
      }
      setPaymentConfirmed(Boolean((completedInvoice || partialRecorded) && !hasPendingVerification));
    } catch (error) {
      setPrintNotice(friendlyPosError(error, "Payment could not be completed."));
      setPrintNoticeType("warning");
    } finally {
      paymentSubmitRef.current = false;
      setPaymentBusy(false);
    }
  };

  const initiateProviderPayment = async (job: {
    invoiceId: string;
    methodCode: string;
    amount: number;
    operation: "prompt" | "qr";
  }) => {
    const response = await fetch(
      `/api/seramet/payments/${encodeURIComponent(job.methodCode)}/${job.operation}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getSerametAccessToken()
            ? { Authorization: `Bearer ${getSerametAccessToken()}` }
            : {}),
          "x-seramet-user-id": currentUser.id,
          "x-seramet-tenant-id": activeTenantId,
          "x-seramet-branch-id": branchId,
        },
        body: JSON.stringify({
          invoiceId: job.invoiceId,
          amount: job.amount,
          ...(customerPhone ? { customerPhone } : {}),
          idempotencyKey: `pos:${job.invoiceId}:${job.methodCode}:${job.amount}`,
        }),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? "Payment provider request failed.");
    }
  };

  const closePaidOrder = () => {
    setActiveOrderId(null);
    setLines({});
    setKitchenNote("");
    setItemNotes({});
    setPaymentReference("");
    setPayments([]);
    setTendered(0);
    setCashReceived(0);
    setTenderCurrency(tenant.defaultCurrency);
    setPaymentInvoiceId(null);
    setPaymentOrderId(null);
    setPaymentConfirmed(false);
    setExistingPaid(0);
    setPaymentOpen(false);
  };

  return (
    <AppShell
      bare
      lockedContext={{
        role: role,
        companyName: tenant.tradingName,
        branch: branch,
        userName: currentUser.name,
      }}
    >
      <div className="flex flex-col gap-3 border-b border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[13px] font-extrabold uppercase tracking-[0.14em]">
            Seramet POS
          </span>
          <Status>{posStateLabel}</Status>
          <span className="text-[13px] text-muted-foreground">
            {branch} - {role} {currentUser.name}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Btn
            variant="primary"
            className="h-8 px-2.5 text-[12px]"
            onClick={() =>
              clearCurrentOrder(
                activeOrder
                  ? "New order started. The previous order remains available under Orders."
                  : "New order started.",
              )
            }
          >
            <Plus className="h-3.5 w-3.5" />
            New order
          </Btn>
          <Status>{operatorAttendanceLabel}</Status>
          <button
            type="button"
            onClick={() => {
              setTablePickerIntent("select");
              setTablePickerOpen(true);
            }}
            className={cn(
              "rounded-md px-2 py-1 text-[12px] font-semibold transition-colors",
              orderTable
                ? "bg-accent text-accent-foreground hover:bg-accent/80"
                : "bg-secondary hover:bg-secondary/80",
            )}
          >
            {orderTable ? `Table ${orderTable}` : "Select table"}
          </button>
          <span className="rounded-md bg-secondary px-2 py-1 text-[12px] font-semibold">
            {selectedChannel?.displayName ?? "No channel configured"}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[12px] font-medium",
              backendStatus === "synced" ? "text-emerald-700" : "text-amber-700",
            )}
            title={
              pendingSyncCount
                ? `${pendingSyncCount} command(s) pending synchronization`
                : undefined
            }
          >
            {backendStatus === "synced" ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : backendStatus === "offline" || backendStatus === "error" ? (
              <WifiOff className="h-3.5 w-3.5" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5 animate-spin" />
            )}
            {connectionLabel(backendStatus, pendingSyncCount)}
          </span>
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> {currentTime}
          </span>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[132px_minmax(0,1fr)_360px]">
        <nav className="flex gap-1.5 overflow-x-auto border-b border-border bg-card p-2 lg:h-[calc(100vh-8rem)] lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {posCategories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-colors lg:w-full",
                cat === c
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="block truncate">{c}</span>
              <span className="mt-0.5 block text-[10px] font-medium opacity-70">
                {c === "All items"
                  ? branchMenu.length
                  : branchMenu.filter((item) => item.category === c).length}{" "}
                items
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 p-4">
          <div className="relative mb-2 flex gap-1.5 overflow-visible rounded-lg border border-border bg-card p-1.5">
            {orderChannels.map((source) => (
              <button
                key={source.id}
                disabled={kitchenStarted}
                title={kitchenStarted ? "Order source is locked after the kitchen ticket is sent" : undefined}
                onClick={() => setOrderSource(source.id)}
                className={cn(
                  "min-h-9 shrink-0 rounded-md px-3 text-[12px] font-semibold transition-colors",
                  orderSource === source.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {source.displayName}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveOrdersOpen((open) => !open)}
              className={cn(
                "ml-auto inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-[12px] font-bold transition-colors",
                activeOrdersOpen
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              <Plus className="h-4 w-4" />
              Orders
              <span className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px]">
                {activePosOrders.length}
              </span>
            </button>
            {activeOrdersOpen && (
              <div className="absolute right-1 top-12 z-30 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-2 shadow-xl">
                <div className="px-2 py-1 text-[12px] font-bold">Held and kitchen orders</div>
                <div className="max-h-80 space-y-1 overflow-y-auto">
                  {activePosOrders.length === 0 && (
                    <div className="rounded-md border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
                      No held or kitchen orders waiting in POS.
                    </div>
                  )}
                  {activePosOrders.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => {
                        setActiveOrderId(order.id);
                        setActiveOrdersOpen(false);
                      }}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-secondary",
                        activeOrderId === order.id ? "border-primary bg-accent" : "border-border",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="num text-[12px] font-bold">{order.id}</span>
                        <Status>{order.status.replaceAll("_", " ")}</Status>
                      </div>
                      <div className="mt-1 truncate text-[12px] text-muted-foreground">
                        {order.table ? `Table ${order.table} - ` : ""}
                        {order.customer} - {order.channel} - {order.lines.length} items - {ksh(order.total)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mb-3 flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search dishes, category, item code or scan barcode"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </div>
          {isOnlineSource && (
            <div className="mb-3 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-[12px] font-semibold text-info">
              {selectedChannel?.displayName} selected:{" "}
              {channelUsesOnlinePrice
                ? "items with an explicit online price use it for this channel."
                : "this channel uses the normal branch price."}{" "}
              Settlement still follows the channel payment configuration.
            </div>
          )}
          {operationalMenu.status === "error" && (
            <div className="mb-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[12px] font-semibold text-warning">
              Authoritative menu unavailable: {operationalMenu.error}
            </div>
          )}
          {operationalMenu.status === "ready" && branchMenu.length === 0 && (
            <div className="mb-3 rounded-lg border border-border bg-card px-3 py-4 text-[12px] text-muted-foreground">
              No sellable menu items are configured for this branch. Use Setup Centre or Menu Import
              before taking orders.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((p) => {
              const qty = lines[p.id] ?? 0;
              const imageSrc = productImageSource(p);

              return (
                <article
                  key={p.id}
                  role="button"
                  tabIndex={p.out ? -1 : 0}
                  aria-disabled={p.out}
                  aria-label={`Add ${p.name} to order`}
                  onClick={() => {
                    if (!p.out) bump(p.id, 1);
                  }}
                  onKeyDown={(event) => {
                    if (p.out || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    bump(p.id, 1);
                  }}
                  className={cn(
                    "group rounded-xl border border-border bg-card p-2.5 text-left shadow-card transition-all focus:outline-none focus:ring-2 focus:ring-primary/30",
                    p.out
                      ? "opacity-50"
                      : "cursor-pointer hover:-translate-y-0.5 hover:border-primary",
                    qty ? "border-primary ring-1 ring-primary/25" : "",
                  )}
                >
                  <div className="relative mb-2 overflow-hidden rounded-lg border border-border bg-secondary/60 aspect-[1.45/1]">
                    <div
                      className={cn(
                        "absolute inset-0 grid place-items-center",
                        productFallbackTone(p.category),
                      )}
                    >
                      <div className="grid h-14 w-14 place-items-center rounded-full border border-card/80 bg-card/85 text-[13px] font-extrabold shadow-sm">
                        {productInitials(p.name)}
                      </div>
                    </div>
                    {imageSrc && (
                      <img
                        src={imageSrc}
                        alt={p.name}
                        loading="lazy"
                        className="relative z-10 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                    {p.popular && (
                      <span className="absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded-full border border-border bg-card/90 shadow-sm">
                        <Flame className="h-3.5 w-3.5 text-warning" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 px-0.5">
                    <div className="truncate text-[11px] text-muted-foreground">{p.category}</div>
                    <div className="mt-0.5 truncate text-[13px] font-bold">{p.name}</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="num text-[13px] font-extrabold">{ksh(p.price)}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {p.out
                          ? "86'd"
                          : p.availabilityPortions !== undefined && p.availabilityPortions <= 5
                            ? `${p.availabilityPortions} left`
                            : `${p.prep} min`}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-muted-foreground">
                        {p.productionStation ?? "NONE"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={p.out || qty <= 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            bump(p.id, -1);
                          }}
                          className="grid h-6 w-6 place-items-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-secondary disabled:opacity-40"
                          aria-label={`Remove ${p.name}`}
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="num w-4 text-center text-[12px] font-bold">{qty}</span>
                        <button
                          type="button"
                          disabled={p.out}
                          onClick={(event) => {
                            event.stopPropagation();
                            bump(p.id, 1);
                          }}
                          className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-40"
                          aria-label={`Add ${p.name}`}
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="flex flex-col border-t border-border bg-card lg:h-[calc(100vh-8rem)] lg:border-l lg:border-t-0">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] font-bold">Order {currentOrderNumber}</div>
                <div className="text-[12px] text-muted-foreground">{orderContextLabel}</div>
              </div>
              <Status>{activeOrder?.status.replaceAll("_", " ") ?? "New"}</Status>
            </div>
          </div>
          <div className="flex-1 divide-y divide-border overflow-y-auto">
            {items.length === 0 && (
              <p className="p-6 text-center text-[13px] text-muted-foreground">
                {activeOrder && kitchenStarted && hasKitchenChanges
                  ? "All items are marked for removal. Send the kitchen update to print the cancellation."
                  : "Tap a dish to start the order."}
              </p>
            )}
            {items.map((l) => {
              const sentQuantity = sentQuantities[l.p.id] ?? 0;
              return (
                <div key={l.p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{l.p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{ksh(l.p.price)} each</div>
                    {sentQuantity > 0 && (
                      <div className="mt-1 text-[10px] font-semibold uppercase text-primary">
                        {sentQuantity} sent / {Math.max(0, l.qty - sentQuantity)} unsent
                      </div>
                    )}
                    <input
                      value={itemNotes[l.p.id] ?? ""}
                      onChange={(event) =>
                        setItemNotes((current) => ({ ...current, [l.p.id]: event.target.value }))
                      }
                      placeholder="Item note"
                      className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:border-primary"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => bump(l.p.id, -1)}
                      disabled={l.qty <= 0}
                      className="grid h-7 w-7 place-items-center rounded-md border border-border disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="num w-5 text-center text-[13px] font-bold">{l.qty}</span>
                    <button
                      onClick={() => bump(l.p.id, 1)}
                      className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <span className="num w-16 text-right text-[13px] font-bold">
                      {ksh(l.p.price * l.qty)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-border p-4">
            <textarea
              value={kitchenNote}
              onChange={(event) => setKitchenNote(event.target.value)}
              placeholder="Special request for kitchen or bar"
              rows={2}
              className="mb-3 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-primary"
            />
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between text-muted-foreground">
                <dt>Subtotal</dt>
                <dd className="num">{ksh(subtotal)}</dd>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <dt>Tax and service</dt>
                <dd className="num">{ksh(tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-[16px] font-bold">
                <dt>Total</dt>
                <dd className="num">{ksh(total)}</dd>
              </div>
            </dl>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Btn onClick={holdOrder}>Hold</Btn>
              {canPrintBill ? (
                <>
                  <Btn onClick={() => moveOrderToInvoice(true)}>Print bill</Btn>
                  <Btn onClick={() => moveOrderToInvoice(false)}>
                    <FileText className="h-4 w-4" />
                    Invoice
                  </Btn>
                </>
              ) : (
                <Btn className="col-span-2" onClick={() => setMoreOpen(true)}>
                  More
                </Btn>
              )}
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1.4fr] gap-2">
              <Btn
                onClick={queueKitchenTickets}
                disabled={
                  kitchenRouteUnavailable ||
                  (!items.length && !kitchenStarted) ||
                  (kitchenStarted && !hasKitchenChanges)
                }
              >
                {kitchenRouteUnavailable
                  ? "Configure kitchen route"
                  : kitchenStarted
                    ? hasKitchenChanges
                      ? "Send kitchen update"
                      : "Kitchen up to date"
                    : "Send kitchen"}
              </Btn>
              <Btn
                variant="primary"
                className="h-11 text-[15px]"
                onClick={() => void openPayment()}
                disabled={
                  paymentBusy ||
                  !items.length ||
                  (!payMayAutoSendKitchen &&
                    (!activeOrder || !kitchenStarted || hasKitchenChanges)) ||
                  (payMayAutoSendKitchen &&
                    (!activeOrder || !kitchenStarted || hasKitchenChanges) &&
                    kitchenRouteUnavailable)
                }
              >
                {paymentBusy
                  ? "Preparing..."
                  : payMayAutoSendKitchen && (!activeOrder || !kitchenStarted || hasKitchenChanges)
                    ? `Send & pay ${ksh(total)}`
                    : !activeOrder || !kitchenStarted
                      ? "Send kitchen first"
                      : hasKitchenChanges
                        ? "Send update first"
                        : `Pay ${ksh(total)}`}
              </Btn>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {usablePaymentMethods.map((method) => (
                <span key={method.id} className="rounded border border-border px-1.5 py-0.5">
                  {method.displayName}
                </span>
              ))}
              {unavailablePaymentMethods.length > 0 && (
                <span className="rounded border border-warning/30 bg-warning-soft px-1.5 py-0.5 text-warning">
                  {unavailablePaymentMethods.length} payment method
                  {unavailablePaymentMethods.length === 1 ? "" : "s"} unavailable
                </span>
              )}
              <span className="rounded border border-border px-1.5 py-0.5">Split</span>
            </div>
            <div
              className={cn(
                "mt-3 rounded-lg border p-3",
                printNoticeType === "success"
                  ? "border-success/30 bg-success-soft text-success"
                  : printNoticeType === "warning"
                    ? "border-warning/30 bg-warning-soft text-warning"
                    : "border-border bg-secondary/40 text-muted-foreground",
              )}
            >
              <div className="flex items-center gap-2">
                {printNoticeType === "success" ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                ) : (
                  <Printer className="h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-foreground">{printNotice}</div>
                  <div className="mt-0.5 text-[11px]">
                    {printNoticeType === "success"
                      ? "Printer/KDS delivery is confirmed."
                      : printNoticeType === "warning"
                        ? "Resolve this before relying on kitchen output."
                        : "Routing status updates here as the job progresses."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="max-w-[460px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Order actions</DialogTitle>
            <DialogDescription>
              Actions for {activeOrder?.id ?? currentOrderNumber}. Nothing here records a placeholder
              action.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Btn
              onClick={() => {
                setMoreOpen(false);
                setTablePickerIntent("select");
                setTablePickerOpen(true);
              }}
            >
              {orderTable ? "Change table" : "Select table"}
            </Btn>
            <Btn
              onClick={() => {
                setMoreOpen(false);
                setActiveOrdersOpen(true);
              }}
            >
              Open active orders
            </Btn>
            <Btn
              onClick={() => {
                setMoreOpen(false);
                clearCurrentOrder(
                  activeOrder ? "Order closed from the POS view; it remains in active orders." : "Draft cleared.",
                );
              }}
            >
              {activeOrder ? "Close order view" : "Clear draft"}
            </Btn>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tablePickerOpen} onOpenChange={setTablePickerOpen}>
        <DialogContent className="max-w-[920px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Select table</DialogTitle>
            <DialogDescription>
              {tablePickerIntent === "send"
                ? `Choose a table for Order ${currentOrderNumber}; the order will then be sent to kitchen.`
                : `Choose or change the table for Order ${currentOrderNumber}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <div className="mb-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
                {Object.keys(tableStateStyle).map((state) => (
                  <span key={state} className="inline-flex items-center gap-1.5">
                    <span className={cn("h-3 w-3 rounded border", tableStateStyle[state])} />{" "}
                    {state}
                  </span>
                ))}
              </div>
              {floorTables.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center">
                  <div className="text-[13px] font-semibold">No restaurant tables are configured</div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Add the branch tables first, then return to POS to allocate dine-in orders.
                  </p>
                  <Btn className="mt-3" onClick={() => void navigate({ to: "/tables" })}>
                    Configure tables
                  </Btn>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {floorTables.map((table) => (
                  <button
                    key={table.no}
                    type="button"
                    disabled={table.state === "Unavailable"}
                    onClick={() => {
                      if (table.orderId) {
                        setActiveOrderId(table.orderId);
                        setSelectedTableNo(table.no);
                        setTablePickerIntent("select");
                        setTablePickerOpen(false);
                        setPrintNotice(`Opened the active order for Table ${table.no}.`);
                        setPrintNoticeType("idle");
                        return;
                      }
                      setSelectedTableNo(table.no);
                      const shouldSend = tablePickerIntent === "send";
                      setTablePickerIntent("select");
                      setTablePickerOpen(false);
                      if (shouldSend) {
                        void queueKitchenTicketsForTable(table.no).catch((error: unknown) => {
                          setPrintNotice(
                            error instanceof Error
                              ? error.message
                              : "The kitchen order could not be sent.",
                          );
                          setPrintNoticeType("warning");
                        });
                      }
                    }}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed",
                      tableStateStyle[table.state],
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[15px] font-extrabold">Table {table.no}</span>
                      <span className="text-[11px] text-muted-foreground">{table.seats} seats</span>
                    </div>
                    <div className="mt-2">
                      <Status>{table.state}</Status>
                    </div>
                    <div className="mt-2.5 space-y-1 text-[12px] text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Area</span>
                        <span className="font-semibold text-foreground">{table.area}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Guests</span>
                        <span className="num font-semibold text-foreground">
                          {table.guests ?? 0}
                        </span>
                      </div>
                      {table.amount && (
                        <div className="flex justify-between">
                          <span>Open bill</span>
                          <span className="num font-semibold text-foreground">
                            {ksh(table.amount)}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
                </div>
              )}
            </div>
            <aside className="rounded-xl border border-border bg-secondary/40 p-4">
              <div className="text-[13px] font-bold">Order summary</div>
              <dl className="mt-3 space-y-2 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="num font-semibold">
                    {items.reduce((sum, item) => sum + item.qty, 0)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="num font-semibold">{ksh(subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tax and service</dt>
                  <dd className="num font-semibold">{ksh(tax)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <dt className="font-semibold">Total</dt>
                  <dd className="num font-bold">{ksh(total)}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-md bg-card px-3 py-2 text-[12px] text-muted-foreground">
                Available tables can be allocated to this order. Selecting an occupied table opens
                its existing order instead of creating a duplicate.
              </div>
            </aside>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className="max-w-[720px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Take payment</DialogTitle>
            <DialogDescription>
              Order {currentOrderNumber} -{" "}
              {orderTable ? `Table ${orderTable}` : selectedChannel?.displayName} -{" "}
              {selectedChannel?.displayName}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <div className="rounded-xl border border-border bg-secondary/50 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Total due
              </div>
              <div className="num mt-1 text-[28px] font-extrabold">{ksh(total)}</div>
              <dl className="mt-4 space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="num">{ksh(subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Tax and service</dt>
                  <dd className="num">{ksh(tax)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd className="num">{ksh(paid)}</dd>
                </div>
                {pendingAllocated > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Allocated / pending</dt>
                    <dd className="num">{ksh(pendingAllocated)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Balance</dt>
                  <dd className="num">{ksh(due)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <dt className="font-semibold">Change due</dt>
                  <dd className="num font-bold">{ksh(change)}</dd>
                </div>
              </dl>
              {payments.length > 0 && (
                <div className="mt-4 space-y-2">
                  {payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between rounded-md bg-card px-2.5 py-2 text-[12px]"
                    >
                      <span className="min-w-0 font-semibold">
                        <span className="block truncate">{payment.method}</span>
                        <span className="mt-1 block">
                          <Status>
                            {payment.status === "recorded"
                              ? "Recorded"
                              : payment.status === "pending"
                                ? "Pending"
                                : "Ready"}
                          </Status>
                        </span>
                      </span>
                      <span className="num text-right">
                        <span className="block">{ksh(payment.amount)}</span>
                        {payment.fxQuote && (
                          <span className="block text-[10px] text-muted-foreground">
                            {formatMinor(
                              payment.tenderAmountMinor,
                              payment.tenderCurrency,
                              activeLocale(),
                            )}
                          </span>
                        )}
                      </span>
                      {!paymentConfirmed && (!payment.status || payment.status === "draft") && (
                        <button
                          onClick={() => removePayment(payment.id)}
                          className="text-muted-foreground hover:text-danger"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-4">
              {paymentConfirmed ? (
                <div className="rounded-xl border border-success/30 bg-success-soft p-4">
                  <div className="flex items-center gap-2 text-[14px] font-bold text-success">
                    <CheckCircle2 className="h-5 w-5" />
                    Payment confirmed
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed">
                    {paid >= total
                      ? `Order ${currentOrderNumber} is fully paid.`
                      : `Partial payment recorded with ${ksh(due)} balance.`}
                  </p>
                  <div className="mt-4 grid gap-2 text-[12px]">
                    {Object.entries(receiptOptions)
                      .filter(([, enabled]) => enabled)
                      .map(([option]) => (
                        <div
                          key={option}
                          className="flex items-center justify-between rounded-md bg-card px-3 py-2"
                        >
                          <span className="inline-flex items-center gap-2 font-semibold">
                            <ReceiptText className="h-4 w-4" /> {option} receipt
                          </span>
                          <span className="text-success">Queued</span>
                        </div>
                      ))}
                    {Object.values(receiptOptions).every((enabled) => !enabled) && (
                      <div className="rounded-md bg-card px-3 py-2 font-semibold">
                        Receipt skipped
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Btn onClick={() => setPaymentConfirmed(false)}>Edit payment</Btn>
                    <Btn variant="primary" onClick={closePaidOrder}>
                      Close order
                    </Btn>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-muted-foreground">
                      Payment method
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {usablePaymentMethods.map((method) => (
                        <button
                          key={method.id}
                          onClick={() => setPaymentMethod(method.id)}
                          className={cn(
                            "min-h-12 rounded-md border px-3 py-2 text-[13px] font-semibold",
                            paymentMethod === method.id
                              ? "border-primary bg-accent text-accent-foreground"
                              : "border-border hover:bg-secondary",
                          )}
                        >
                          <span className="block">{method.displayName}</span>
                          <span className="mt-0.5 block text-[10px] font-medium opacity-70">Ready</span>
                        </button>
                      ))}
                    </div>
                    {unavailablePaymentMethods.length > 0 && (
                      <div className="mt-2 rounded-md bg-secondary/60 px-3 py-2 text-[11px] text-muted-foreground">
                        {unavailablePaymentMethods.map(({ method, issue }) => (
                          <div key={method.id}>
                            <span className="font-semibold text-foreground">{method.displayName}:</span>{" "}
                            {issue}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {paymentCurrencies.length > 1 && (
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      Tender currency
                      <select
                        value={tenderCurrency}
                        onChange={(event) => {
                          setTenderCurrency(event.target.value);
                          setCashReceived(0);
                        }}
                        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground outline-none"
                      >
                        {paymentCurrencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code} - {currency.name}
                          </option>
                        ))}
                      </select>
                      {tenderCurrency !== tenant.defaultCurrency && (
                        <span className="font-normal">
                          The server will lock a five-minute FX quote before this payment is added.
                        </span>
                      )}
                    </label>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => {
                        setSplitMethodId(selectedPaymentMethod?.id ?? usablePaymentMethods[0]?.id ?? "");
                        setSplitAmount("");
                        setSplitReference("");
                        setSplitCashReceived("");
                        setSplitOpen(true);
                      }}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-[13px] hover:bg-secondary",
                        paymentMode === "split"
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border",
                      )}
                    >
                      <span className="block font-semibold">Add split payment</span>
                      <span className="text-[12px] text-muted-foreground">
                        Enter any amount and method; repeat for as many people as needed
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setPaymentMode("partial");
                        setTendered(0);
                        setCashReceived(0);
                      }}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-[13px] hover:bg-secondary",
                        paymentMode === "partial"
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border",
                      )}
                    >
                      <span className="block font-semibold">Partial payment</span>
                      <span className="text-[12px] text-muted-foreground">
                        Leave balance on the order
                      </span>
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      Amount to apply ({tenant.defaultCurrency})
                      <input
                        type="number"
                        min={0}
                        value={tendered}
                        onChange={(event) => setTendered(Number(event.target.value))}
                        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground outline-none"
                      />
                    </label>
                    <Btn
                      className="self-end"
                      onClick={() => void addPayment()}
                      disabled={paymentBusy}
                    >
                      {paymentBusy ? "Checking rate" : "Add payment"}
                    </Btn>
                  </div>
                  {selectedPaymentMethod?.category === "CASH" && (
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      Cash received ({tenderCurrency})
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={cashReceived || ""}
                        onChange={(event) => setCashReceived(Number(event.target.value))}
                        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground outline-none"
                        placeholder={
                          tenderCurrency === tenant.defaultCurrency
                            ? String(tendered || suggestedAmount)
                            : "Enter foreign cash tendered"
                        }
                      />
                    </label>
                  )}
                  {selectedPaymentMethod?.requiresReference && (
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      {selectedPaymentMethod.displayName} transaction reference
                      <input
                        value={paymentReference}
                        onChange={(event) =>
                          setPaymentReference(
                            event.target.value
                              .replace(/[^a-z0-9]/gi, "")
                              .toUpperCase()
                              .slice(0, 32),
                          )
                        }
                        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold uppercase text-foreground outline-none"
                        placeholder="Transaction reference"
                      />
                    </label>
                  )}
                  {selectedPaymentMethod?.requiresCustomer &&
                    selectedPaymentMethod.metadata["providerOperation"] === "PAYMENT_PROMPT" && (
                      <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                        Customer phone
                        <input
                          inputMode="tel"
                          value={customerPhone}
                          onChange={(event) =>
                            setCustomerPhone(
                              event.target.value.replace(/[^+0-9]/g, "").slice(0, 16),
                            )
                          }
                          className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground outline-none"
                          placeholder="2547XXXXXXXX"
                        />
                      </label>
                    )}
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-muted-foreground">
                      Receipt options
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["Print", "WhatsApp", "Email", "No receipt"].map((r) => (
                        <button
                          key={r}
                          onClick={() => toggleReceipt(r)}
                          className={cn(
                            "rounded-md border px-2.5 py-1.5 text-[12px] font-semibold",
                            (
                              r === "No receipt"
                                ? Object.values(receiptOptions).every((enabled) => !enabled)
                                : receiptOptions[r]
                            )
                              ? "border-primary bg-accent text-accent-foreground"
                              : "border-border hover:bg-secondary",
                          )}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  {covered < total && paymentMode !== "partial" && (
                    <div className="rounded-md bg-warning-soft px-3 py-2 text-[12px] font-semibold text-warning">
                      Allocate {ksh(total - covered)} more before confirming, or switch to partial payment.
                    </div>
                  )}
                  <div className="flex justify-end gap-2 border-t border-border pt-4">
                    <Btn onClick={() => setPaymentOpen(false)}>Cancel</Btn>
                    <Btn variant="primary" onClick={confirmPayment} disabled={paymentBusy}>
                      Confirm{" "}
                      {paymentMode === "partial"
                        ? "partial"
                        : paymentMode === "split"
                          ? "split"
                          : (selectedPaymentMethod?.displayName ?? "configured")}{" "}
                      payment
                    </Btn>
                  </div>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
        <DialogContent className="max-w-[460px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Add split payment</DialogTitle>
            <DialogDescription>
              Enter this person's amount and payment method. Remaining balance: {ksh(due)}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
              Payment method
              <select
                value={splitMethodId}
                onChange={(event) => {
                  setSplitMethodId(event.target.value);
                  setSplitReference("");
                  setSplitCashReceived("");
                }}
                className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground"
              >
                <option value="">Select payment method</option>
                {usablePaymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
              Split amount ({tenant.defaultCurrency})
              <input
                type="number"
                min={0}
                max={due}
                step="any"
                value={splitAmount}
                onChange={(event) => setSplitAmount(event.target.value)}
                className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground"
                placeholder="Enter amount"
              />
            </label>
            {splitPaymentMethod?.category === "CASH" && (
              <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                Cash received ({tenant.defaultCurrency})
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={splitCashReceived}
                  onChange={(event) => setSplitCashReceived(event.target.value)}
                  className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground"
                  placeholder={splitAmount || "Enter cash received"}
                />
              </label>
            )}
            {splitPaymentMethod?.requiresReference && (
              <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                {splitPaymentMethod.displayName} transaction reference
                <input
                  value={splitReference}
                  onChange={(event) =>
                    setSplitReference(
                      event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 32),
                    )
                  }
                  className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold uppercase text-foreground"
                  placeholder="Transaction reference"
                />
              </label>
            )}
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Btn onClick={() => setSplitOpen(false)}>Cancel</Btn>
              <Btn variant="primary" onClick={addSplitPayment}>
                Add split
              </Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function connectionLabel(status: string, pending: number) {
  if (status === "synced") return "Online";
  if (status === "reconnecting") return "Reconnecting";
  if (status === "conflict") return `Sync issues${pending ? ` (${pending})` : ""}`;
  if (status === "offline" || status === "error") {
    return `Offline${pending ? ` (${pending} pending)` : ""}`;
  }
  return "Syncing";
}
