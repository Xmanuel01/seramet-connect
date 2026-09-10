import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChefHat,
  CircleDot,
  Download,
  Gift,
  ReceiptText,
  Share2,
  XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { GuestButton, GuestError, GuestLoading, GuestMoney, GuestShell } from "@/guest/guest-ui";
import { guestRequest, readGuestSession, useGuestQuery } from "@/guest/use-guest";
import { formatMinor } from "@/payments/money";

type TrackingOrder = {
  reference: string;
  status: string;
  serviceMode: string;
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
  total: { amountMinor: number; currency: string };
  outstanding: { amountMinor: number; currency: string };
  paymentStatus: string;
  receiptAvailable: boolean;
  canCancel: boolean;
  lines: Array<{ name: string; quantity: number }>;
};

type DigitalReceipt = {
  id: string;
  restaurant: string;
  branch: string;
  issuedAt: string;
  orderReference?: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  lines: Array<{ name: string; quantity: number; unitPriceMinor: number }>;
  payments: Array<{ method: string; amountMinor: number; reference: string }>;
};

type PaymentMethod = {
  id: string;
  displayName: string;
  category: string;
  supportsSplit: boolean;
  flow: "PROVIDER" | "GIFT_CARD";
};

export const Route = createFileRoute("/guest/$restaurant/track/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : "",
  }),
  component: TrackOrder,
});

function TrackOrder() {
  const { restaurant, token } = Route.useParams();
  const { branch } = Route.useSearch();
  const query = useGuestQuery<{ order: TrackingOrder }>(
    `/api/seramet/guest/track/${encodeURIComponent(token)}`,
  );
  const methods = useGuestQuery<{ methods: PaymentMethod[] }>(
    branch ? `/api/seramet/guest/restaurants/${restaurant}/${branch}/payment-methods` : null,
  );
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [giftCardToken, setGiftCardToken] = useState("");
  const [receipt, setReceipt] = useState<DigitalReceipt | null>(null);
  const order = query.data?.order;
  const initiatePayment = async (method: PaymentMethod) => {
    const session = readGuestSession(`${restaurant}.${branch}`);
    if (!session)
      return setNotice("Return to the original checkout device to start payment securely.");
    setBusy(method.id);
    try {
      const response = await guestRequest<{ payment: { status?: string } }>(
        "/api/seramet/guest/payments",
        {
          method: "POST",
          body: JSON.stringify({
            trackingToken: token,
            paymentMethodId: method.id,
            operation: "PAYMENT_PROMPT",
            idempotencyKey: crypto.randomUUID(),
          }),
        },
        session,
      );
      setNotice(
        `Payment status: ${response.payment.status ?? "PROCESSING"}. Confirmation comes from the payment provider.`,
      );
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Payment could not be started");
    } finally {
      setBusy("");
    }
  };
  const redeemGiftCard = async (method: PaymentMethod) => {
    const session = readGuestSession(`${restaurant}.${branch}`);
    if (!session)
      return setNotice("Return to the original checkout device to use this gift card securely.");
    if (giftCardToken.trim().length < 12 || !order)
      return setNotice("Enter a valid gift-card code.");
    setBusy(method.id);
    try {
      const response = await guestRequest<{
        payment: { status: string; outstandingMinor: number };
      }>(
        "/api/seramet/guest/stored-value",
        {
          method: "POST",
          body: JSON.stringify({
            trackingToken: token,
            paymentMethodId: method.id,
            instrumentToken: giftCardToken.trim(),
            amountMinor: order.outstanding.amountMinor,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
        session,
      );
      setNotice(
        response.payment.status === "PAID"
          ? "Gift card applied. Your bill is paid."
          : "Gift card applied to the bill.",
      );
      setGiftCardToken("");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Gift card could not be applied");
    } finally {
      setBusy("");
    }
  };
  const loadReceipt = async () => {
    const session = readGuestSession(`${restaurant}.${branch}`);
    if (!session) return setNotice("Open the receipt on the device used for checkout.");
    setBusy("receipt");
    try {
      const result = await guestRequest<{ receipt: DigitalReceipt }>(
        `/api/seramet/guest/receipts/${encodeURIComponent(token)}`,
        {},
        session,
      );
      setReceipt(result.receipt);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Receipt could not be loaded");
    } finally {
      setBusy("");
    }
  };
  const cancelOrder = async () => {
    const session = readGuestSession(`${restaurant}.${branch}`);
    if (!session) return setNotice("Open this order on the device used for checkout.");
    setBusy("cancel");
    try {
      await guestRequest(
        `/api/seramet/guest/orders/${encodeURIComponent(token)}`,
        { method: "DELETE", body: JSON.stringify({ reason: "Cancelled by guest" }) },
        session,
      );
      setNotice("Order cancelled.");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Order could not be cancelled");
    } finally {
      setBusy("");
    }
  };
  const downloadReceipt = () => {
    if (!receipt) return;
    const text = receiptText(receipt);
    const href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${receipt.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(href);
  };
  const shareReceipt = async () => {
    if (!receipt || !navigator.share) return downloadReceipt();
    await navigator.share({ title: `${receipt.restaurant} receipt`, text: receiptText(receipt) });
  };
  if (query.status === "loading")
    return (
      <GuestShell>
        <GuestLoading label="Checking your order" />
      </GuestShell>
    );
  if (!order)
    return (
      <GuestShell>
        <GuestError message={query.error} />
      </GuestShell>
    );
  return (
    <GuestShell>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <Link
          to="/guest/$restaurant"
          params={{ restaurant }}
          className="text-sm font-bold text-[var(--guest-primary)]"
        >
          Restaurant home
        </Link>
        <section className="mt-4 overflow-hidden rounded-lg border border-black/10 bg-white">
          <div className="bg-[#1c2522] p-6 text-white">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase text-white/60">Order {order.reference}</p>
              <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-bold">
                {order.status.replaceAll("_", " ")}
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold">{statusTitle(order.status)}</h1>
            <p className="mt-2 text-sm text-white/65">
              Updates come from the restaurant's authoritative order and kitchen workflow.
            </p>
          </div>
          <div className="p-5 sm:p-7">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Step active label="Received" icon={<CheckCircle2 className="h-5 w-5" />} />
              <Step
                active={["PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED"].includes(
                  order.status,
                )}
                label="Preparing"
                icon={<ChefHat className="h-5 w-5" />}
              />
              <Step
                active={["READY", "OUT_FOR_DELIVERY", "COMPLETED"].includes(order.status)}
                label={order.serviceMode === "DIRECT_DELIVERY" ? "Delivery" : "Ready"}
                icon={<CircleDot className="h-5 w-5" />}
              />
            </div>
            <ul className="mt-7 divide-y divide-black/10 border-y border-black/10">
              {order.lines.map((line, index) => (
                <li key={`${line.name}-${index}`} className="flex justify-between py-3 text-sm">
                  <span>
                    {line.quantity} × {line.name}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between text-lg font-extrabold">
              <span>Total</span>
              <GuestMoney amount={order.total.amountMinor} currency={order.total.currency} />
            </div>
            <div className="mt-5 rounded-md bg-black/[0.04] p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span>Payment</span>
                <strong>{order.paymentStatus.replaceAll("_", " ")}</strong>
              </div>
            </div>
            {notice && (
              <p role="status" className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                {notice}
              </p>
            )}
            {order.paymentStatus !== "PAID" && (methods.data?.methods.length ?? 0) > 0 && (
              <div className="mt-5 grid gap-3">
                {methods.data!.methods.map((method) =>
                  method.flow === "GIFT_CARD" ? (
                    <div key={method.id} className="rounded-md border border-black/10 p-3">
                      <label className="text-sm font-bold" htmlFor={`gift-${method.id}`}>
                        Gift-card code
                      </label>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          id={`gift-${method.id}`}
                          type="password"
                          autoComplete="off"
                          value={giftCardToken}
                          onChange={(event) => setGiftCardToken(event.target.value)}
                          className="h-11 min-w-0 rounded-md border border-black/15 px-3"
                        />
                        <GuestButton onClick={() => redeemGiftCard(method)} disabled={busy !== ""}>
                          <Gift className="h-4 w-4" />
                          {busy === method.id ? "Applying" : `Use ${method.displayName}`}
                        </GuestButton>
                      </div>
                    </div>
                  ) : (
                    <GuestButton
                      key={method.id}
                      onClick={() => initiatePayment(method)}
                      disabled={busy !== ""}
                    >
                      {busy === method.id ? "Starting payment" : `Pay with ${method.displayName}`}
                    </GuestButton>
                  ),
                )}
              </div>
            )}
            {order.canCancel && (
              <GuestButton
                className="mt-4 w-full"
                secondary
                onClick={cancelOrder}
                disabled={busy !== ""}
              >
                <XCircle className="h-4 w-4" />
                {busy === "cancel" ? "Cancelling" : "Cancel order"}
              </GuestButton>
            )}
            {order.receiptAvailable && (
              <GuestButton
                className="mt-5 w-full"
                secondary
                onClick={loadReceipt}
                disabled={busy !== ""}
              >
                <ReceiptText className="h-5 w-5" />
                {busy === "receipt" ? "Loading receipt" : "View digital receipt"}
              </GuestButton>
            )}
            {receipt && (
              <section
                className="mt-4 border-t border-dashed border-black/20 pt-5"
                aria-label="Digital receipt"
              >
                <div className="text-center">
                  <strong>{receipt.restaurant}</strong>
                  <p className="text-xs text-black/50">
                    {receipt.branch} · {receipt.id}
                  </p>
                </div>
                <ul className="mt-4 divide-y divide-black/10 text-sm">
                  {receipt.lines.map((line, index) => (
                    <li key={`${line.name}-${index}`} className="flex justify-between py-2">
                      <span>
                        {line.quantity} × {line.name}
                      </span>
                      <GuestMoney
                        amount={line.quantity * line.unitPriceMinor}
                        currency={receipt.currency}
                      />
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex justify-between font-extrabold">
                  <span>Paid</span>
                  <GuestMoney amount={receipt.paidMinor} currency={receipt.currency} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <GuestButton secondary onClick={downloadReceipt}>
                    <Download className="h-4 w-4" />
                    Download
                  </GuestButton>
                  <GuestButton secondary onClick={shareReceipt}>
                    <Share2 className="h-4 w-4" />
                    Share
                  </GuestButton>
                </div>
              </section>
            )}
          </div>
        </section>
      </main>
    </GuestShell>
  );
}

function receiptText(receipt: DigitalReceipt) {
  const money = (amount: number) => formatMinor(amount, receipt.currency);
  return [
    receipt.restaurant,
    receipt.branch,
    `Receipt ${receipt.id}`,
    new Date(receipt.issuedAt).toLocaleString(),
    "",
    ...receipt.lines.map(
      (line) => `${line.quantity} x ${line.name}  ${money(line.quantity * line.unitPriceMinor)}`,
    ),
    "",
    `Paid  ${money(receipt.paidMinor)}`,
    ...(receipt.changeMinor ? [`Change  ${money(receipt.changeMinor)}`] : []),
  ].join("\n");
}

function Step({ active, label, icon }: { active: boolean; label: string; icon: ReactNode }) {
  return (
    <div
      className={`rounded-md p-3 ${active ? "bg-emerald-50 text-emerald-800" : "bg-black/[0.04] text-black/35"}`}
    >
      <div className="mx-auto flex justify-center">{icon}</div>
      <div className="mt-1 font-bold">{label}</div>
    </div>
  );
}

function statusTitle(status: string) {
  if (status === "READY") return "Your order is ready";
  if (status === "OUT_FOR_DELIVERY") return "Your order is on the way";
  if (status === "COMPLETED") return "Order complete";
  if (status === "CANCELLED") return "Order cancelled";
  if (status === "PREPARING") return "The kitchen is preparing your order";
  return "We received your order";
}
