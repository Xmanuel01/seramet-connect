import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RefreshCcw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, TD, TH } from "@/components/app/ui";
import { formatMoney } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { getSerametAccessToken } from "@/lib/access-token";
import type { PayrollAttendanceRow } from "@/server/payroll-attendance";

export const Route = createFileRoute("/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll - Seramet" },
      {
        name: "description",
        content: "Monthly pay for your staff, with lateness deductions from their clock-ins.",
      },
    ],
  }),
  component: Payroll,
});

type PayrollRow = PayrollAttendanceRow & {
  basePay: number;
  lateDeduction: number;
  netPay: number;
};

function currentMonth(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date()).slice(0, 7);
}

function hours(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function Payroll() {
  const {
    activeTenantId,
    branchId,
    branchRecords,
    isAllBranches,
    branchLabel,
    hasPermission,
    timeZone,
  } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [month, setMonth] = useState(() => currentMonth(timeZone));
  const [staff, setStaff] = useState<{ scope: string; rows: PayrollAttendanceRow[] } | null>(null);
  // Single-branch payroll starts loading straight away, so it never flashes "No staff".
  const [loading, setLoading] = useState(!isAllBranches);
  const [notice, setNotice] = useState("");
  const [payDrafts, setPayDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const scope = `${activeTenantId}:${branchId}:${isAllBranches ? "ALL" : "BRANCH"}:${month}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const canEditPay = !isAllBranches && hasPermission("payroll.manage");
  const branchName = branchRecords.find((branch) => branch.id === branchId)?.name ?? branchId;

  const load = useCallback(async () => {
    if (isAllBranches) return;
    const requestScope = scope;
    setLoading(true);
    try {
      const token = getSerametAccessToken();
      const response = await fetch(
        `/api/seramet/attendance/payroll?branchId=${encodeURIComponent(branchId)}&month=${month}`,
        {
          headers: {
            "x-seramet-tenant-id": activeTenantId,
            "x-seramet-branch-id": branchId,
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(15000),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        employees?: PayrollAttendanceRow[];
        message?: string;
      };
      if (scopeRef.current !== requestScope) return;
      if (!response.ok) throw new Error(body.message ?? "Couldn't load payroll.");
      setStaff({ scope: requestScope, rows: body.employees ?? [] });
      setNotice("");
    } catch (error) {
      if (scopeRef.current === requestScope)
        setNotice(error instanceof Error ? error.message : "Couldn't load payroll.");
    } finally {
      if (scopeRef.current === requestScope) setLoading(false);
    }
  }, [activeTenantId, branchId, isAllBranches, month, scope]);

  useEffect(() => {
    setPayDrafts({});
    setNotice("");
    void load();
  }, [load]);

  // Pay amounts live with the audited transaction records; attendance comes from clock-ins.
  const rows: PayrollRow[] = (staff?.scope === scope ? staff.rows : []).map((employee) => {
    const pay = state.employees.find((record) => record.id === employee.id);
    const basePay = pay?.netMonthlyPay ?? 0;
    const workingMinutes = Math.max(
      1,
      (pay?.monthlyWorkDays ?? 26) * (pay?.standardDailyHours ?? 8) * 60,
    );
    const lateDeduction = Math.min(
      basePay,
      Math.round((basePay / workingMinutes) * employee.lateMinutes * 100) / 100,
    );
    return { ...employee, basePay, lateDeduction, netPay: basePay - lateDeduction };
  });
  const total = (key: "basePay" | "lateDeduction" | "netPay") =>
    rows.reduce((sum, row) => sum + row[key], 0);

  const savePay = async (row: PayrollRow, value: string) => {
    if (savingRef.current || !canEditPay) return;
    const nextPay = Number(value);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(value) ||
      !Number.isFinite(nextPay) ||
      !Number.isSafeInteger(Math.round(nextPay * 100))
    ) {
      setNotice("Enter the monthly pay as a number, with at most two decimal places.");
      return;
    }
    if (nextPay === row.basePay) return;
    const requestScope = scope;
    savingRef.current = true;
    setSaving(true);
    setNotice(`Saving ${row.name}'s pay…`);
    try {
      const result = await mutate("setEmployeeNetPay", {
        employeeId: row.id,
        netMonthlyPay: nextPay,
        name: row.name,
        branchId,
        branch: branchName,
        ...(row.jobTitle ? { role: row.jobTitle } : {}),
      });
      if (scopeRef.current !== requestScope) return;
      const saved = result.state.employees.find((employee) => employee.id === row.id);
      if (("offline" in result && result.offline) || saved?.netMonthlyPay !== nextPay)
        throw new Error("The pay change wasn't confirmed. Your entry is kept; try again.");
      setPayDrafts((drafts) => {
        const next = { ...drafts };
        delete next[row.id];
        return next;
      });
      setNotice(`${row.name}'s pay is saved.`);
    } catch (error) {
      if (scopeRef.current === requestScope)
        setNotice(error instanceof Error ? error.message : "The pay change wasn't saved.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const lines = [
      [
        "Employee",
        "Code",
        "Days",
        "Hours",
        "Late minutes",
        "Base pay",
        "Late deduction",
        "Net pay",
      ],
      ...rows.map((row) => [
        row.name,
        row.employeeCode ?? "",
        String(row.daysWorked),
        (row.workedMinutes / 60).toFixed(2),
        String(row.lateMinutes),
        row.basePay.toFixed(2),
        row.lateDeduction.toFixed(2),
        row.netPay.toFixed(2),
      ]),
    ]
      .map((line) => line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `payroll-${branchName.replace(/\W+/g, "-").toLowerCase()}-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      title="Payroll"
      subtitle={branchLabel}
      actions={
        <>
          <input
            type="month"
            aria-label="Month"
            className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            value={month}
            max={currentMonth(timeZone)}
            onChange={(event) => event.target.value && setMonth(event.target.value)}
          />
          <Btn onClick={() => void load()} disabled={loading} title="Refresh">
            <RefreshCcw className="h-4 w-4" />
          </Btn>
          <Btn onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4" />
            Export
          </Btn>
        </>
      }
    >
      {isAllBranches ? (
        <p role="status" className="rounded-md border border-border bg-card p-4 text-sm">
          Pick a single branch to see its payroll.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Employees" value={rows.length} />
            <Metric label="Monthly pay" value={Math.round(total("basePay"))} money />
            <Metric
              label="Late deductions"
              value={Math.round(total("lateDeduction"))}
              money
              invert={total("lateDeduction") > 0}
            />
            <Metric label="Net pay" value={Math.round(total("netPay"))} money />
          </div>
          {notice && (
            <p
              role="status"
              className="mt-4 rounded-md border border-border bg-card px-4 py-3 text-sm"
            >
              {notice}
            </p>
          )}
          <Panel className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <TH>Employee</TH>
                  <TH className="text-right">Days</TH>
                  <TH className="text-right">Hours</TH>
                  <TH className="text-right">Late (min)</TH>
                  <TH className="text-right">Monthly pay</TH>
                  <TH className="text-right">Late deduction</TH>
                  <TH className="text-right">Net pay</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-secondary/50">
                    <TD>
                      <div className="font-semibold">
                        {row.name}
                        {row.left ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            Left
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[row.employeeCode, row.jobTitle].filter(Boolean).join(" · ")}
                        {row.openShifts
                          ? ` · ${row.openShifts} shift${row.openShifts === 1 ? "" : "s"} still open`
                          : ""}
                      </div>
                    </TD>
                    <TD className="num text-right">{row.daysWorked}</TD>
                    <TD className="num text-right">{hours(row.workedMinutes)}</TD>
                    <TD className="num text-right">{row.lateMinutes}</TD>
                    <TD className="text-right">
                      <input
                        inputMode="decimal"
                        aria-label={`Monthly pay for ${row.name}`}
                        disabled={!canEditPay || saving || backendStatus === "loading"}
                        value={payDrafts[row.id] ?? String(row.basePay)}
                        onChange={(event) =>
                          setPayDrafts((drafts) => ({ ...drafts, [row.id]: event.target.value }))
                        }
                        onBlur={(event) => void savePay(row, event.target.value.trim())}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right text-[12px] font-semibold outline-none focus:border-primary"
                      />
                    </TD>
                    <TD
                      className={`num text-right ${row.lateDeduction ? "text-danger" : "text-muted-foreground"}`}
                    >
                      {row.lateDeduction ? formatMoney(row.lateDeduction) : "—"}
                    </TD>
                    <TD className="num text-right font-semibold">{formatMoney(row.netPay)}</TD>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <TD colSpan={7} className="text-muted-foreground">
                      {loading
                        ? "Loading…"
                        : "No staff in this branch. Add them on the Employees page."}
                    </TD>
                  </tr>
                )}
              </tbody>
            </table>
          </Panel>
          <p className="mt-3 text-xs text-muted-foreground">
            Net pay is monthly pay less late minutes at each employee&apos;s per-minute rate (26
            days of 8 hours). Taxes and statutory deductions aren&apos;t included.
          </p>
        </>
      )}
    </AppShell>
  );
}
