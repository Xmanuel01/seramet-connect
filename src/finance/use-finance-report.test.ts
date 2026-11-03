import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  affectsFinance,
  financePeriodProblem,
  financeQueryOptions,
  financeQueryRoot,
  listenForFinanceEvents,
  withDeadline,
  scheduleFinanceRefresh,
} from "./use-finance-report";
import { RequestError } from "@/lib/user-facing-error";

const request = {
  tenantId: "tenant-a",
  branchId: "branch-1",
  kind: "statement" as const,
  from: "2026-11-01",
  to: "2026-11-02",
};

function client() {
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
}

/** Resolves once the observer has settled on data or an error. */
type Settled = { isFetching: boolean; isSuccess: boolean; isError: boolean };
function settled(observer: { subscribe: (listener: (result: Settled) => void) => () => void }) {
  return new Promise<void>((resolve) => {
    const stop = observer.subscribe((result) => {
      if (!result.isFetching && (result.isSuccess || result.isError)) {
        stop();
        resolve();
      }
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("which live events refresh the accounts", () => {
  it("ignores kitchen, printing and delivery commands", () => {
    for (const eventType of [
      "setProductionStationStatus",
      "claimKitchenPrintObligation",
      "setDeliveryStatus",
      "upsertOrderDraft",
    ])
      expect(affectsFinance({ topic: "transactions", eventType })).toBe(false);
  });

  it("refreshes for money commands, and for anything it does not recognise", () => {
    for (const eventType of [
      "settleInvoice",
      "approveRefund",
      "closeCashDrawer",
      "splitBill",
      "aCommandAddedNextYear",
    ])
      expect(affectsFinance({ topic: "transactions", eventType })).toBe(true);
    expect(affectsFinance({ topic: "something-new" })).toBe(true);
    expect(affectsFinance(undefined)).toBe(true);
  });

  it("refreshes for posting and closing jobs only", () => {
    expect(affectsFinance({ topic: "workers", eventType: "DAILY_CLOSING_EMAIL_COMPLETED" })).toBe(
      true,
    );
    expect(affectsFinance({ topic: "workers", eventType: "CRM_CAMPAIGN_DISPATCH_COMPLETED" })).toBe(
      false,
    );
  });
});

describe("report periods", () => {
  it("accepts a valid range, including a single day", () => {
    expect(financePeriodProblem("2026-11-01", "2026-11-30")).toBeNull();
    expect(financePeriodProblem("2026-11-02", "2026-11-02")).toBeNull();
  });

  it("explains a missing or reversed range instead of asking the server", () => {
    expect(financePeriodProblem("", "2026-11-02")).toBe("Choose a start and end date.");
    expect(financePeriodProblem("2026-11-02", "02/11/2026")).toBe("Choose a start and end date.");
    expect(financePeriodProblem("2026-11-03", "2026-11-02")).toBe(
      "Choose a start date on or before the end date.",
    );
  });
});

describe("finance report cache", () => {
  it("serves every page asking for the same report from one request", async () => {
    const queryClient = client();
    const fetchReport = vi.fn(async () => ({ total: 100 }));
    const options = financeQueryOptions(request, fetchReport);
    const balanceSheet = new QueryObserver(queryClient, options);
    const profitAndLoss = new QueryObserver(queryClient, financeQueryOptions(request, fetchReport));
    const done = settled(balanceSheet);
    profitAndLoss.subscribe(() => undefined);
    await done;
    expect(fetchReport).toHaveBeenCalledTimes(1);
    expect(profitAndLoss.getCurrentResult().data).toEqual({ total: 100 });
    // A different branch is a different report.
    expect(financeQueryOptions({ ...request, branchId: "branch-2" }).queryKey).not.toEqual(
      options.queryKey,
    );
  });

  it("keeps the figures on screen while a refresh is in flight", async () => {
    const queryClient = client();
    let total = 100;
    let release: () => void = () => undefined;
    const fetchReport = vi.fn(async () => {
      if (total > 100) await new Promise<void>((resolve) => (release = resolve));
      return { total };
    });
    const observer = new QueryObserver(queryClient, financeQueryOptions(request, fetchReport));
    await settled(observer);
    // The report is on screen: a page is subscribed to it.
    const onScreen = observer.subscribe(() => undefined);
    total = 150;
    const refreshing = queryClient.invalidateQueries({ queryKey: [financeQueryRoot] });
    await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(true));
    expect(observer.getCurrentResult().data).toEqual({ total: 100 });
    release();
    await refreshing;
    expect(observer.getCurrentResult().data).toEqual({ total: 150 });
    onScreen();
  });

  it("retries a server fault once but never a refusal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const refused = vi.fn(async () => {
      throw new RequestError(403, "");
    });
    const forbidden = new QueryObserver(client(), financeQueryOptions(request, refused));
    await settled(forbidden);
    expect(refused).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => {
      throw new RequestError(503, "");
    });
    const outage = new QueryObserver(client(), financeQueryOptions(request, failing));
    await settled(outage);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("asks for the right period, branch and ledger page", async () => {
    const fetchReport = vi.fn(async (_path: string) => ({}));
    const observer = new QueryObserver(
      client(),
      financeQueryOptions(
        { ...request, kind: "ledger", page: 2, limit: 50, accountType: "EXPENSE" },
        fetchReport,
      ),
    );
    await settled(observer);
    const url = new URL(fetchReport.mock.calls[0]![0], "https://pos.example");
    expect(url.pathname).toBe("/api/seramet/finance/reports/ledger");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-11-01",
      to: "2026-11-02",
      branchId: "branch-1",
      limit: "50",
      offset: "100",
      accountType: "EXPENSE",
    });
    const all = financeQueryOptions({ ...request, branchId: undefined }, fetchReport);
    expect(all.queryKey).toContain("ALL");
  });

  it("listens once for the whole app, so reports not on screen still go stale", () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    listenForFinanceEvents(queryClient);
    listenForFinanceEvents(queryClient);
    target.dispatchEvent(
      new CustomEvent("seramet:realtime", {
        detail: { topic: "transactions", eventType: "settleInvoice" },
      }),
    );
    target.dispatchEvent(
      new CustomEvent("seramet:realtime", {
        detail: { topic: "transactions", eventType: "setProductionStationStatus" },
      }),
    );
    vi.advanceTimersByTime(1_000);
    // One refresh, not two: the listener was installed once, and the kitchen event is ignored.
    expect(invalidate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("gives up on a stalled report so the page can offer to try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stalled = vi.fn(
      (_path: string, signal: AbortSignal) =>
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    );
    const observer = new QueryObserver(
      client(),
      financeQueryOptions(request, (path, signal) => stalled(path, withDeadline(signal, 50))),
    );
    await settled(observer);
    expect(observer.getCurrentResult().error?.name).toBe("TimeoutError");
  });

  it("turns a burst of live events into one refresh", () => {
    vi.useFakeTimers();
    const queryClient = client();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    for (let i = 0; i < 20; i++) scheduleFinanceRefresh(queryClient);
    vi.advanceTimersByTime(999);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [financeQueryRoot],
      refetchType: "active",
    });
  });
});
