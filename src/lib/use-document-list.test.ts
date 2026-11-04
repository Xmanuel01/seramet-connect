import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { documentQueryOptions, mergeDocuments } from "./use-document-list";

describe("merging server and till documents", () => {
  it("keeps every record once, preferring the till's copy", () => {
    const server = [
      { id: "RCP-1", amount: 100 },
      { id: "RCP-2", amount: 200 },
    ];
    const local = [
      { id: "RCP-2", amount: 250 }, // changed on this till, not yet on the server
      { id: "RCP-3", amount: 300 }, // made offline
    ];
    expect(mergeDocuments(server, local)).toEqual([
      { id: "RCP-1", amount: 100 },
      { id: "RCP-2", amount: 250 },
      { id: "RCP-3", amount: 300 },
    ]);
  });

  it("puts the newest record first, wherever it came from", () => {
    const server = [
      { id: "RCP-2", issuedAt: "2026-11-02T09:00:00Z" },
      { id: "RCP-1", issuedAt: "2026-11-02T08:00:00Z" },
    ];
    const local = [{ id: "RCP-3", issuedAt: "2026-11-02T10:00:00Z" }];
    expect(mergeDocuments(server, local).map((row) => row.id)).toEqual(["RCP-3", "RCP-2", "RCP-1"]);
  });

  it("uses the till's copy alone until the server answers", () => {
    const local = [{ id: "RCP-3" }];
    expect(mergeDocuments(undefined, local)).toBe(local);
  });
});

describe("document list requests", () => {
  it("keeps range end, calendar basis and history batches in the query identity", () => {
    const request = {
      tenantId: "t",
      userId: "u",
      kind: "receipts" as const,
      date: "2026-11-01",
      to: "2026-11-04",
    };
    const key = (input: typeof request & { basis?: "calendar"; pages?: number }) =>
      documentQueryOptions(input).queryKey;
    expect(key(request)).not.toEqual(key({ ...request, to: "2026-11-05" }));
    expect(key(request)).not.toEqual(key({ ...request, basis: "calendar" }));
    expect(key(request)).not.toEqual(key({ ...request, pages: 20 }));
  });
  it("requests all-time history from the server instead of only cached rows", async () => {
    const fetchPage = vi.fn(async (_path: string) => ({
      rows: [{ id: "old-record" }],
      hasMore: false,
    }));
    const client = new QueryClient();
    const result = await client.fetchQuery(
      documentQueryOptions(
        { tenantId: "t", userId: "u", kind: "orders", date: "", to: "", basis: "calendar" },
        fetchPage,
      ),
    );
    const url = new URL(fetchPage.mock.calls[0]![0], "https://pos.example");
    expect(url.searchParams.get("from")).toBe("");
    expect(url.searchParams.get("to")).toBe("");
    expect(url.searchParams.get("basis")).toBe("calendar");
    expect(result.rows).toEqual([{ id: "old-record" }]);
    client.clear();
  });
  it("asks for one business date, branch and status", async () => {
    const fetchPage = vi.fn(async (_path: string) => ({ rows: [], hasMore: false }));
    const observer = new QueryObserver(
      new QueryClient(),
      documentQueryOptions(
        {
          tenantId: "t",
          userId: "u",
          branchId: "westlands",
          kind: "invoices",
          date: "2026-11-02",
          status: "paid",
        },
        fetchPage,
      ),
    );
    await new Promise<void>((resolve) => {
      const stop = observer.subscribe((result) => {
        if (result.isSuccess) {
          stop();
          resolve();
        }
      });
    });
    const url = new URL(fetchPage.mock.calls[0]![0], "https://pos.example");
    expect(url.pathname).toBe("/api/seramet/documents/invoices");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-11-02",
      to: "2026-11-02",
      limit: "200",
      offset: "0",
      branchId: "westlands",
      status: "paid",
    });
  });

  it("keeps different days, branches and lists apart", () => {
    const base = {
      tenantId: "t",
      userId: "u",
      branchId: "b",
      kind: "receipts" as const,
      date: "2026-11-02",
    };
    const key = (request: Parameters<typeof documentQueryOptions>[0]) =>
      JSON.stringify(documentQueryOptions(request).queryKey);
    expect(key(base)).not.toBe(key({ ...base, date: "2026-11-01" }));
    expect(key(base)).not.toBe(key({ ...base, branchId: "c" }));
    expect(key(base)).not.toBe(key({ ...base, kind: "invoices" }));
    // Another person signing in on this device never sees the last one's list.
    expect(key(base)).not.toBe(key({ ...base, userId: "someone-else" }));
  });

  it("reads every page of a busy day", async () => {
    const fetchPage = vi.fn(async (path: string) => {
      const offset = Number(new URL(path, "https://pos.example").searchParams.get("offset"));
      return { rows: [{ id: `R-${offset}` }], hasMore: offset < 400 };
    });
    const observer = new QueryObserver(
      new QueryClient(),
      documentQueryOptions(
        { tenantId: "t", userId: "u", kind: "receipts", date: "2026-11-02" },
        fetchPage,
      ),
    );
    await new Promise<void>((resolve) => {
      const stop = observer.subscribe((result) => {
        if (result.isSuccess) {
          stop();
          resolve();
        }
      });
    });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(observer.getCurrentResult().data).toEqual({
      rows: [{ id: "R-0" }, { id: "R-200" }, { id: "R-400" }],
      hasMore: false,
    });
  });
});
