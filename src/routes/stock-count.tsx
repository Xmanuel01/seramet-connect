import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/stock-count")({
  head: () => ({
    meta: [
      { title: "Stock Count - Seramet" },
      {
        name: "description",
        content:
          "Authoritative warehouse stock-count sessions with blind counting, review and approval.",
      },
    ],
  }),
  component: StockCount,
});

type CountSummary = {
  id: string;
  branch_id: string;
  warehouse_id: string;
  warehouse_name: string;
  business_date: string;
  status: string;
  blind_count: number;
  snapshot_at: string | null;
  created_at: string;
  item_count: number;
  counted_count: number;
  variance_count: number | null;
  variance_value_minor: number | null;
};

type CountLine = {
  id: string;
  inventory_item_id: string;
  code: string;
  sku: string | null;
  name: string;
  unit_symbol: string | null;
  expected_quantity_minor: number | null;
  counted_quantity_minor: number;
  variance_quantity_minor: number | null;
  variance_value_minor: number | null;
  reason: string | null;
  counted: number;
  unit_cost_minor: number | null;
  counted_at: string | null;
};

type CountDetail = {
  session: {
    id: string;
    branch_id: string;
    warehouse_id: string;
    warehouse_name: string;
    warehouse_code: string;
    business_date: string;
    status: string;
    blind_count: number;
    snapshot_at: string | null;
    revision: number;
    created_at: string;
    submitted_at: string | null;
    approved_by: string | null;
    approval_reason: string | null;
    cancellation_reason: string | null;
  };
  lines: CountLine[];
};

function StockCount() {
  const { branchId, branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [sessions, setSessions] = useState<CountSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<CountDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [showStart, setShowStart] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [blindCount, setBlindCount] = useState(true);
  const [decisionReason, setDecisionReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const branchKey = control.data.map((row) => row.branchId).join("|");
  const currentWarehouses = useMemo(() => {
    if (isAllBranches) return [];
    const currentBranchData =
      control.data.find((row) => row.branchId === branchId) ?? control.data[0];
    return currentBranchData?.warehouses ?? [];
  }, [branchId, control.data, isAllBranches]);

  const loadSessions = useCallback(async () => {
    if (!authoritative || !branchKey) return;
    setLoading(true);
    try {
      const rows = await Promise.all(
        branchKey
          .split("|")
          .filter(Boolean)
          .map(async (selectedBranchId) => {
            const response = await fetch(
              `/api/seramet/inventory/stock-counts?branchId=${encodeURIComponent(selectedBranchId)}&limit=100`,
              { headers: control.headers },
            );
            const body = (await response.json().catch(() => ({}))) as {
              counts?: CountSummary[];
              message?: string;
              error?: string;
            };
            if (!response.ok || !body.counts) {
              throw new Error(
                body.message ?? body.error ?? `Stock count query failed (${response.status})`,
              );
            }
            return body.counts;
          }),
      );
      const flattened = rows.flat().sort((a, b) => b.created_at.localeCompare(a.created_at));
      setSessions(flattened);
      setSelectedId((value) => value || flattened[0]?.id || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Stock count query failed");
    } finally {
      setLoading(false);
    }
  }, [authoritative, branchKey, control.headers]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/seramet/inventory/stock-counts/${encodeURIComponent(selectedId)}`, {
      headers: control.headers,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          detail?: CountDetail;
          message?: string;
          error?: string;
        };
        if (!response.ok || !body.detail) {
          throw new Error(
            body.message ?? body.error ?? `Stock count detail failed (${response.status})`,
          );
        }
        return body.detail;
      })
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setCounts(
          Object.fromEntries(
            next.lines.map((line) => [
              line.inventory_item_id,
              line.counted ? String(line.counted_quantity_minor / 1_000_000) : "",
            ]),
          ),
        );
        setReasons(
          Object.fromEntries(next.lines.map((line) => [line.inventory_item_id, line.reason ?? ""])),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Stock count detail failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [control.headers, selectedId]);

  useEffect(() => {
    if (!warehouseId && currentWarehouses[0]?.id) {
      setWarehouseId(currentWarehouses[0].id);
    }
  }, [currentWarehouses, warehouseId]);

  const activeCount = sessions.filter((row) =>
    ["DRAFT", "COUNTING", "SUBMITTED", "REVIEW"].includes(row.status),
  ).length;
  const varianceValue = sessions
    .filter((row) => row.status === "POSTED")
    .reduce((sum, row) => sum + Number(row.variance_value_minor ?? 0), 0);
  const selectedSummary = sessions.find((row) => row.id === selectedId);
  const editable = detail && ["DRAFT", "COUNTING"].includes(detail.session.status);
  const submitted = detail && ["SUBMITTED", "REVIEW"].includes(detail.session.status);
  const hideExpected = Boolean(
    detail?.session.blind_count && ["DRAFT", "COUNTING"].includes(detail.session.status),
  );
  const locallyCounted = detail
    ? detail.lines.filter((line) => counts[line.inventory_item_id]?.trim() !== "").length
    : 0;
  const localVarianceValue = detail
    ? detail.lines.reduce((sum, line) => {
        const raw = counts[line.inventory_item_id];
        if (raw === undefined || raw.trim() === "") return sum;
        const counted = Number(raw) * 1_000_000;
        if (
          !Number.isFinite(counted) ||
          line.expected_quantity_minor === null ||
          line.unit_cost_minor === null
        ) {
          return sum;
        }
        const variance = counted - line.expected_quantity_minor;
        return sum + (variance / 1_000_000) * (line.unit_cost_minor / 100);
      }, 0)
    : 0;

  const post = async (path: string, body: unknown) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: control.headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        count?: { id?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? `Stock count action failed (${response.status})`,
        );
      }
      await loadSessions();
      if (selectedId) {
        const refreshed = await fetch(
          `/api/seramet/inventory/stock-counts/${encodeURIComponent(selectedId)}`,
          { headers: control.headers },
        );
        if (refreshed.ok) {
          const body = (await refreshed.json()) as { detail: CountDetail };
          setDetail(body.detail);
        }
      }
      return payload;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (announce = true) => {
    if (!detail) return false;
    const entered = detail.lines.filter((line) => counts[line.inventory_item_id]?.trim() !== "");
    if (!entered.length) {
      setNotice("Enter at least one physical quantity before saving.");
      return false;
    }
    const invalid = entered.find((line) => {
      const value = Number(counts[line.inventory_item_id]);
      return !Number.isFinite(value) || value < 0;
    });
    if (invalid) {
      setNotice(`Enter a valid non-negative quantity for ${invalid.name}.`);
      return false;
    }
    const lines = entered.map((line) => ({
      inventoryItemId: line.inventory_item_id,
      countedQuantityMicro: Math.round(Number(counts[line.inventory_item_id]) * 1_000_000),
      ...(reasons[line.inventory_item_id]?.trim()
        ? { reason: reasons[line.inventory_item_id].trim() }
        : {}),
    }));
    try {
      await post(
        `/api/seramet/inventory/stock-counts/${encodeURIComponent(detail.session.id)}/save`,
        { lines },
      );
      if (announce) setNotice("Stock count draft saved.");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Stock count draft could not be saved");
      return false;
    }
  };

  const submit = async () => {
    if (!detail) return;
    if (locallyCounted !== detail.lines.length) {
      setNotice("Count every item in the sheet before submitting for approval.");
      return;
    }
    const saved = await saveDraft(false);
    if (!saved) return;
    try {
      await post(
        `/api/seramet/inventory/stock-counts/${encodeURIComponent(detail.session.id)}/submit`,
        {},
      );
      setNotice("Stock count submitted for approval.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Stock count could not be submitted");
    }
  };

  return (
    <AppShell
      title="Stock count"
      subtitle={`${branchLabel} - authoritative physical-count sessions and variance approval`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative || control.status !== "ready" || isAllBranches}
          onClick={() => setShowStart((value) => !value)}
        >
          {showStart ? "Close" : "Start count"}
        </Btn>
      }
    >
      {(notice || control.error || loading) && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || "Loading authoritative stock counts..."}
        </div>
      )}
      {isAllBranches && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[12px]">
          Select a single branch before starting a stock count. Existing sessions from all
          accessible branches remain visible below.
        </div>
      )}

      {showStart && !isAllBranches && (
        <Panel className="mb-4">
          <PanelHead
            title="Start warehouse count"
            sub="Seramet snapshots the expected stock before physical counting begins"
          />
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
              Warehouse
              <select
                className={inputClass}
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value="">Select warehouse</option>
                {currentWarehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-[12px] font-semibold">
              <input
                type="checkbox"
                checked={blindCount}
                onChange={(event) => setBlindCount(event.target.checked)}
              />
              Blind count — hide expected quantities from the counter
            </label>
            <div className="flex items-end justify-end">
              <Btn
                variant="primary"
                disabled={!warehouseId || busy}
                onClick={() => {
                  void post("/api/seramet/inventory/stock-counts/start", {
                    branchId,
                    warehouseId,
                    blindCount,
                    idempotencyKey: crypto.randomUUID(),
                  })
                    .then(async (payload) => {
                      const id = payload.count?.id;
                      if (id) setSelectedId(id);
                      setShowStart(false);
                      setNotice("Stock count session started.");
                    })
                    .catch((error) =>
                      setNotice(error instanceof Error ? error.message : "Could not start count"),
                    );
                }}
              >
                Start count
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Count sessions" value={sessions.length} />
        <Metric label="Active counts" value={activeCount} invert={activeCount > 0} />
        <Metric
          label="Selected progress"
          value={detail ? `${locallyCounted}/${detail.lines.length}` : "—"}
        />
        <Metric label="Posted variance" value={varianceValue / 100} money />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[320px_1fr]">
        <Panel>
          <PanelHead title="Count history" sub="Draft, review and posted sessions" />
          <div className="max-h-[680px] overflow-auto divide-y divide-border">
            {sessions.map((row) => (
              <button
                type="button"
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                className={`w-full px-4 py-3 text-left hover:bg-secondary/60 ${
                  selectedId === row.id ? "bg-secondary" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-bold">{row.warehouse_name}</div>
                    <div className="num mt-0.5 text-[10px] text-muted-foreground">
                      {row.business_date} · {row.counted_count}/{row.item_count}
                    </div>
                  </div>
                  <Status>{row.status}</Status>
                </div>
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                  <span>{row.blind_count ? "Blind count" : "Visible expected"}</span>
                  <span>
                    {row.variance_count === null
                      ? "Variance hidden"
                      : `${row.variance_count} variance(s)`}
                  </span>
                </div>
              </button>
            ))}
            {!sessions.length && !loading && (
              <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                No stock count sessions yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          {!detail ? (
            <div className="px-4 py-16 text-center text-[12px] text-muted-foreground">
              Start or select a stock count session.
            </div>
          ) : (
            <>
              <PanelHead
                title={detail.session.warehouse_name}
                sub={`${detail.session.business_date} · snapshot ${detail.session.snapshot_at ?? "unavailable"}`}
                right={<Status>{detail.session.status}</Status>}
              />
              <div className="grid grid-cols-2 gap-3 border-b border-border p-4 md:grid-cols-4">
                <Metric label="Items" value={detail.lines.length} />
                <Metric label="Counted" value={locallyCounted} />
                <Metric
                  label="Variance items"
                  value={
                    hideExpected
                      ? "Hidden"
                      : detail.lines.filter((line) => {
                          const value = counts[line.inventory_item_id];
                          if (value === undefined || value === "") return false;
                          return (
                            line.expected_quantity_minor !== null &&
                            Math.round(Number(value) * 1_000_000) !== line.expected_quantity_minor
                          );
                        }).length
                  }
                />
                <Metric
                  label="Variance value"
                  value={hideExpected ? "Hidden" : Math.round(localVarianceValue)}
                  {...(!hideExpected ? { money: true } : {})}
                />
              </div>

              <div className="overflow-x-auto">
                <DataTable
                  cols={[
                    "Item",
                    "SKU",
                    "Unit",
                    { l: "Expected", r: true },
                    { l: "Physical", r: true },
                    { l: "Variance", r: true },
                    { l: "Value impact", r: true },
                    "Reason",
                  ]}
                >
                  {detail.lines.map((line) => {
                    const raw = counts[line.inventory_item_id] ?? "";
                    const entered = raw.trim() !== "";
                    const physical = entered ? Number(raw) : null;
                    const variance =
                      physical === null || line.expected_quantity_minor === null
                        ? null
                        : physical - line.expected_quantity_minor / 1_000_000;
                    const valueImpact =
                      variance === null || line.unit_cost_minor === null
                        ? null
                        : variance * (line.unit_cost_minor / 100);
                    return (
                      <tr key={line.id} className="hover:bg-secondary/50">
                        <TD className="font-semibold">{line.name}</TD>
                        <TD className="num text-muted-foreground">{line.sku ?? line.code}</TD>
                        <TD className="text-muted-foreground">{line.unit_symbol ?? "unit"}</TD>
                        <TD className="num text-right">
                          {hideExpected || line.expected_quantity_minor === null
                            ? "Hidden"
                            : quantity(line.expected_quantity_minor)}
                        </TD>
                        <TD className="text-right">
                          {editable ? (
                            <input
                              inputMode="decimal"
                              min="0"
                              value={raw}
                              onChange={(event) =>
                                setCounts((current) => ({
                                  ...current,
                                  [line.inventory_item_id]: event.target.value,
                                }))
                              }
                              className="num h-9 w-24 rounded-md border border-border bg-card px-2 text-right text-[14px] font-semibold outline-none focus:ring-2 focus:ring-ring/40"
                              placeholder="-"
                            />
                          ) : (
                            <span className="num font-semibold">
                              {quantity(line.counted_quantity_minor)}
                            </span>
                          )}
                        </TD>
                        <TD className="num text-right font-semibold">
                          {hideExpected || variance === null
                            ? "—"
                            : variance > 0
                              ? `+${formatQuantity(variance)}`
                              : formatQuantity(variance)}
                        </TD>
                        <TD className="num text-right">
                          {hideExpected || valueImpact === null || valueImpact === 0
                            ? "—"
                            : ksh(Math.round(valueImpact))}
                        </TD>
                        <TD>
                          {editable ? (
                            <select
                              value={reasons[line.inventory_item_id] ?? ""}
                              onChange={(event) =>
                                setReasons((current) => ({
                                  ...current,
                                  [line.inventory_item_id]: event.target.value,
                                }))
                              }
                              className="h-8 min-w-[150px] rounded-md border border-border bg-card px-2 text-[11px]"
                            >
                              <option value="">No reason yet</option>
                              <option value="COUNT_CORRECTION">Count correction</option>
                              <option value="WASTAGE_NOT_LOGGED">Wastage not logged</option>
                              <option value="RECEIVING_ERROR">Receiving error</option>
                              <option value="PORTION_VARIANCE">Portion variance</option>
                              <option value="DAMAGE_OR_BREAKAGE">Damage / breakage</option>
                              <option value="OTHER_VERIFIED">Other verified reason</option>
                            </select>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {line.reason || "—"}
                            </span>
                          )}
                        </TD>
                      </tr>
                    );
                  })}
                </DataTable>
              </div>

              {(editable || submitted) && (
                <div className="border-t border-border p-4">
                  <label className="mb-3 grid gap-1 text-[11px] font-semibold text-muted-foreground">
                    {submitted
                      ? "Approval / cancellation reason"
                      : "Cancellation reason (if needed)"}
                    <input
                      value={decisionReason}
                      onChange={(event) => setDecisionReason(event.target.value)}
                      className={inputClass}
                      placeholder={
                        submitted
                          ? "Example: Independent recount verified the variance"
                          : "Required only when cancelling this count"
                      }
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    {editable && (
                      <>
                        <Btn disabled={busy} onClick={() => void saveDraft()}>
                          Save draft
                        </Btn>
                        <Btn
                          disabled={busy}
                          onClick={() => {
                            if (!decisionReason.trim()) {
                              setNotice("Enter a cancellation reason first.");
                              return;
                            }
                            void post(
                              `/api/seramet/inventory/stock-counts/${encodeURIComponent(detail.session.id)}/cancel`,
                              { reason: decisionReason.trim() },
                            )
                              .then(() => setNotice("Stock count cancelled."))
                              .catch((error) =>
                                setNotice(
                                  error instanceof Error
                                    ? error.message
                                    : "Stock count could not be cancelled",
                                ),
                              );
                          }}
                        >
                          Cancel count
                        </Btn>
                        <Btn variant="primary" disabled={busy} onClick={() => void submit()}>
                          Submit for approval
                        </Btn>
                      </>
                    )}
                    {submitted && (
                      <>
                        <Btn
                          disabled={busy || !decisionReason.trim()}
                          onClick={() =>
                            void post(
                              `/api/seramet/inventory/stock-counts/${encodeURIComponent(detail.session.id)}/cancel`,
                              { reason: decisionReason.trim() },
                            )
                              .then(() => setNotice("Stock count cancelled."))
                              .catch((error) =>
                                setNotice(
                                  error instanceof Error
                                    ? error.message
                                    : "Stock count could not be cancelled",
                                ),
                              )
                          }
                        >
                          Reject / cancel
                        </Btn>
                        <Btn
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            void post(
                              `/api/seramet/inventory/stock-counts/${encodeURIComponent(detail.session.id)}/approve`,
                              decisionReason.trim() ? { reason: decisionReason.trim() } : {},
                            )
                              .then(() =>
                                setNotice("Stock count approved and posted to inventory."),
                              )
                              .catch((error) =>
                                setNotice(
                                  error instanceof Error
                                    ? error.message
                                    : "Stock count could not be approved",
                                ),
                              )
                          }
                        >
                          Approve & post
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              )}

              {selectedSummary?.status === "POSTED" && (
                <div className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
                  This session is posted and immutable. Corrections must be made through a new stock
                  count or an authorized inventory adjustment.
                </div>
              )}
            </>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function quantity(value: number) {
  return (Number(value) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatQuantity(value: number) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
