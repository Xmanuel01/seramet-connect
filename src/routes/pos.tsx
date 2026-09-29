import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Status } from "@/components/app/ui";
import { ksh, products, serametPosTerminal, tables as floorTables } from "@/data/mock";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { TransactionEngine, type PaymentMethod } from "@/lib/transaction-engine";
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

function POS() {
  const [cat, setCat] = useState("Popular");
  const [orderSource, setOrderSource] = useState<
    "Dine-In" | "Take Away" | "Uber Eats" | "Glovo" | "Bolt Food"
  >("Dine-In");
  const [lines, setLines] = useState<Record<string, number>>({ p1: 2, p6: 1, p8: 2 });
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("M-Pesa");
  const [paymentMode, setPaymentMode] = useState<"full" | "split" | "partial">("full");
  const [tendered, setTendered] = useState(0);
  const [payments, setPayments] = useState<
    { id: string; method: string; amount: number; reference?: string }[]
  >([]);
  const [mpesaCode, setMpesaCode] = useState("");
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
  const { state: transactionState, apply: applyTransaction } = useTransactionEngine();
  const { sendKitchenTickets, printCustomerDocument } = useSerametPrintQueue(
    serametPosTerminal.branch,
  );

  const isOnlineSource = ["Uber Eats", "Glovo", "Bolt Food"].includes(orderSource);
  const billedOrderIds = useMemo(
    () => new Set(transactionState.bills.flatMap((bill) => bill.orderIds)),
    [transactionState.bills],
  );
  const activePosOrders = useMemo(
    () =>
      transactionState.orders
        .filter((order) => order.branch === serametPosTerminal.branch)
        .filter((order) => ["HELD", "OPEN", "SENT_TO_KITCHEN"].includes(order.status))
        .filter((order) => !billedOrderIds.has(order.id)),
    [billedOrderIds, transactionState.orders],
  );
  const activeOrder = activePosOrders.find((order) => order.id === activeOrderId) ?? null;
  const canPrintBill = activeOrder?.status === "SENT_TO_KITCHEN";
  const branchMenu = useMemo(
    () =>
      products
        .filter((product) => product.branchAvailability?.[serametPosTerminal.branch] !== false)
        .map((product) => {
          const branchPrice = product.branchPrices?.[serametPosTerminal.branch] ?? product.price;
          return {
            ...product,
            price: isOnlineSource ? Math.round(branchPrice * 1.12) : branchPrice,
          };
        }),
    [isOnlineSource],
  );

  const posCategories = useMemo(() => {
    const importedCategories = Array.from(new Set(branchMenu.map((product) => product.category)));
    return ["Popular", ...importedCategories];
  }, [branchMenu]);

  useEffect(() => {
    if (!posCategories.includes(cat)) setCat("Popular");
  }, [cat, posCategories]);

  useEffect(() => {
    if (!activeOrder) return;
    setOrderSource(
      activeOrder.channel === "Online"
        ? "Uber Eats"
        : activeOrder.channel === "Delivery"
          ? "Take Away"
          : activeOrder.channel,
    );
    setKitchenNote(activeOrder.kitchenNote ?? "");
    setLines(
      Object.fromEntries(
        activeOrder.lines
          .filter((line) => line.productId)
          .map((line) => [line.productId!, line.quantity]),
      ),
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
  }, [activeOrder]);

  const visible = branchMenu.filter((p) => (cat === "Popular" ? p.popular : p.category === cat));
  const items = Object.entries(lines)
    .map(([id, qty]) => ({ p: branchMenu.find((x) => x.id === id)!, qty }))
    .filter((l) => l.p && l.qty > 0);
  const subtotal = items.reduce((s, l) => s + l.p.price * l.qty, 0);
  const tax = Math.round(subtotal * 0.16);
  const total = subtotal + tax;
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const due = Math.max(0, total - paid);
  const change = Math.max(0, paid - total);
  const suggestedAmount = paymentMode === "split" ? Math.ceil(due / 2) : due;
  const predictedNextOrderId = () =>
    `ORD-${String(transactionState.orders.length + 1).padStart(5, "0")}`;
  const predictedNextInvoiceId = () =>
    `INV-${String(transactionState.bills.length + 1).padStart(5, "0")}`;
  const predictedNextReceiptId = () =>
    `RCP-${String(transactionState.receipts.length + 1).padStart(5, "0")}`;
  const currentOrderNumber = activeOrder?.id ?? predictedNextOrderId();
  const orderTable = activeOrder?.table ?? selectedTableNo ?? undefined;
  const orderContextLabel = activeOrder
    ? `${activeOrder.status.replaceAll("_", " ")} - ${activeOrder.customer}`
    : isOnlineSource
      ? `${orderSource} channel order`
      : orderSource === "Take Away"
        ? "Take away order"
        : selectedTableNo
          ? `Table ${selectedTableNo} selected`
          : "Select table when sending to kitchen";

  const buildPrintOrder = (tableNo = orderTable) => ({
    orderId: currentOrderNumber,
    branch: serametPosTerminal.branch,
    terminalId: serametPosTerminal.id,
    table: tableNo ?? "-",
    orderType: isOnlineSource ? "Online" : orderSource,
    requestedBy: serametPosTerminal.cashier,
    cashier: serametPosTerminal.cashier,
    waiter: serametPosTerminal.cashier,
    createdAt: "12:46",
    customer: isOnlineSource ? orderSource : tableNo ? `Table ${tableNo}` : "Walk-in Customer",
    kitchenNote,
    tillNumber: "4235484",
    receiptNumber: predictedNextReceiptId(),
    invoiceNumber: predictedNextInvoiceId(),
    lines: items.map((line) => ({
      id: line.p.id,
      name: line.p.name,
      category: line.p.category,
      quantity: line.qty,
      unitPrice: line.p.price,
      productionStation: line.p.productionStation ?? "NONE",
      itemNote: itemNotes[line.p.id]?.trim() || undefined,
    })),
    subtotal,
    tax,
    total,
    paid,
    change,
    paymentMethod: payments.map((payment) => payment.method).join(" + ") || paymentMethod,
    paymentBreakdown: payments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
    })),
  });

  const buildTransactionDraft = (tableNo = orderTable) => ({
    branch: serametPosTerminal.branch,
    table: tableNo,
    customer: isOnlineSource
      ? orderSource
      : orderSource === "Take Away"
        ? "Walk-in"
        : tableNo
          ? `Table ${tableNo}`
          : "Unassigned table",
    channel: isOnlineSource ? ("Online" as const) : orderSource,
    cashier: serametPosTerminal.cashier,
    waiter: serametPosTerminal.cashier,
    kitchenNote,
    lines: items.map((line) => ({
      id: `${line.p.id}-${Date.now()}`,
      productId: line.p.id,
      name: line.p.name,
      category: line.p.category,
      quantity: line.qty,
      unitPrice: line.p.price,
      productionStation: line.p.productionStation ?? "NONE",
      itemNote: itemNotes[line.p.id]?.trim() || undefined,
    })),
  });

  const bump = (id: string, d: number) =>
    setLines((l) => ({ ...l, [id]: Math.max(0, (l[id] ?? 0) + d) }));

  const clearCurrentOrder = (
    message = "Ready for the next POS order.",
    noticeType: "idle" | "success" | "warning" = "idle",
  ) => {
    setActiveOrderId(null);
    setLines({});
    setKitchenNote("");
    setItemNotes({});
    setMpesaCode("");
    setSelectedTableNo(null);
    setPrintNotice(message);
    setPrintNoticeType(noticeType);
  };

  const createOrUpdateActiveOrder = (targetStatus: "HELD" | "OPEN", tableNo = orderTable) => {
    const draft = buildTransactionDraft(tableNo);
    const orderId = activeOrder?.id ?? predictedNextOrderId();
    applyTransaction((current) => {
      if (activeOrder?.id && current.orders.some((order) => order.id === activeOrder.id)) {
        return TransactionEngine.updateOrderDraft(
          current,
          activeOrder.id,
          draft,
          serametPosTerminal.cashier,
        );
      }
      return targetStatus === "HELD"
        ? TransactionEngine.holdOrder(current, draft)
        : TransactionEngine.createOrder(current, draft, "OPEN");
    });
    return orderId;
  };

  const openPayment = () => {
    setPaymentMode("full");
    setPaymentMethod(isOnlineSource && orderSource !== "Uber Eats" ? "Credit" : "M-Pesa");
    setTendered(total);
    setPayments([]);
    setMpesaCode("");
    setPaymentConfirmed(false);
    setPaymentOpen(true);
  };

  const addPayment = () => {
    const amount = Math.max(0, Math.round(tendered || suggestedAmount));
    if (!amount) return;
    const reference =
      paymentMethod === "M-Pesa" && mpesaCode.trim()
        ? `MPESA-${mpesaCode.trim().toUpperCase()}`
        : undefined;
    setPayments((current) => [
      ...current,
      { id: `${Date.now()}-${current.length}`, method: paymentMethod, amount, reference },
    ]);
    setTendered(Math.max(0, total - paid - amount));
    if (paymentMethod === "M-Pesa") setMpesaCode("");
  };

  const removePayment = (id: string) => {
    setPayments((current) => current.filter((payment) => payment.id !== id));
    setPaymentConfirmed(false);
  };

  const holdOrder = () => {
    if (!items.length) return;
    const orderId = createOrUpdateActiveOrder("HELD");
    clearCurrentOrder("Order held in active orders.");
  };

  const queueKitchenTicketsForTable = (tableNo = orderTable) => {
    if (!items.length) return;
    const amendmentType = activeOrder?.status === "SENT_TO_KITCHEN" ? "ADDITION" : "NEW";
    const orderId = createOrUpdateActiveOrder("OPEN", tableNo);
    const result = sendKitchenTickets({ ...buildPrintOrder(tableNo), orderId }, amendmentType);
    applyTransaction((current) => {
      let next = current;
      if (next.orders.some((order) => order.id === orderId)) {
        next = TransactionEngine.updateOrderDraft(
          next,
          orderId,
          buildTransactionDraft(tableNo),
          serametPosTerminal.cashier,
        );
      }
      return TransactionEngine.sendToKitchen(next, orderId, serametPosTerminal.cashier);
    });
    clearCurrentOrder("Kitchen Order Ticket Printed", "success");
  };

  const queueKitchenTickets = () => {
    if (!items.length) return;
    if (orderSource === "Dine-In" && !activeOrder?.table) {
      setTablePickerOpen(true);
      return;
    }
    queueKitchenTicketsForTable();
  };

  const moveOrderToInvoice = (printBill: boolean) => {
    if (!activeOrder || activeOrder.status !== "SENT_TO_KITCHEN") {
      setPrintNotice("Send the order to kitchen before printing a bill or creating an invoice.");
      setPrintNoticeType("warning");
      return;
    }
    const orderForPrint = buildPrintOrder();
    applyTransaction((current) => {
      const next = TransactionEngine.updateOrderDraft(
        current,
        activeOrder.id,
        buildTransactionDraft(),
        serametPosTerminal.cashier,
      );
      return TransactionEngine.requestBill(next, activeOrder.id, serametPosTerminal.cashier);
    });
    if (printBill) {
      const result = printCustomerDocument(orderForPrint, "BILL");
      clearCurrentOrder("Customer bill printed and moved to Invoices.", "success");
      return;
    }
    clearCurrentOrder(`${activeOrder.id} moved to Invoices without printing a customer bill.`);
  };

  const toggleReceipt = (option: string) => {
    if (option === "No receipt") {
      setReceiptOptions({ Print: false, WhatsApp: false, Email: false });
      return;
    }
    setReceiptOptions((current) => ({ ...current, [option]: !current[option] }));
  };

  const confirmPayment = () => {
    if (paid >= total || paymentMode === "partial") {
      applyTransaction((current) => {
        const draft = buildTransactionDraft();
        let next = current;
        let orderId = activeOrder?.id;
        if (orderId && next.orders.some((order) => order.id === orderId)) {
          next = TransactionEngine.updateOrderDraft(
            next,
            orderId,
            draft,
            serametPosTerminal.cashier,
          );
        } else {
          next = TransactionEngine.createOrder(next, draft, "OPEN");
          orderId = next.orders[0]!.id;
        }
        if (!orderId) return next;
        next = TransactionEngine.sendToKitchen(next, orderId, serametPosTerminal.cashier);
        next = TransactionEngine.requestBill(next, orderId, serametPosTerminal.cashier);
        const bill = next.bills.find((item) => item.orderIds.includes(orderId));
        if (!bill) return next;
        payments.forEach((payment) => {
          const method = payment.method as PaymentMethod | string;
          if (method === "Cash") {
            next = TransactionEngine.recordCashPayment(next, bill.id, {
              received: payment.amount,
              cashier: serametPosTerminal.cashier,
              terminal: serametPosTerminal.id,
            });
          } else if (method === "Card") {
            next = TransactionEngine.recordCardPayment(next, bill.id, {
              amount: payment.amount,
              reference: `CARD-${Date.now()}`,
              cashier: serametPosTerminal.cashier,
              terminal: "CARD-WEST-01",
              acquirer: "Card Acquirer",
              batch: "BATCH-01",
            });
          } else if (method === "Bank") {
            next = TransactionEngine.recordBankPayment(next, bill.id, {
              amount: payment.amount,
              reference: `BANK-${Date.now()}`,
              cashier: serametPosTerminal.cashier,
              bankAccount: "Mona Swahili Operating",
              sender: "Customer",
            });
          } else if (method === "Customer account" || method === "Credit") {
            next = TransactionEngine.applyPayment(next, bill.id, {
              amount: payment.amount,
              method: "CUSTOMER_CREDIT",
              provider: isOnlineSource ? `${orderSource} Credit` : "Customer Credit",
              reference: `${isOnlineSource ? orderSource.toUpperCase().replaceAll(" ", "-") : "CREDIT"}-${Date.now()}`,
              cashier: serametPosTerminal.cashier,
              terminal: serametPosTerminal.id,
              reconciliationStatus: "RECONCILED",
              settlementStatus: "NOT_REQUIRED",
            });
          } else {
            next = TransactionEngine.recordManualTillPayment(next, bill.id, {
              amount: payment.amount,
              reference: payment.reference ?? `MPESA-${Date.now()}`,
              cashier: serametPosTerminal.cashier,
              terminal: serametPosTerminal.id,
            });
          }
        });
        return next;
      });
      if (receiptOptions.Print) {
        const result = printCustomerDocument(buildPrintOrder(), "RECEIPT");
        setPrintNotice("Receipt printed.");
        setPrintNoticeType("success");
      }
      setPaymentConfirmed(true);
    }
  };

  const closePaidOrder = () => {
    setActiveOrderId(null);
    setLines({});
    setKitchenNote("");
    setItemNotes({});
    setMpesaCode("");
    setPayments([]);
    setTendered(0);
    setPaymentConfirmed(false);
    setPaymentOpen(false);
  };

  return (
    <AppShell
      bare
      lockedContext={{
        role: serametPosTerminal.role,
        companyName: serametPosTerminal.companyName,
        branch: serametPosTerminal.branch,
        userName: serametPosTerminal.cashier,
      }}
    >
      <div className="flex flex-col gap-3 border-b border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[13px] font-extrabold uppercase tracking-[0.14em]">
            Seramet POS
          </span>
          <Status>Occupied</Status>
          <span className="text-[13px] text-muted-foreground">
            {serametPosTerminal.branch} - {serametPosTerminal.role} {serametPosTerminal.cashier}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Status>Present</Status>
          <span className="rounded-md bg-secondary px-2 py-1 text-[12px] font-semibold">
            {orderTable ? `Table ${orderTable}` : "Table not selected"}
          </span>
          <span className="rounded-md bg-secondary px-2 py-1 text-[12px] font-semibold">
            {orderSource}
          </span>
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <Wifi className="h-3.5 w-3.5" /> Online
          </span>
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> 12:46
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
                {c === "Popular"
                  ? branchMenu.filter((item) => item.popular).length
                  : branchMenu.filter((item) => item.category === c).length}{" "}
                items
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0 p-4">
          <div className="relative mb-2 flex gap-1.5 overflow-visible rounded-lg border border-border bg-card p-1.5">
            {(["Dine-In", "Take Away", "Uber Eats", "Glovo", "Bolt Food"] as const).map(
              (source) => (
                <button
                  key={source}
                  onClick={() => setOrderSource(source)}
                  className={cn(
                    "min-h-9 shrink-0 rounded-md px-3 text-[12px] font-semibold transition-colors",
                    orderSource === source
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  {source}
                </button>
              ),
            )}
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
                        {order.customer} - {order.lines.length} items - {ksh(order.total)}
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
              placeholder="Search dishes or scan barcode"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </div>
          {isOnlineSource && (
            <div className="mb-3 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-[12px] font-semibold text-info">
              {orderSource} selected: menu cards now use online prices and settlement defaults to
              partner credit where required.
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
                        {p.out ? "86'd" : `${p.prep} min`}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-muted-foreground">
                        {p.productionStation ?? "NONE"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          disabled={p.out || qty === 0}
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
            {items.map((l) => (
              <div key={l.p.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{l.p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{ksh(l.p.price)} each</div>
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
                    className="grid h-7 w-7 place-items-center rounded-md border border-border"
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
            ))}
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
                <dt>VAT 16%</dt>
                <dd className="num">{ksh(tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 text-[16px] font-bold">
                <dt>Total</dt>
                <dd className="num">{ksh(subtotal + tax)}</dd>
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
                <Btn className="col-span-2">More</Btn>
              )}
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1.4fr] gap-2">
              <Btn onClick={queueKitchenTickets}>Send kitchen</Btn>
              <Btn variant="primary" className="h-11 text-[15px]" onClick={openPayment}>
                Pay {ksh(total)}
              </Btn>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              {["M-Pesa", "Cash", "Card", "Bank", "Credit", "Split"].map((m) => (
                <span key={m} className="rounded border border-border px-1.5 py-0.5">
                  {m}
                </span>
              ))}
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
                    Print routing continues in the background.
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
              Choose the guest table before sending Order {currentOrderNumber} to kitchen.
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
                    onClick={() => {
                      setSelectedTableNo(table.no);
                      setTablePickerOpen(false);
                      queueKitchenTicketsForTable(table.no);
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
                  <dt className="text-muted-foreground">VAT</dt>
                  <dd className="num font-semibold">{ksh(tax)}</dd>
                </div>
                <div className="flex justify-between border-t border-border pt-2">
                  <dt className="font-semibold">Total</dt>
                  <dd className="num font-bold">{ksh(total)}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-md bg-card px-3 py-2 text-[12px] text-muted-foreground">
                Clicking a table immediately sends this order to kitchen and updates the Orders
                page.
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
              Order {currentOrderNumber} - {orderTable ? `Table ${orderTable}` : orderSource} -{" "}
              {orderSource}
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
                  <dt className="text-muted-foreground">VAT 16%</dt>
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
                      <span className="font-semibold">{payment.method}</span>
                      <span className="num">{ksh(payment.amount)}</span>
                      {!paymentConfirmed && (
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
                      {["M-Pesa", "Cash", "Card", "Bank", "Credit"].map((m) => (
                        <button
                          key={m}
                          onClick={() => setPaymentMethod(m)}
                          className={cn(
                            "h-12 rounded-md border px-3 text-[13px] font-semibold",
                            paymentMethod === m
                              ? "border-primary bg-accent text-accent-foreground"
                              : "border-border hover:bg-secondary",
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => {
                        setPaymentMode("split");
                        setTendered(Math.ceil(due / 2));
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
                      Amount received
                      <input
                        type="number"
                        min={0}
                        value={tendered}
                        onChange={(event) => setTendered(Number(event.target.value))}
                        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold text-foreground outline-none"
                      />
                    </label>
                    <Btn className="self-end" onClick={addPayment}>
                      Add payment
                    </Btn>
                  </div>
                  {paymentMethod === "M-Pesa" && (
                    <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                      M-Pesa transaction code
                      <input
                        value={mpesaCode}
                        onChange={(event) =>
                          setMpesaCode(
                            event.target.value
                              .replace(/[^a-z0-9]/gi, "")
                              .toUpperCase()
                              .slice(0, 12),
                          )
                        }
                        className="h-10 rounded-md border border-border bg-card px-3 text-[13px] font-semibold uppercase text-foreground outline-none"
                        placeholder="TH7X8A1B2C"
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
                    <Btn variant="primary" onClick={confirmPayment}>
                      Confirm {paymentMode === "partial" ? "partial" : paymentMethod} payment
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
