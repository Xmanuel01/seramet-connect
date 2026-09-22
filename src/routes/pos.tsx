import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { SerametPrintService, type OrderForPrint } from "@/lib/seramet-print-service";
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

function POS() {
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
      reference?: string;
      tenderCurrency: string;
      tenderAmountMinor: number;
      cashTenderedMinor: number;
      fxQuote?: FxPaymentQuote;
      status: "staged" | "confirmed" | "pending" | "failed";
      error?: string;
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
  const [printNotice, setPrintNotice] = useState("Print routing is running in the background.");
  const [printNoticeType, setPrintNoticeType] = useState<"idle" | "success" | "warning">("idle");
  const [kitchenNote, setKitchenNote] = useState("");
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrdersOpen, setActiveOrdersOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [selectedTableNo, setSelectedTableNo] = useState<string | null>(null);
  const [lastKitchenJobIds, setLastKitchenJobIds] = useState<string[]>([]);
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
  const openCashDrawer = transactionState.paymentOperations?.drawerSessions.find(
    (drawer) =>
      drawer.tenantId === activeTenantId &&
      drawer.branchId === branchId &&
      drawer.status === "OPEN",
  );
  const paymentMethodAvailability = useCallback(
    (method: (typeof paymentMethods)[number]) => {
      if (method.category === "CASH" && !openCashDrawer) {
        return {
          usable: false,
          label: "Open drawer",
          reason: "Open a cash drawer before taking cash.",
        };
      }
      if (backendStatus !== "synced" && method.category !== "CASH") {
        return {
          usable: false,
          label: "Online required",
          reason: `${method.displayName} requires an online connection.`,
        };
      }
      const providerOperation = method.metadata["providerOperation"];
      if (providerOperation === "PAYMENT_PROMPT") {
        return { usable: true, label: "Phone required", reason: "" };
      }
      if (providerOperation === "QR_PAYMENT") {
        return { usable: true, label: "Provider QR", reason: "" };
      }
      if (method.category === "BANK_TRANSFER") {
        return { usable: true, label: "Reference required", reason: "" };
      }
      if (method.category === "DIGITAL_WALLET") {
        return { usable: true, label: "Reference required", reason: "" };
      }
      if (method.category === "CASH") {
        return { usable: true, label: "Drawer open", reason: "" };
      }
      return { usable: true, label: "Ready", reason: "" };
    },
    [backendStatus, openCashDrawer],
  );
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
  const onlinePriceMultiplier = Number(selectedChannel?.metadata["priceMultiplier"] ?? 1);
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
  const branchOrders = useMemo(
    () =>
      transactionState.orders.filter(
        (order) =>
          (order.tenantId ?? activeTenantId) === activeTenantId &&
          (order.branchId ?? branchId) === branchId,
      ),
    [activeTenantId, branchId, transactionState.orders],
  );
  const activePosOrders = useMemo(
    () =>
      branchOrders
        .filter((order) =>
          ["HELD", "OPEN", "SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(
            order.status,
          ),
        )
        .filter((order) => !billedOrderIds.has(order.id)),
    [billedOrderIds, branchOrders],
  );
  const openTableOrders = useMemo(
    () =>
      branchOrders.filter(
        (order) =>
          Boolean(order.table) &&
          [
            "HELD",
            "OPEN",
            "SENT_TO_KITCHEN",
            "IN_PROGRESS",
            "READY",
            "SERVED",
            "BILL_REQUESTED",
          ].includes(order.status),
      ),
    [branchOrders],
  );
  const activeOrder = branchOrders.find((order) => order.id === activeOrderId) ?? null;
  const canPrintBill =
    activeOrder !== null &&
    ["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"].includes(activeOrder.status);
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
          const price = isOnlineSource
            ? Math.round(branchPrice * onlinePriceMultiplier)
            : branchPrice;
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
      isOnlineSource,
      onlinePriceMultiplier,
      operationalMenu.items,
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
        const activeTableOrder = openTableOrders.find((order) => order.table === table.code);
        return {
          no: table.code,
          seats: table.seats,
          area: table.serviceAreaId
            ? (serviceAreaNames.get(table.serviceAreaId) ?? "Dining")
            : "Dining",
          state: activeTableOrder ? "Occupied" : "Available",
          guests: Number(activeTableOrder?.customer.match(/(\d+)\s+guest/i)?.[1] ?? 0),
          amount: activeTableOrder?.total,
          orderId: activeTableOrder?.id,
          orderStatus: activeTableOrder?.status,
        };
      });
  }, [activeTenantId, branchId, branchServiceAreas, openTableOrders, platformState.tables]);

  const posCategories = useMemo(() => {
    const importedCategories = Array.from(new Set(branchMenu.map((product) => product.category)));
    return ["All items", ...importedCategories];
  }, [branchMenu]);

  useEffect(() => {
    if (!posCategories.includes(cat)) setCat("All items");
  }, [cat, posCategories]);

  useEffect(() => {
    if (!configurationError) return;
    setPrintNotice(`Printing unavailable: ${configurationError}`);
    setPrintNoticeType("warning");
  }, [configurationError]);

  useEffect(() => {
    if (!selectedChannel && orderChannels[0]) setOrderSource(orderChannels[0].id);
  }, [orderChannels, selectedChannel]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!paymentMethods.length) {
      if (paymentMethod) setPaymentMethod("");
      return;
    }
    const selected = paymentMethods.find((method) => method.id === paymentMethod);
    if (selected && paymentMethodAvailability(selected).usable) return;
    const next =
      paymentMethods.find((method) => paymentMethodAvailability(method).usable) ??
      selected ??
      paymentMethods[0];
    if (next && next.id !== paymentMethod) setPaymentMethod(next.id);
  }, [paymentMethod, paymentMethodAvailability, paymentMethods]);

  useEffect(() => {
    if (!lastKitchenJobIds.length) return;
    const tracked = printJobs.filter((job) => lastKitchenJobIds.includes(job.id));
    if (!tracked.length) return;
    const failed = tracked.find((job) => job.status === "Failed");
    if (failed) {
      setPrintNotice(
        `KOT delivery failed${failed.failureReason ? `: ${failed.failureReason}` : "."} Open Printers, correct the route, then retry.`,
      );
      setPrintNoticeType("warning");
      return;
    }
    const delivered = tracked.every((job) =>
      ["Printed", "Displayed", "Fallback Printed"].includes(job.status),
    );
    if (delivered) {
      setPrintNotice(
        tracked.some((job) => job.status === "Displayed")
          ? "Kitchen ticket delivered to the configured KDS/production route."
          : "Kitchen Order Ticket delivered to the configured printer route.",
      );
      setPrintNoticeType("success");
      return;
    }
    const active = tracked.find((job) => ["Queued", "Sending", "Retrying"].includes(job.status));
    if (active) {
      setPrintNotice(`Kitchen ticket ${active.status.toLowerCase()} — delivery is not yet confirmed.`);
      setPrintNoticeType("idle");
    }
  }, [lastKitchenJobIds, printJobs]);

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
    setSelectedTableNo(activeOrder.table ?? null);
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

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visible = branchMenu.filter((product) => {
    const categoryMatches = cat === "All items" ? true : product.category === cat;
    if (!categoryMatches) return false;
    if (!normalizedSearch) return true;
    return [product.name, product.category, product.itemCode, product.sku, product.barcode].some(
      (value) => value?.toLocaleLowerCase().includes(normalizedSearch),
    );
  });
  const items = Object.entries(lines)
    .map(([id, qty]) => ({ p: branchMenu.find((x) => x.id === id)!, qty }))
    .filter((l) => l.p && l.qty > 0);
  const orderTable = activeOrder?.table ?? selectedTableNo ?? undefined;
  const activeOrderHasSentLines = Boolean(activeOrder?.lines.some((line) => line.sentAt));
  const channelLocked = activeOrderHasSentLines;
  const activeOrderKitchenSent = Boolean(
    activeOrder &&
      ["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED", "BILL_REQUESTED"].includes(
        activeOrder.status,
      ),
  );
  const hasUnsentItems = items.some(
    (line) => line.qty > (sentQuantities[line.p.id] ?? 0),
  );
  const dineInPaymentReady =
    !selectedChannel?.requiresTable ||
    Boolean(orderTable && activeOrderKitchenSent && !hasUnsentItems);
  const workflowState = paymentOpen || paymentBusy
    ? "Paying"
    : !activeOrder
      ? "New"
      : activeOrder.status === "HELD"
        ? "Held"
        : activeOrder.status === "READY" || activeOrder.status === "SERVED"
          ? "Ready"
          : activeOrderKitchenSent
            ? "Kitchen"
            : "New";
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
  const total = majorFromMinor(
    subtotalMinor + taxTotals.added + serviceTotals.added,
    tenant.defaultCurrency,
  );
  const paid = payments.reduce(
    (sum, payment) => sum + (payment.status === "failed" ? 0 : payment.amount),
    0,
  );
  const due = Math.max(0, total - paid);
  const change = Math.max(0, paid - total);
  const suggestedAmount = paymentMode === "split" ? Math.ceil(due / 2) : due;
  const predictedNextOrderId = () => nextTransactionRecordId("ORD", transactionState.orders);
  const predictedNextInvoiceId = () => nextTransactionRecordId("INV", transactionState.bills);
  const predictedNextReceiptId = () => nextTransactionRecordId("RCP", transactionState.receipts);
  const currentOrderNumber = activeOrder?.id ?? paymentOrderId ?? predictedNextOrderId();
  const clockLabel = new Intl.DateTimeFormat(tenant.locale || activeLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: branchRecord.timezone ?? tenant.timezone,
  }).format(clockNow);
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
      payments
        .filter((payment) => payment.status !== "failed")
        .map((payment) => payment.method)
        .join(" + ") ||
      selectedPaymentMethod?.displayName ||
      "Configured payment",
    paymentBreakdown: payments
      .filter((payment) => payment.status !== "failed")
      .map((payment) => ({
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
      customer:
        channelLocked && activeOrder
          ? activeOrder.customer
          : isOnlineSource
            ? (selectedChannel?.displayName ?? "Online customer")
            : selectedChannel?.channelType === "TAKEAWAY"
              ? "Walk-in"
              : tableNo
                ? `Table ${tableNo}`
                : "Unassigned table",
      channel:
        channelLocked && activeOrder
          ? activeOrder.channel
          : (selectedChannel?.code ?? selectedChannel?.id ?? "UNCONFIGURED"),
      cashier: currentUser.name,
      waiter: currentUser.name,
      ...(kitchenNote.trim() ? { kitchenNote: kitchenNote.trim() } : {}),
      financialOverride: { subtotal, tax, total },
      lines: draftLines,
    };
  };

  const bump = (id: string, d: number) =>
    setLines((current) => ({
      ...current,
      [id]: Math.max(sentQuantities[id] ?? 0, (current[id] ?? 0) + d),
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
    setCustomerPhone("");
    setSelectedTableNo(null);
    setPayments([]);
    setPaymentInvoiceId(null);
    setPaymentOrderId(null);
    setPaymentConfirmed(false);
    setPaymentOpen(false);
    setTendered(0);
    setCashReceived(0);
    setLastKitchenJobIds([]);
    setPrintNotice(message);
    setPrintNoticeType(noticeType);
  };

  const startNewOrder = () => {
    clearCurrentOrder("New order ready.");
    setSearchQuery("");
    setActiveOrdersOpen(false);
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
    if (!paymentMethods.length) {
      setPrintNotice("No payment methods are configured for this restaurant.");
      setPrintNoticeType("warning");
      return;
    }
    if (selectedChannel?.requiresTable) {
      if (!orderTable) {
        setTablePickerOpen(true);
        setPrintNotice("Select a table, then send the dine-in order to kitchen before payment.");
        setPrintNoticeType("warning");
        return;
      }
      if (!activeOrderKitchenSent) {
        setPrintNotice("Send the dine-in order to kitchen before opening payment.");
        setPrintNoticeType("warning");
        return;
      }
      if (hasUnsentItems) {
        setPrintNotice("Send the new items as a kitchen amendment before taking payment.");
        setPrintNoticeType("warning");
        return;
      }
    }

    const preferredDefault =
      (selectedChannel?.isExternallyPaid
        ? paymentMethods.find((method) => method.category === "CREDIT")
        : paymentMethods.find((method) => method.category === "DIGITAL_WALLET")) ??
      paymentMethods[0];
    const defaultMethod =
      [preferredDefault, ...paymentMethods].find(
        (method) => method && paymentMethodAvailability(method).usable,
      ) ?? paymentMethods[0];

    setPaymentMode("full");
    setPaymentMethod(defaultMethod?.id ?? "");
    setTendered(total);
    setCashReceived(total);
    setTenderCurrency(tenant.defaultCurrency);
    setPayments([]);
    setPaymentReference("");
    setCustomerPhone("");
    setPaymentConfirmed(false);
    setPaymentInvoiceId(null);
    setPaymentOrderId(null);
    setPaymentBusy(true);
    try {
      let orderId = activeOrder?.id;
      let optimisticPaymentState = transactionState;

      if (!selectedChannel?.requiresTable) {
        const mustSendToKitchen =
          !activeOrder ||
          !activeOrderKitchenSent ||
          hasUnsentItems;
        if (mustSendToKitchen) {
          const kitchen = await queueKitchenTicketsForTable(orderTable);
          if (!kitchen) throw new Error("The order could not be routed to kitchen.");
          orderId = kitchen.order.id;
          optimisticPaymentState = kitchen.state;
          if (!kitchen.printResult?.jobs.length) {
            throw new Error(
              "Payment was not opened because no KOT/KDS delivery job was created for this order.",
            );
          }
        }
      }

      if (!orderId) {
        throw new Error("Create and send the order to kitchen before payment.");
      }

      const prepared = await mutateTransaction(
        "prepareInvoiceForPayment",
        { orderId },
        () => TransactionEngine.prepareInvoiceForPayment(
          optimisticPaymentState,
          orderId!,
          currentUser.name,
        ),
      );
      const order = prepared?.state.orders.find((candidate) => candidate.id === orderId);
      const bill = prepared?.state.bills.find(
        (candidate) =>
          candidate.orderIds.includes(orderId!) &&
          ["OPEN", "PARTIAL", "PENDING"].includes(candidate.status),
      );
      if (!order) throw new Error("The selected order is no longer available.");
      if (!bill) throw new Error("Seramet could not prepare a payable invoice for this order.");
      if (
        (bill.tenantId ?? activeTenantId) !== activeTenantId ||
        (bill.branchId ?? branchId) !== branchId
      ) {
        throw new Error("The prepared invoice belongs to another restaurant branch.");
      }
      setPaymentOrderId(orderId);
      setPaymentInvoiceId(bill.id);
      setPaymentOpen(true);
    } catch (error) {
      setPrintNotice(cashierErrorMessage(error, "Payment could not be prepared."));
      setPrintNoticeType("warning");
    } finally {
      setPaymentBusy(false);
    }
  };

  const addPayment = async () => {
    const amount = Math.min(due, Math.max(0, tendered || suggestedAmount));
    if (!amount || !selectedPaymentMethod) return;
    const availability = paymentMethodAvailability(selectedPaymentMethod);
    if (!availability.usable) {
      setPrintNotice(availability.reason || `${selectedPaymentMethod.displayName} is unavailable.`);
      setPrintNoticeType("warning");
      return;
    }
    const providerOperation = selectedPaymentMethod.metadata["providerOperation"];
    const referenceRequired =
      selectedPaymentMethod.requiresReference ||
      selectedPaymentMethod.category === "BANK_TRANSFER" ||
      (selectedPaymentMethod.category === "DIGITAL_WALLET" &&
        providerOperation !== "PAYMENT_PROMPT" &&
        providerOperation !== "QR_PAYMENT");
    if (referenceRequired && !paymentReference.trim()) {
      setPrintNotice(`${selectedPaymentMethod.displayName} requires a transaction reference.`);
      setPrintNoticeType("warning");
      return;
    }
    if (providerOperation === "PAYMENT_PROMPT" && !customerPhone.trim()) {
      setPrintNotice("Enter the customer's phone number before adding the M-Pesa STK payment.");
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
        ...(quote ? { fxQuote: quote } : {}),
        ...(reference ? { reference } : {}),
        status: "staged",
      },
    ]);
    setTendered(Math.max(0, total - paid - amount));
    setCashReceived(Math.max(0, total - paid - amount));
    setTenderCurrency(tenant.defaultCurrency);
    setPaymentReference("");
  };

  const removePayment = (id: string) => {
    setPayments((current) =>
      current.filter(
        (payment) =>
          payment.id !== id || (payment.status !== "staged" && payment.status !== "failed"),
      ),
    );
    setPaymentConfirmed(false);
  };

  const updatePaymentStatus = (
    id: string,
    status: "staged" | "confirmed" | "pending" | "failed",
    error?: string,
  ) => {
    setPayments((current) =>
      current.map((payment) =>
        payment.id === id
          ? {
              ...payment,
              status,
              ...(error ? { error } : {}),
            }
          : payment,
      ),
    );
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

  const queueKitchenTicketsForTable = async (tableNo = orderTable) => {
    if (!items.length) return null;
    if (selectedChannel?.requiresTable && !tableNo) {
      throw new Error("Select a table before sending a dine-in order to kitchen.");
    }
    if (!profile) {
      throw new Error(
        `Kitchen routing is unavailable: ${configurationError ?? "configure a KDS or printer route first"}.`,
      );
    }

    const knownOrderIds = new Set(transactionState.orders.map((order) => order.id));
    const sentLineIds = new Set(
      activeOrder?.lines.filter((line) => line.sentAt).map((line) => line.id) ?? [],
    );
    const amendmentType = sentLineIds.size > 0 ? "ADDITION" : "NEW";
    const draft = buildTransactionDraft(tableNo);
    const preflight = SerametPrintService.createProductionTicketJobs(
      profile,
      buildPrintOrder(tableNo),
      printJobs,
      amendmentType,
    );
    if (!preflight.jobs.length) {
      throw new Error(
        `No KOT/KDS route is available for these items. ${preflight.skipped[0] ?? "Check Seramet Printers before sending."}`,
      );
    }

    const resultState = await mutateTransaction("upsertAndSendKitchen", {
      ...(activeOrder?.id ? { orderId: activeOrder.id } : {}),
      draft,
    });
    const authoritativeOrder = activeOrder?.id
      ? resultState?.state.orders.find((candidate) => candidate.id === activeOrder.id)
      : resultState?.state.orders.find((candidate) => !knownOrderIds.has(candidate.id));
    if (!authoritativeOrder || !resultState?.state) {
      throw new Error("Kitchen order did not receive an authoritative identity.");
    }
    const ticketLines = authoritativeOrder.lines.filter(
      (line) => line.sentAt && !sentLineIds.has(line.id),
    );
    if (ticketLines.length === 0) {
      setActiveOrderId(authoritativeOrder.id);
      setSelectedTableNo(authoritativeOrder.table ?? tableNo ?? null);
      setPrintNotice("No new kitchen items require a KOT amendment.");
      setPrintNoticeType("idle");
      return {
        order: authoritativeOrder,
        state: resultState.state,
        printResult: null,
      };
    }

    const printResult = sendKitchenTickets(
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
      amendmentType,
    );
    setLastKitchenJobIds(printResult.jobs.map((job) => job.id));
    setActiveOrderId(authoritativeOrder.id);
    setSelectedTableNo(authoritativeOrder.table ?? tableNo ?? null);
    if (printResult.jobs.length > 0) {
      setPrintNotice(
        amendmentType === "ADDITION"
          ? "Kitchen amendment queued — waiting for delivery confirmation."
          : "Kitchen ticket queued — waiting for delivery confirmation.",
      );
      setPrintNoticeType("idle");
    } else {
      setPrintNotice(
        `Order reached kitchen state, but KOT delivery was not queued: ${printResult.skipped[0] ?? "check printer/KDS routing"}.`,
      );
      setPrintNoticeType("warning");
    }
    return {
      order: authoritativeOrder,
      state: resultState.state,
      printResult,
    };
  };

  const queueKitchenTickets = () => {
    if (!items.length) return;
    if (selectedChannel?.requiresTable && !orderTable) {
      setTablePickerOpen(true);
      setPrintNotice("Select a table before sending this dine-in order to kitchen.");
      setPrintNoticeType("warning");
      return;
    }
    void queueKitchenTicketsForTable().catch((error: unknown) => {
      setPrintNotice(cashierErrorMessage(error, "The kitchen order could not be sent."));
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
    if (paid < total && paymentMode !== "partial") return;
    if (paymentSubmitRef.current || paymentBusy) return;
    if (!paymentInvoiceId || !paymentOrderId) {
      setPrintNotice("Payment session expired. Reopen payment for this invoice.");
      setPrintNoticeType("warning");
      return;
    }
    const stagedPayments = payments.filter((payment) => payment.status === "staged");
    if (!stagedPayments.length) {
      setPrintNotice("Add a payment component before confirming.");
      setPrintNoticeType("warning");
      return;
    }

    paymentSubmitRef.current = true;
    setPaymentBusy(true);
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
        throw new Error("Payment session expired. Reopen payment for this invoice.");
      }

      const providerJobs: Array<{
        paymentId: string;
        methodName: string;
        invoiceId: string;
        methodCode: string;
        amount: number;
        operation: "prompt" | "qr";
      }> = [];
      let hasPendingVerification = payments.some((payment) => payment.status === "pending");
      let committedThisAttempt = 0;

      for (const payment of stagedPayments) {
        const method = paymentMethods.find((item) => item.id === payment.methodId);
        if (!method) {
          updatePaymentStatus(payment.id, "failed", "Payment method is no longer configured.");
          setPrintNotice(`${payment.method} is no longer configured. Choose another method.`);
          setPrintNoticeType("warning");
          return;
        }
        const availability = paymentMethodAvailability(method);
        if (!availability.usable) {
          updatePaymentStatus(payment.id, "failed", availability.reason);
          setPrintNotice(availability.reason || `${method.displayName} is unavailable.`);
          setPrintNoticeType("warning");
          return;
        }

        const providerOperation = method.metadata["providerOperation"];
        if (providerOperation === "PAYMENT_PROMPT" || providerOperation === "QR_PAYMENT") {
          providerJobs.push({
            paymentId: payment.id,
            methodName: method.displayName,
            invoiceId: bill.id,
            methodCode: method.code,
            amount: payment.amount,
            operation: providerOperation === "QR_PAYMENT" ? "qr" : "prompt",
          });
          hasPendingVerification = true;
          continue;
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
          const pendingMethod = ["BANK_TRANSFER", "DIGITAL_WALLET", "CREDIT"].includes(
            method.category,
          );
          updatePaymentStatus(payment.id, pendingMethod ? "pending" : "confirmed");
          committedThisAttempt += 1;
          if (pendingMethod) hasPendingVerification = true;
        } catch (error) {
          const message = cashierErrorMessage(error, `${method.displayName} could not be recorded.`);
          updatePaymentStatus(payment.id, "failed", message);
          await syncFromBackend().catch(() => undefined);
          setPrintNotice(
            committedThisAttempt
              ? `${committedThisAttempt} payment component(s) were recorded, but ${method.displayName} failed: ${message}`
              : message,
          );
          setPrintNoticeType("warning");
          return;
        }
      }

      for (const job of providerJobs) {
        try {
          await initiateProviderPayment(job);
          updatePaymentStatus(job.paymentId, "pending");
          committedThisAttempt += 1;
        } catch (error) {
          const message = cashierErrorMessage(error, `${job.methodName} request failed.`);
          updatePaymentStatus(job.paymentId, "failed", message);
          await syncFromBackend().catch(() => undefined);
          setPrintNotice(
            committedThisAttempt
              ? `${committedThisAttempt} payment component(s) were recorded, but ${job.methodName} failed: ${message}`
              : message,
          );
          setPrintNoticeType("warning");
          return;
        }
      }

      if (providerJobs.length) nextState = (await syncFromBackend())?.state ?? nextState;
      const updatedBill = nextState?.bills.find((candidate) => candidate.id === bill.id);
      const completedInvoice = updatedBill?.paymentStatus === "PAID";
      const partialInvoice = updatedBill?.paymentStatus === "PARTIAL";

      if (
        receiptOptions["Print"] &&
        completedInvoice &&
        !hasPendingVerification &&
        backendStatus === "synced"
      ) {
        const receipt = nextState?.receipts.find((candidate) => candidate.invoiceId === bill.id);
        const paidOrder = nextState?.orders.find((candidate) => candidate.id === paymentOrderId);
        if (!receipt || !paidOrder || !updatedBill) {
          throw new Error("Payment is confirmed, but the authoritative receipt is not available yet.");
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
            ? "Payment confirmed. Receipt queued for the configured customer printer."
            : `Payment confirmed without receipt printing: ${result.skipped[0] ?? "printing is not configured"}.`,
        );
        setPrintNoticeType(result.jobs.length > 0 ? "success" : "warning");
      } else if (backendStatus !== "synced" && completedInvoice) {
        setPrintNotice(`Cash sale saved offline. ${pendingSyncCount + 1} command(s) pending sync.`);
        setPrintNoticeType("warning");
      } else if (hasPendingVerification) {
        setPrintNotice(
          providerJobs.length
            ? "Payment request sent. The invoice remains pending until provider confirmation."
            : "Payment component recorded for verification. No final receipt has been created.",
        );
        setPrintNoticeType("warning");
      } else if (partialInvoice) {
        setPrintNotice("Partial payment recorded. The invoice remains open for the balance.");
        setPrintNoticeType("success");
      }

      setPaymentConfirmed(
        Boolean((completedInvoice || (paymentMode === "partial" && partialInvoice)) && !hasPendingVerification),
      );
    } catch (error) {
      setPrintNotice(cashierErrorMessage(error, "Payment could not be completed."));
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

  const selectOrOpenTable = (table: (typeof floorTables)[number]) => {
    if (table.orderId) {
      if (table.orderId !== activeOrderId && hasUnsentItems) {
        setPrintNotice(
          `Table ${table.no} already has ${table.orderId}. Your current unsent items were kept; start a new order or send/hold them before switching.`,
        );
        setPrintNoticeType("warning");
        return;
      }
      setActiveOrderId(table.orderId);
      setSelectedTableNo(table.no);
      setTablePickerOpen(false);
      setPrintNotice(`Opened ${table.orderId} for Table ${table.no}.`);
      setPrintNoticeType("idle");
      return;
    }
    if (channelLocked && activeOrder?.table && activeOrder.table !== table.no) {
      setPrintNotice("Table assignment is locked after an order has been sent to production.");
      setPrintNoticeType("warning");
      return;
    }
    setSelectedTableNo(table.no);
    setTablePickerOpen(false);
    setPrintNotice(`Table ${table.no} selected. Review the order, then press Send kitchen.`);
    setPrintNoticeType("idle");
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
          <Status>{workflowState}</Status>
          <span className="text-[13px] text-muted-foreground">
            {branch} - {role} {currentUser.name}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <button
            type="button"
            disabled={!selectedChannel?.requiresTable}
            onClick={() => setTablePickerOpen(true)}
            className={cn(
              "rounded-md border px-2 py-1 text-[12px] font-semibold transition-colors",
              orderTable
                ? "border-primary/30 bg-accent text-accent-foreground"
                : "border-border bg-secondary",
              !selectedChannel?.requiresTable && "cursor-default opacity-70",
            )}
          >
            {selectedChannel?.requiresTable
              ? orderTable
                ? `Table ${orderTable}`
                : "Select table"
              : "No table required"}
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
            <Clock className="h-3.5 w-3.5" /> {clockLabel}
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
                onClick={() => {
                  if (!channelLocked) setOrderSource(source.id);
                }}
                disabled={channelLocked && orderSource !== source.id}
                title={channelLocked ? "Order channel is locked after kitchen send" : undefined}
                className={cn(
                  "min-h-9 shrink-0 rounded-md px-3 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
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
              onClick={startNewOrder}
              className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-[12px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New order
            </button>
            <button
              type="button"
              onClick={() => setActiveOrdersOpen((open) => !open)}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-[12px] font-bold transition-colors",
                activeOrdersOpen
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-foreground hover:bg-secondary/80",
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
                <div className="px-2 py-1 text-[12px] font-bold">Active orders</div>
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
                        {order.table ? `Table ${order.table}` : order.channel} - {order.customer} -{" "}
                        {order.lines.length} lines - {ksh(order.total)}
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
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const exact = branchMenu.find((product) =>
                  [product.barcode, product.sku, product.itemCode].some(
                    (value) =>
                      value?.trim().toLocaleLowerCase() ===
                      searchQuery.trim().toLocaleLowerCase(),
                  ),
                );
                if (!exact || exact.out) return;
                event.preventDefault();
                bump(exact.id, 1);
                setSearchQuery("");
              }}
              placeholder="Search dishes or scan barcode"
              className="w-full bg-transparent text-[13px] outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          {isOnlineSource && (
            <div className="mb-3 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-[12px] font-semibold text-info">
              {selectedChannel?.displayName} selected: menu cards now use online prices and
              settlement defaults to partner credit where required.
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
          {branchMenu.length > 0 && visible.length === 0 && (
            <div className="mb-3 rounded-lg border border-dashed border-border bg-card px-3 py-4 text-[12px] text-muted-foreground">
              No menu items match “{searchQuery}” in {cat}.
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
                          disabled={p.out || qty <= (sentQuantities[p.id] ?? 0)}
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
                Tap a dish to start the order.
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
                      disabled={l.qty <= sentQuantity}
                      className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] outline-none focus:border-primary"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => bump(l.p.id, -1)}
                      disabled={l.qty <= sentQuantity}
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
              <Btn onClick={holdOrder} disabled={!items.length}>Hold</Btn>
              {canPrintBill ? (
                <>
                  <Btn onClick={() => moveOrderToInvoice(true)}>Print bill</Btn>
                  <Btn onClick={() => moveOrderToInvoice(false)}>
                    <FileText className="h-4 w-4" />
                    Invoice
                  </Btn>
                </>
              ) : (
                <Btn className="col-span-2">More</Btn>
              )}
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1.4fr] gap-2">
              <Btn onClick={queueKitchenTickets} disabled={!items.length}>Send kitchen</Btn>
              <Btn
                variant="primary"
                className="h-11 text-[15px]"
                onClick={() => void openPayment()}
                disabled={paymentBusy || !items.length || !dineInPaymentReady}
                title={
                  !dineInPaymentReady && selectedChannel?.requiresTable
                    ? "Select a table and send all items to kitchen first"
                    : undefined
                }
              >
                {paymentBusy
                  ? "Preparing..."
                  : !dineInPaymentReady && selectedChannel?.requiresTable
                    ? "Send kitchen first"
                    : `Pay ${ksh(total)}`}
              </Btn>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {paymentMethods.map((method) => {
                const availability = paymentMethodAvailability(method);
                return (
                  <span
                    key={method.id}
                    className={cn(
                      "rounded border px-1.5 py-0.5",
                      availability.usable
                        ? "border-border"
                        : "border-warning/30 bg-warning-soft text-warning",
                    )}
                  >
                    {method.displayName}: {availability.label}
                  </span>
                );
              })}
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
                    {lastKitchenJobIds.length
                      ? "Kitchen delivery status is tracked here until confirmed or failed."
                      : "Operational feedback and printing state appear here."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <Dialog open={tablePickerOpen} onOpenChange={setTablePickerOpen}>
        <DialogContent className="max-w-[920px] border-border bg-card">
          <DialogHeader>
            <DialogTitle>Select table</DialogTitle>
            <DialogDescription>
              Choose a free table for this order, or open the existing order on an occupied table.
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {floorTables.map((table) => (
                  <button
                    key={table.no}
                    type="button"
                    disabled={table.state === "Unavailable"}
                    onClick={() => selectOrOpenTable(table)}
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
                      {table.orderId && (
                        <div className="flex justify-between gap-2">
                          <span>Order</span>
                          <span className="num truncate font-semibold text-foreground">
                            {table.orderId}
                          </span>
                        </div>
                      )}
                      {table.orderStatus && (
                        <div className="flex justify-between gap-2">
                          <span>Status</span>
                          <span className="font-semibold text-foreground">
                            {table.orderStatus.replaceAll("_", " ")}
                          </span>
                        </div>
                      )}
                      {table.amount !== undefined && (
                        <div className="flex justify-between">
                          <span>Open value</span>
                          <span className="num font-semibold text-foreground">
                            {ksh(table.amount)}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
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
                Selecting a free table does not send the order automatically. Review the order,
                then press Send kitchen. Occupied tables open their existing order instead of
                creating a duplicate.
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
                        <span
                          className={cn(
                            "mt-0.5 block text-[10px] font-semibold uppercase",
                            payment.status === "failed"
                              ? "text-danger"
                              : payment.status === "confirmed"
                                ? "text-success"
                                : payment.status === "pending"
                                  ? "text-warning"
                                  : "text-muted-foreground",
                          )}
                        >
                          {payment.status}
                        </span>
                        {payment.error && (
                          <span className="mt-0.5 block text-[10px] font-normal text-danger">
                            {payment.error}
                          </span>
                        )}
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
                      {!paymentConfirmed &&
                        (payment.status === "staged" || payment.status === "failed") && (
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
                    {paid >= total ? (
                      <>
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
                              <span className="text-success">
                                {option === "Print" ? "Requested" : "Selected"}
                              </span>
                            </div>
                          ))}
                        {Object.values(receiptOptions).every((enabled) => !enabled) && (
                          <div className="rounded-md bg-card px-3 py-2 font-semibold">
                            Receipt skipped
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="rounded-md bg-card px-3 py-2 font-semibold text-warning">
                        Invoice remains partially paid. A final receipt is not issued yet.
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
                      {paymentMethods.map((method) => {
                        const availability = paymentMethodAvailability(method);
                        return (
                          <button
                            key={method.id}
                            onClick={() => setPaymentMethod(method.id)}
                            disabled={!availability.usable}
                            title={availability.reason || undefined}
                            className={cn(
                              "min-h-12 rounded-md border px-3 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50",
                              paymentMethod === method.id
                                ? "border-primary bg-accent text-accent-foreground"
                                : "border-border hover:bg-secondary",
                            )}
                          >
                            <span className="block">{method.displayName}</span>
                            <span className="mt-0.5 block text-[10px] font-medium text-muted-foreground">
                              {availability.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
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
                        setPaymentMode("split");
                        setTendered(Math.ceil(due / 2));
                        setCashReceived(Math.ceil(due / 2));
                      }}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-[13px] hover:bg-secondary",
                        paymentMode === "split"
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border",
                      )}
                    >
                      <span className="block font-semibold">Split payment</span>
                      <span className="text-[12px] text-muted-foreground">
                        Add another method or guest split
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setPaymentMode("partial");
                        setTendered(Math.ceil(due / 2));
                        setCashReceived(Math.ceil(due / 2));
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
                      disabled={
                        paymentBusy ||
                        !selectedPaymentMethod ||
                        !paymentMethodAvailability(selectedPaymentMethod).usable
                      }
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
                  {selectedPaymentMethod &&
                    (selectedPaymentMethod.requiresReference ||
                      selectedPaymentMethod.category === "BANK_TRANSFER" ||
                      (selectedPaymentMethod.category === "DIGITAL_WALLET" &&
                        selectedPaymentMethod.metadata["providerOperation"] !== "PAYMENT_PROMPT" &&
                        selectedPaymentMethod.metadata["providerOperation"] !== "QR_PAYMENT")) && (
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
                  {selectedPaymentMethod?.metadata["providerOperation"] === "PAYMENT_PROMPT" && (
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
                  {paid < total && paymentMode !== "partial" && (
                    <div className="rounded-md bg-warning-soft px-3 py-2 text-[12px] font-semibold text-warning">
                      Add {ksh(total - paid)} more before confirming, or switch to partial payment.
                    </div>
                  )}
                  <div className="flex justify-end gap-2 border-t border-border pt-4">
                    <Btn onClick={() => setPaymentOpen(false)}>Cancel</Btn>
                    <Btn
                      variant="primary"
                      onClick={confirmPayment}
                      disabled={
                        paymentBusy ||
                        payments.every((payment) => payment.status !== "staged") ||
                        (paid < total && paymentMode !== "partial")
                      }
                    >
                      Confirm{" "}
                      {paymentMode === "partial"
                        ? "partial"
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
    </AppShell>
  );
}

function cashierErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/open a cash drawer/i.test(message)) {
    return "Cash is unavailable: open a cash drawer in Payment Control, then retry.";
  }
  if (/changed on another terminal|conflict/i.test(message)) {
    return "This order changed on another terminal. Reopen it before continuing.";
  }
  if (/printer|KOT|KDS|routing/i.test(message)) {
    return message;
  }
  if (/reference/i.test(message)) {
    return message;
  }
  return message || fallback;
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
