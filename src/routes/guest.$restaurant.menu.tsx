import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronRight, Clock3, Plus, ShoppingBag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BranchFacts,
  EmptyGuestState,
  GuestButton,
  GuestError,
  GuestField,
  GuestLoading,
  GuestMoney,
  GuestShell,
  MenuSearch,
  QuantityControl,
} from "@/guest/guest-ui";
import type {
  GuestQuote,
  GuestServiceMode,
  PublicBranchProfile,
  PublicMenuItem,
} from "@/guest/types";
import {
  guestRequest,
  readGuestSession,
  readGuestSessionContext,
  rememberGuestOrder,
  useGuestQuery,
  writeGuestSession,
  writeGuestSessionContext,
} from "@/guest/use-guest";
import { formatMinor } from "@/payments/money";

type MenuResponse = {
  profile: PublicBranchProfile;
  categories: string[];
  items: PublicMenuItem[];
  menuWatermark: string;
  deliveryZones: Array<{
    id: string;
    name: string;
    minimumOrderMinor: number;
    deliveryFeeMinor: number;
    estimatedMinutes?: [number, number];
    currency: string;
  }>;
};

type CartEntry = {
  itemId: string;
  quantity: number;
  modifierIds?: string[];
  specialRequest?: string;
};

export const Route = createFileRoute("/guest/$restaurant/menu")({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : "",
    service: typeof search["service"] === "string" ? search["service"] : "",
    qr: typeof search["qr"] === "string" ? search["qr"] : "",
  }),
  component: GuestMenu,
});

function GuestMenu() {
  const { restaurant } = Route.useParams();
  const searchParams = Route.useSearch();
  const branch = searchParams.branch;
  const [serviceMode, setServiceMode] = useState<GuestServiceMode>(
    searchParams.qr
      ? "QR_TABLE"
      : searchParams.service === "KIOSK"
        ? "KIOSK"
        : searchParams.service === "DIRECT_DELIVERY"
          ? "DIRECT_DELIVERY"
          : "PICKUP",
  );
  const query = useGuestQuery<MenuResponse>(
    branch
      ? `/api/seramet/guest/restaurants/${encodeURIComponent(restaurant)}/${encodeURIComponent(branch)}/menu?serviceMode=${serviceMode}`
      : null,
  );
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [checkout, setCheckout] = useState(false);
  const [quote, setQuote] = useState<GuestQuote | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [voucher, setVoucher] = useState("");
  const [deliveryZoneId, setDeliveryZoneId] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [qrContext, setQrContext] = useState<{ qrMode?: string; tableCode?: string } | null>(() =>
    readGuestSessionContext(`${restaurant}.${branch}`),
  );
  const [confirmed, setConfirmed] = useState<{ reference: string; trackingToken: string } | null>(
    null,
  );

  useEffect(() => {
    if (!branch) return;
    const key = `${restaurant}.${branch}`;
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(`seramet.guest.cart.${key}`) ?? "[]",
      ) as CartEntry[];
      setCart(saved);
    } catch {
      setCart([]);
    }
  }, [branch, restaurant]);

  useEffect(() => {
    if (!branch) return;
    window.localStorage.setItem(`seramet.guest.cart.${restaurant}.${branch}`, JSON.stringify(cart));
  }, [branch, cart, restaurant]);

  const profile = query.data?.profile;
  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data?.items ?? []).filter(
      (item) =>
        (category === "All" || item.categoryCode === category) &&
        (!needle || `${item.name} ${item.description ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [category, query.data?.items, search]);
  const cartCount = cart.reduce((sum, entry) => sum + entry.quantity, 0);
  const localTotal = cart.reduce((sum, entry) => {
    const item = query.data?.items.find((candidate) => candidate.id === entry.itemId);
    const modifierTotal =
      item?.modifierGroups
        .flatMap((group) => group.options)
        .filter((option) => entry.modifierIds?.includes(option.id))
        .reduce((total, option) => total + option.priceMinor, 0) ?? 0;
    return sum + ((item?.priceMinor ?? 0) + modifierTotal) * entry.quantity;
  }, 0);
  const updateQuantity = (itemId: string, quantity: number) => {
    setQuote(null);
    setCart((current) =>
      quantity <= 0
        ? current.filter((entry) => entry.itemId !== itemId)
        : current.some((entry) => entry.itemId === itemId)
          ? current.map((entry) => (entry.itemId === itemId ? { ...entry, quantity } : entry))
          : [...current, { itemId, quantity }],
    );
  };
  const updateModifier = (itemId: string, modifierId: string, checked: boolean) => {
    setQuote(null);
    setCart((current) =>
      current.map((entry) =>
        entry.itemId === itemId
          ? {
              ...entry,
              modifierIds: checked
                ? [...(entry.modifierIds ?? []), modifierId]
                : (entry.modifierIds ?? []).filter((id) => id !== modifierId),
            }
          : entry,
      ),
    );
  };
  const updateSpecialRequest = (itemId: string, specialRequest: string) => {
    setQuote(null);
    setCart((current) =>
      current.map((entry) => (entry.itemId === itemId ? { ...entry, specialRequest } : entry)),
    );
  };

  const ensureSession = async () => {
    const key = `${restaurant}.${branch}`;
    const existing = readGuestSession(key);
    if (existing) return existing;
    const result = await guestRequest<{
      session: { token: string; qrMode?: string; tableCode?: string };
    }>(`/api/seramet/guest/restaurants/${restaurant}/${branch}/sessions`, {
      method: "POST",
      body: JSON.stringify(
        searchParams.qr
          ? { sessionType: "QR", qrToken: searchParams.qr }
          : { sessionType: serviceMode === "KIOSK" ? "KIOSK" : "WEB" },
      ),
    });
    writeGuestSession(key, result.session.token);
    const context = {
      ...(result.session.qrMode ? { qrMode: result.session.qrMode } : {}),
      ...(result.session.tableCode ? { tableCode: result.session.tableCode } : {}),
    };
    writeGuestSessionContext(key, context);
    setQrContext(context);
    return result.session.token;
  };

  useEffect(() => {
    if (searchParams.qr)
      void ensureSession().catch((error: unknown) =>
        setNotice(error instanceof Error ? error.message : "Table QR is unavailable"),
      );
    // The QR capability is validated by the server; reruns are intentionally keyed to the scanned token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.qr]);

  const sendServiceRequest = async (
    requestType: "CALL_WAITER" | "REQUEST_WATER" | "REQUEST_BILL" | "NEED_ASSISTANCE",
  ) => {
    setBusy(requestType);
    try {
      const token = await ensureSession();
      await guestRequest(
        "/api/seramet/guest/service-requests",
        { method: "POST", body: JSON.stringify({ requestType }) },
        token,
      );
      setNotice(
        requestType === "REQUEST_BILL"
          ? "The team has received your bill request."
          : "A team member has been notified.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request could not be sent");
    } finally {
      setBusy("");
    }
  };

  const requestQuote = async () => {
    setBusy("quote");
    setNotice("");
    try {
      const token = await ensureSession();
      const result = await guestRequest<{ quote: GuestQuote }>(
        `/api/seramet/guest/restaurants/${restaurant}/${branch}/quotes`,
        {
          method: "POST",
          body: JSON.stringify({
            serviceMode,
            items: cart,
            ...(serviceMode === "DIRECT_DELIVERY" && deliveryZoneId ? { deliveryZoneId } : {}),
            ...(voucher.trim() ? { voucherCode: voucher.trim() } : {}),
          }),
        },
        token,
      );
      setQuote(result.quote);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Quote could not be created");
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    if (!quote) return;
    setBusy("submit");
    setNotice("");
    try {
      const token = await ensureSession();
      const result = await guestRequest<{
        order: { orderReference: string; trackingToken: string };
      }>(
        `/api/seramet/guest/restaurants/${restaurant}/${branch}/orders`,
        {
          method: "POST",
          body: JSON.stringify({
            quoteId: quote.id,
            idempotencyKey: crypto.randomUUID(),
            ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
            ...(serviceMode === "DIRECT_DELIVERY"
              ? { deliveryAddress: deliveryAddress.trim() }
              : {}),
          }),
        },
        token,
      );
      setConfirmed({
        reference: result.order.orderReference,
        trackingToken: result.order.trackingToken,
      });
      if (serviceMode !== "KIOSK") {
        rememberGuestOrder({
          restaurant,
          branch,
          reference: result.order.orderReference,
          trackingToken: result.order.trackingToken,
        });
      }
      setCart([]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Order could not be submitted");
    } finally {
      setBusy("");
    }
  };

  const resetKiosk = async () => {
    const token = readGuestSession(`${restaurant}.${branch}`);
    if (token) {
      try {
        await guestRequest("/api/seramet/guest/kiosk/reset", { method: "POST" }, token);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "Kiosk could not be reset");
        return;
      }
    }
    window.sessionStorage.removeItem(`seramet.guest.session.${restaurant}.${branch}`);
    window.sessionStorage.removeItem(`seramet.guest.context.${restaurant}.${branch}`);
    window.localStorage.removeItem(`seramet.guest.cart.${restaurant}.${branch}`);
    setCart([]);
    setQuote(null);
    setCheckout(false);
    setConfirmed(null);
    setCustomerName("");
    setVoucher("");
    setDeliveryZoneId("");
    setDeliveryAddress("");
    setNotice("");
  };

  if (!branch) {
    return (
      <GuestShell>
        <GuestError
          message="Choose a branch before viewing the menu."
          action={
            <a href={`/guest/${restaurant}`} className="font-bold text-[var(--guest-primary)]">
              Choose branch
            </a>
          }
        />
      </GuestShell>
    );
  }
  if (query.status === "loading")
    return (
      <GuestShell>
        <GuestLoading label="Loading the live menu" />
      </GuestShell>
    );
  if (!profile)
    return (
      <GuestShell>
        <GuestError message={query.error} />
      </GuestShell>
    );

  return (
    <GuestShell profile={profile}>
      <main className="pb-24 lg:pb-10">
        <section className="relative h-[270px] overflow-hidden bg-black sm:h-[340px]">
          <img
            src={profile.coverUrl ?? "/guest-cover.png"}
            alt="Fresh dishes from the restaurant"
            className="h-full w-full object-cover"
            fetchPriority="high"
          />
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-7xl px-5 pb-7 text-white sm:px-6 sm:pb-9">
            <h1 className="text-3xl font-extrabold leading-tight sm:text-5xl">
              {profile.publicName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/90">{profile.description}</p>
            <div className="mt-3">
              <BranchFacts profile={profile} />
            </div>
          </div>
        </section>
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <MenuSearch value={search} onChange={setSearch} />
              {!searchParams.qr && (
                <div
                  className="inline-flex rounded-md border border-black/10 bg-white p-1"
                  aria-label="Order type"
                >
                  {profile.serviceModes
                    .filter((mode) =>
                      ["PICKUP", "WEB_ORDER", "DIRECT_DELIVERY", "KIOSK"].includes(mode),
                    )
                    .slice(0, 3)
                    .map((mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          setServiceMode(mode === "WEB_ORDER" ? "PICKUP" : mode);
                          setQuote(null);
                        }}
                        className={`min-h-9 rounded px-3 text-xs font-bold ${serviceMode === mode || (mode === "WEB_ORDER" && serviceMode === "PICKUP") ? "bg-[var(--guest-primary)] text-white" : "text-black/55"}`}
                      >
                        {mode === "WEB_ORDER" ? "Pickup" : mode.replaceAll("_", " ")}
                      </button>
                    ))}
                </div>
              )}
            </div>
            {searchParams.qr && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-black/10 bg-white p-3">
                <span className="mr-auto text-xs font-bold">
                  Table {qrContext?.tableCode ?? "session"} ·{" "}
                  {(qrContext?.qrMode ?? "VALIDATING").replaceAll("_", " ")}
                </span>
                <GuestButton
                  secondary
                  onClick={() => sendServiceRequest("CALL_WAITER")}
                  disabled={Boolean(busy)}
                >
                  Call waiter
                </GuestButton>
                <GuestButton
                  secondary
                  onClick={() => sendServiceRequest("REQUEST_BILL")}
                  disabled={Boolean(busy)}
                >
                  Request bill
                </GuestButton>
              </div>
            )}
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2" aria-label="Menu categories">
              {["All", ...(query.data?.categories ?? [])].map((item) => (
                <button
                  key={item}
                  onClick={() => setCategory(item)}
                  className={`min-h-9 shrink-0 rounded-md px-3 text-xs font-bold ${category === item ? "bg-[#1c2522] text-white" : "border border-black/10 bg-white"}`}
                >
                  {item === "All" ? item : item.replaceAll("_", " ")}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const quantity = cart.find((entry) => entry.itemId === item.id)?.quantity ?? 0;
                return (
                  <article
                    key={item.id}
                    className="grid min-h-[170px] grid-cols-[minmax(0,1fr)_120px] overflow-hidden rounded-lg border border-black/10 bg-white sm:grid-cols-[minmax(0,1fr)_140px]"
                  >
                    <div className="flex min-w-0 flex-col p-4">
                      <h2 className="text-[15px] font-extrabold">{item.name}</h2>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-black/55">
                        {item.description ?? "Prepared to order."}
                      </p>
                      {quantity > 0 &&
                        item.modifierGroups.map((group) => (
                          <fieldset key={group.id} className="mt-3 border-t border-black/10 pt-2">
                            <legend className="text-[11px] font-bold">
                              {group.name}
                              {group.required ? " · Required" : ""}
                            </legend>
                            <div className="mt-1 grid gap-1">
                              {group.options
                                .filter((option) => option.available)
                                .map((option) => (
                                  <label
                                    key={option.id}
                                    className="flex min-h-8 items-center justify-between gap-2 text-[11px]"
                                  >
                                    <span className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={
                                          cart
                                            .find((entry) => entry.itemId === item.id)
                                            ?.modifierIds?.includes(option.id) ?? false
                                        }
                                        onChange={(event) =>
                                          updateModifier(item.id, option.id, event.target.checked)
                                        }
                                      />
                                      {option.name}
                                    </span>
                                    {option.priceMinor > 0 && (
                                      <GuestMoney
                                        amount={option.priceMinor}
                                        currency={item.currency}
                                      />
                                    )}
                                  </label>
                                ))}
                            </div>
                          </fieldset>
                        ))}
                      <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                        <span className="text-sm font-extrabold">
                          <GuestMoney amount={item.priceMinor} currency={item.currency} />
                        </span>
                        {item.available ? (
                          qrContext?.qrMode &&
                          !["ORDERING_ENABLED", "ORDER_AND_PAY"].includes(qrContext.qrMode) ? (
                            <span className="text-[11px] font-bold text-black/45">Menu only</span>
                          ) : quantity ? (
                            <QuantityControl
                              quantity={quantity}
                              onChange={(value) => updateQuantity(item.id, value)}
                            />
                          ) : (
                            <button
                              onClick={() => updateQuantity(item.id, 1)}
                              className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--guest-primary)] text-white"
                              aria-label={`Add ${item.name}`}
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )
                        ) : (
                          <span className="rounded-md bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">
                            Sold out
                          </span>
                        )}
                      </div>
                    </div>
                    <img
                      src={item.imageUrl ?? profile.coverUrl ?? "/guest-cover.png"}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </article>
                );
              })}
              {!items.length && (
                <div className="sm:col-span-2">
                  <EmptyGuestState type="menu" />
                </div>
              )}
            </div>
          </section>
          <aside
            className={`${checkout ? "fixed inset-0 z-50 overflow-y-auto bg-[#f8f7f3] p-4" : "hidden"} lg:sticky lg:top-20 lg:block lg:self-start lg:rounded-lg lg:border lg:border-black/10 lg:bg-white lg:p-4`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold">Your order</h2>
              <button
                onClick={() => setCheckout(false)}
                className="flex h-10 w-10 items-center justify-center lg:hidden"
                aria-label="Close cart"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {cart.length ? (
              <div className="mt-4 space-y-4">
                {cart.map((entry) => {
                  const item = query.data?.items.find((candidate) => candidate.id === entry.itemId);
                  if (!item) return null;
                  return (
                    <div key={entry.itemId} className="border-b border-black/10 pb-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{item.name}</p>
                          <p className="mt-0.5 text-xs text-black/50">
                            <GuestMoney
                              amount={item.priceMinor * entry.quantity}
                              currency={item.currency}
                            />
                          </p>
                        </div>
                        <QuantityControl
                          quantity={entry.quantity}
                          onChange={(value) => updateQuantity(entry.itemId, value)}
                        />
                      </div>
                      <input
                        value={entry.specialRequest ?? ""}
                        onChange={(event) => updateSpecialRequest(entry.itemId, event.target.value)}
                        maxLength={280}
                        placeholder="Special request (optional)"
                        aria-label={`Special request for ${item.name}`}
                        className="mt-2 h-9 w-full rounded-md border border-black/10 px-3 text-sm"
                      />
                    </div>
                  );
                })}
                <GuestField
                  label="Name (optional)"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  maxLength={120}
                />
                <GuestField
                  label="Voucher (optional)"
                  value={voucher}
                  onChange={(event) => {
                    setVoucher(event.target.value);
                    setQuote(null);
                  }}
                  maxLength={128}
                />
                {serviceMode === "DIRECT_DELIVERY" && (
                  <>
                    <label className="block text-sm font-semibold">
                      Delivery area
                      <select
                        value={deliveryZoneId}
                        onChange={(event) => {
                          setDeliveryZoneId(event.target.value);
                          setQuote(null);
                        }}
                        className="mt-1.5 h-11 w-full rounded-md border border-black/15 bg-white px-3 text-base"
                      >
                        <option value="">Select area</option>
                        {query.data?.deliveryZones.map((zone) => (
                          <option key={zone.id} value={zone.id}>
                            {zone.name} · {formatZone(zone)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <GuestField
                      label="Delivery address"
                      value={deliveryAddress}
                      onChange={(event) => setDeliveryAddress(event.target.value)}
                      maxLength={500}
                    />
                  </>
                )}
                {quote && (
                  <div className="space-y-2 border-t border-black/10 pt-4 text-sm">
                    <MoneyRow
                      label="Subtotal"
                      value={<GuestMoney amount={quote.subtotalMinor} currency={quote.currency} />}
                    />
                    {quote.discountMinor > 0 && (
                      <MoneyRow
                        label="Discount"
                        value={
                          <GuestMoney amount={-quote.discountMinor} currency={quote.currency} />
                        }
                      />
                    )}
                    <MoneyRow
                      label="Tax"
                      value={<GuestMoney amount={quote.taxMinor} currency={quote.currency} />}
                    />
                    <MoneyRow
                      label="Total"
                      value={<GuestMoney amount={quote.totalMinor} currency={quote.currency} />}
                      strong
                    />
                  </div>
                )}
                {notice && (
                  <p
                    role="alert"
                    className="rounded-md bg-red-50 p-3 text-xs font-semibold text-red-700"
                  >
                    {notice}
                  </p>
                )}
                {!quote ? (
                  <GuestButton
                    onClick={() => void requestQuote()}
                    disabled={Boolean(busy)}
                    className="w-full"
                  >
                    {busy === "quote" ? "Checking menu..." : "Review total"}
                    <ChevronRight className="h-4 w-4" />
                  </GuestButton>
                ) : (
                  <GuestButton
                    onClick={() => void submit()}
                    disabled={Boolean(busy)}
                    className="w-full"
                  >
                    {busy === "submit" ? "Sending order..." : "Place order"}
                    <Check className="h-4 w-4" />
                  </GuestButton>
                )}
                <p className="text-center text-[11px] leading-4 text-black/45">
                  Your final amount is always checked by the restaurant before the order is
                  accepted.
                </p>
              </div>
            ) : (
              <EmptyGuestState type="cart" />
            )}
          </aside>
        </div>
        {confirmed && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-lg bg-white p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <Check className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-xl font-extrabold">Order received</h2>
              <p className="mt-2 text-sm text-black/55">
                Reference <strong>{confirmed.reference}</strong>
              </p>
              <a
                href={`/guest/${restaurant}/track/${encodeURIComponent(confirmed.trackingToken)}?branch=${encodeURIComponent(branch)}`}
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--guest-primary)] px-4 text-sm font-bold text-white"
              >
                <Clock3 className="h-4 w-4" /> Track order
              </a>
              {serviceMode === "KIOSK" && (
                <GuestButton className="mt-2 w-full" secondary onClick={resetKiosk}>
                  Finish and reset kiosk
                </GuestButton>
              )}
            </div>
          </div>
        )}
      </main>
      {cartCount > 0 && !checkout && (
        <button
          onClick={() => setCheckout(true)}
          className="fixed inset-x-4 bottom-4 z-40 flex min-h-14 items-center justify-between rounded-md bg-[#1c2522] px-4 text-white shadow-xl lg:hidden"
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold">
            <ShoppingBag className="h-4 w-4" />
            {cartCount} item{cartCount === 1 ? "" : "s"}
          </span>
          <span className="text-sm font-bold">
            <GuestMoney amount={localTotal} currency={profile.currency} />
          </span>
        </button>
      )}
    </GuestShell>
  );
}

function MoneyRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${strong ? "border-t border-black/10 pt-2 text-base font-extrabold" : ""}`}
    >
      <span className="text-black/55">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function formatZone(zone: MenuResponse["deliveryZones"][number]) {
  const minutes = zone.estimatedMinutes
    ? ` · ${zone.estimatedMinutes[0]}-${zone.estimatedMinutes[1]} min`
    : "";
  return `${formatMinor(zone.deliveryFeeMinor, zone.currency)}${minutes}`;
}
