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

  it("uses the till's copy alone until the server answers", () => {
    const local = [{ id: "RCP-3" }];
    expect(mergeDocuments(undefined, local)).toBe(local);
  });
});

describe("document list requests", () => {
  it("asks for one business date, branch and status", async () => {
    const fetchPage = vi.fn(async (_path: string) => ({ rows: [], hasMore: false }));
    const observer = new QueryObserver(
      new QueryClient(),
      documentQueryOptions(
        {
          tenantId: "t",
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
    const base = { tenantId: "t", branchId: "b", kind: "receipts" as const, date: "2026-11-02" };
    const key = (request: Parameters<typeof documentQueryOptions>[0]) =>
      JSON.stringify(documentQueryOptions(request).queryKey);
    expect(key(base)).not.toBe(key({ ...base, date: "2026-11-01" }));
    expect(key(base)).not.toBe(key({ ...base, branchId: "c" }));
    expect(key(base)).not.toBe(key({ ...base, kind: "invoices" }));
  });
});
