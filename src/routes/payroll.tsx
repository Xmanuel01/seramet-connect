import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine } from "@/lib/transaction-engine";

export const Route = createFileRoute("/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll - Seramet" },
      {
        name: "description",
        content: "Payroll estimate, lateness deductions, allowances and controlled run status.",
      },
      { property: "og:title", content: "Payroll - Seramet" },
      {
        property: "og:description",
        content: "Attendance-linked payroll preview with minute-level lateness deductions.",
      },
    ],
  }),
  component: Payroll,
});

function Payroll() {
  const { activeTenantId, branchId, isAllBranches, branchLabel, hasPermission } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [notice, setNotice] = useState("");
  const [payDrafts, setPayDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const scopeKey = `${activeTenantId}:${branchId}:${isAllBranches ? "ALL" : "BRANCH"}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const canEditPay = !isAllBranches && hasPermission("payroll.manage");
  useEffect(() => {
    setPayDrafts({});
    setNotice("");
  }, [scopeKey]);
  const rows =
    isAllBranches || state.tenantId !== activeTenantId
      ? []
      : TransactionEngine.getPayrollPreview(state, branchId);
  const baseNet = rows.reduce((sum, row) => sum + row.employee.netMonthlyPay, 0);
  const lateDeductions = rows.reduce((sum, row) => sum + row.latenessDeduction, 0);
  const adjustedNet = rows.reduce((sum, row) => sum + row.adjustedNetPay, 0);
  const lateMinutes = rows.reduce((sum, row) => sum + row.lateMinutes, 0);

  const savePay = async (employeeId: string, name: string, value: string, previous: number) => {
    if (savingRef.current || !canEditPay) return;
    const nextPay = Number(value);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(value) ||
      !Number.isFinite(nextPay) ||
      nextPay < 0 ||
      !Number.isSafeInteger(Math.round(nextPay * 100))
    ) {
      setNotice("Enter a non-negative base net pay with at most two decimal places.");
      return;
    }
    if (nextPay === previous) return;
    const requestScope = scopeKey;
    savingRef.current = true;
    setSaving(true);
    setNotice("Saving base net pay...");
    try {
      const result = await mutate("setEmployeeNetPay", { employeeId, netMonthlyPay: nextPay });
      if (scopeRef.current !== requestScope) return;
      const saved = result.state.employees.find((employee) => employee.id === employeeId);
      if (("offline" in result && result.offline) || saved?.netMonthlyPay !== nextPay) {
        throw new Error("The server has not confirmed this pay change. Your entry was retained.");
      }
      setPayDrafts((drafts) => {
        const next = { ...drafts };
        delete next[employeeId];
        return next;
      });
      setNotice(`${name}'s base net pay updated.`);
    } catch (error) {
      if (scopeRef.current === requestScope) {
        setNotice(error instanceof Error ? error.message : "Pay change could not be saved.");
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Payroll"
      subtitle={`Historical payroll preview - ${branchLabel}`}
      actions={
        <>
          <Btn
            onClick={() =>
              setNotice("Review base net pay and attendance exceptions before approval.")
            }
          >
            Review changes
          </Btn>
          <Btn variant="primary" disabled>
            Run payroll
          </Btn>
        </>
      }
    >
      {isAllBranches && (
        <p role="status" className="mb-4 rounded-md border border-border p-3 text-sm">
          Select a single branch to review payroll. Work schedules and payroll periods are
          branch-specific.
        </p>
      )}
      <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">
        Payroll history. Clock-in records are kept in Attendance and do not add overtime
        automatically.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Base net pay" value={Math.round(baseNet)} money />
        <Metric label="Employees" value={rows.length} />
        <Metric label="Late minutes" value={lateMinutes} invert={lateMinutes > 0} />
        <Metric
          label="Late deductions"
          value={Math.round(lateDeductions)}
          money
          invert={lateDeductions > 0}
        />
        <Metric label="Adjusted net" value={Math.round(adjustedNet)} money />
      </div>
      <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
        Late minutes are deducted at each employee's per-minute rate (monthly net pay ÷ work days ÷
        daily hours ÷ 60). Statutory deductions are not filed from here yet.
        {notice ? ` ${notice}` : ""}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHead
            title="Payroll register"
            sub="Base net pay and minute-level lateness deduction from attendance"
            right={<Status>Draft</Status>}
          />
          <div className="grid gap-3 p-3 md:hidden">
            {rows.map((row) => (
              <article
                key={row.employee.id}
                className="rounded-lg border border-border bg-card p-3 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold">{row.employee.name}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {row.employee.role} - {row.employee.branch}
                    </div>
                  </div>
                  <Status>{row.lateMinutes > 0 ? "Attention" : "Calculated"}</Status>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Base net</span>
                    <span className="num font-semibold">{ksh(row.employee.netMonthlyPay)}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Late</span>
                    <span className="num font-semibold">{row.lateMinutes} min</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Deduct</span>
                    <span className="num font-semibold">{ksh(row.latenessDeduction)}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="block text-muted-foreground">Adjusted</span>
                    <span className="num font-semibold">{ksh(row.adjustedNetPay)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Role</TH>
                  <TH>Branch</TH>
                  <TH className="text-right">Base net</TH>
                  <TH className="text-right">Hourly rate</TH>
                  <TH className="text-right">Minute rate</TH>
                  <TH className="text-right">Late min</TH>
                  <TH className="text-right">Late deduction</TH>
                  <TH className="text-right">Adjusted net</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee.id} className="hover:bg-secondary/50">
                    <TD className="font-semibold">{row.employee.name}</TD>
                    <TD className="text-muted-foreground">{row.employee.role}</TD>
                    <TD className="text-muted-foreground">{row.employee.branch}</TD>
                    <TD className="text-right">
                      <input
                        type="number"
                        min="0"
                        aria-label={`Base net pay for ${row.employee.name}`}
                        disabled={!canEditPay || saving || backendStatus === "loading"}
                        value={payDrafts[row.employee.id] ?? String(row.employee.netMonthlyPay)}
                        onChange={(event) =>
                          setPayDrafts((drafts) => ({
                            ...drafts,
                            [row.employee.id]: event.target.value,
                          }))
                        }
                        onBlur={(event) =>
                          void savePay(
                            row.employee.id,
                            row.employee.name,
                            event.target.value,
                            row.employee.netMonthlyPay,
                          )
                        }
                        className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right text-[12px] font-semibold outline-none focus:border-primary"
                      />
                    </TD>
                    <TD className="num text-right">{ksh(row.hourlyRate)}</TD>
                    <TD className="num text-right">{ksh(row.minuteRate)}</TD>
                    <TD className="num text-right font-semibold">{row.lateMinutes}</TD>
                    <TD className="num text-right text-danger">{ksh(row.latenessDeduction)}</TD>
                    <TD className="num text-right font-semibold">{ksh(row.adjustedNetPay)}</TD>
                    <TD>
                      <Status>{row.lateMinutes > 0 ? "Attention" : "Calculated"}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Run controls" sub="High-risk changes require approval" />
          <div className="space-y-3 p-4 text-[13px]">
            {[
              ["Attendance linked", true],
              ["Lateness deductions calculated", true],
              ["Base net pay reviewed", true],
              ["Statutory payroll configuration", false],
              ["Finance approval", false],
            ].map(([step, complete]) => (
              <div
                key={String(step)}
                className="flex items-center justify-between rounded-md bg-secondary/60 px-3 py-2"
              >
                <span className="font-semibold">{String(step)}</span>
                <Status>{complete ? "Approved" : "Pending"}</Status>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
