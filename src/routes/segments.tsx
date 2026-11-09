import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus, shortDate } from "@/crm/crm-ui";
import { crmErrorMessage, crmFieldClass, useCrmScreenQuery } from "@/crm/use-crm-screen";
import { useCrmApi } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/segments")({
  head: () => ({ meta: [{ title: "Customer segments - Seramet" }] }),
  component: Segments,
});

type Segment = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  definition_json: string;
  latest_count: number | null;
  latest_quality: string | null;
};
type SegmentResponse = { ok: boolean; segments: Segment[] };
type SnapshotResponse = {
  ok: boolean;
  snapshot: { id: string; customerCount: number; quality: string };
};
type NumericField = "orderCount" | "daysSinceLastVisit" | "loyaltyPoints";
type Operator = "GTE" | "LTE" | "GT" | "LT" | "EQ";
const fieldLabels: Record<NumericField, string> = {
  orderCount: "Completed order count",
  daysSinceLastVisit: "Days since last visit",
  loyaltyPoints: "Loyalty points",
};

function Segments() {
  const { branchId, branchLabel, hasPermission } = useAppContext();
  const canView = hasPermission(permissions.crmView);
  const canManage = hasPermission(permissions.campaignManage);
  const { command } = useCrmApi();
  const apiPath = "/api/seramet/crm/segments?branchId=" + encodeURIComponent(branchId);
  const list = useCrmScreenQuery<SegmentResponse>(apiPath, canView);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [field, setField] = useState<NumericField>("orderCount");
  const [operator, setOperator] = useState<Operator>("GTE");
  const [threshold, setThreshold] = useState(2);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const rows = list.data?.segments ?? [];

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || busy) return;
    setBusy("create");
    setError("");
    try {
      await command("/api/seramet/crm/segments", {
        name: name.trim(),
        code: code.trim(),
        definition: { all: [{ field, operator, value: threshold }] },
      });
      setEditing(false);
      setName("");
      setCode("");
      setMessage("Group created. Press Count customers to see who's in it.");
      list.refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function snapshot(id: string) {
    if (!canView || busy) return;
    setBusy(id);
    setError("");
    setMessage("");
    try {
      const response = await command<SnapshotResponse>(
        "/api/seramet/crm/segments/" +
          encodeURIComponent(id) +
          "/snapshot?branchId=" +
          encodeURIComponent(branchId),
        {},
      );
      setMessage(`${response.snapshot.customerCount} customers in this group.`);
      list.refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      title="Customer groups"
      subtitle={branchLabel}
      actions={
        canManage ? (
          <Btn variant="primary" onClick={() => setEditing((value) => !value)}>
            {editing ? "Cancel" : "New group"}
          </Btn>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty title="No access" body="Ask the owner to give your role access to customers." />
        </Panel>
      ) : (
        <>
          {message && (
            <p role="status" className="mb-3 text-[12px] text-success">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 text-[12px] text-danger">
              {error}
            </p>
          )}
          {editing && canManage && (
            <Panel className="mb-4">
              <PanelHead title="New group" />
              <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={create}>
                <label className="grid gap-1 text-[12px]">
                  Short code
                  <input
                    className={crmFieldClass}
                    required
                    maxLength={40}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Name
                  <input
                    className={crmFieldClass}
                    required
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Customers whose
                  <select
                    className={crmFieldClass}
                    value={field}
                    onChange={(event) => setField(event.target.value as NumericField)}
                  >
                    {Object.entries(fieldLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px]">
                  Is
                  <select
                    className={crmFieldClass}
                    value={operator}
                    onChange={(event) => setOperator(event.target.value as Operator)}
                  >
                    <option value="GTE">At least</option>
                    <option value="LTE">At most</option>
                    <option value="GT">Greater than</option>
                    <option value="LT">Less than</option>
                    <option value="EQ">Exactly</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[12px]">
                  Number
                  <input
                    className={crmFieldClass}
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={threshold}
                    onChange={(event) => setThreshold(Number(event.target.value))}
                  />
                </label>
                <div className="md:col-span-2">
                  <Btn variant="primary" type="submit" disabled={busy !== null}>
                    {busy ? "Saving…" : "Create group"}
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Groups" value={rows.length} />
            <Metric
              label="Counted"
              value={rows.filter((row) => row.latest_count !== null).length}
            />
          </div>
          <Panel className="mt-4">
            <PanelHead title="All groups" right={<Btn onClick={list.refresh}>Refresh</Btn>} />
            {list.status === "loading" ? (
              <CrmLoading />
            ) : list.status === "error" ? (
              <CrmError message={list.error} retry={list.refresh} />
            ) : rows.length === 0 ? (
              <CrmEmpty
                title="No groups yet"
                body="Create a group, like customers with 5 or more orders, to send them a campaign."
              />
            ) : (
              <div className="divide-y divide-border">
                {rows.map((row) => (
                  <article key={row.id} className="space-y-2 p-4 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{row.name}</strong>
                      <Status>{readableStatus(row.status)}</Status>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {row.description || describeRule(row.definition_json)}
                    </p>
                    <p>
                      {row.latest_count === null
                        ? "Not counted yet"
                        : row.latest_count + " customers at this branch"}
                    </p>
                    <Btn onClick={() => void snapshot(row.id)} disabled={busy !== null}>
                      {busy === row.id ? "Counting…" : "Count customers"}
                    </Btn>
                  </article>
                ))}
              </div>
            )}
            <p className="border-t border-border p-3 text-[12px] text-muted-foreground">
              <Link to="/campaigns" className="font-semibold underline">
                Campaigns
              </Link>{" "}
              only go to customers who agreed to messages.
            </p>
          </Panel>
        </>
      )}
    </AppShell>
  );
}

const operatorWords: Record<string, string> = {
  GTE: "at least",
  LTE: "at most",
  GT: "more than",
  LT: "less than",
  EQ: "exactly",
};

function describeRule(json: string) {
  try {
    const rules = (
      JSON.parse(json) as { all?: { field: string; operator: string; value: number }[] }
    ).all;
    if (!rules?.length) return "";
    return rules
      .map(
        (rule) =>
          `${fieldLabels[rule.field as NumericField] ?? rule.field} ${operatorWords[rule.operator] ?? rule.operator} ${rule.value}`,
      )
      .join(" and ");
  } catch {
    return "";
  }
}
