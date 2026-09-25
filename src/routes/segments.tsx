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
      setMessage("Segment created. Build its branch snapshot to see members.");
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
      setMessage(
        "Snapshot recorded: " +
          response.snapshot.customerCount +
          " matched customers. Evidence: " +
          readableStatus(response.snapshot.quality),
      );
      list.refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      title="Customer segments"
      subtitle={"Auditable, rule-based segments from completed orders - " + branchLabel}
      actions={
        canManage ? (
          <Btn variant="primary" onClick={() => setEditing((value) => !value)}>
            {editing ? "Cancel" : "Create segment"}
          </Btn>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty title="Access restricted" body="CRM viewing permission is required." />
        </Panel>
      ) : (
        <>
          {message && <p role="status" className="mb-3 text-[12px] text-success">{message}</p>}
          {error && <p role="alert" className="mb-3 text-[12px] text-danger">{error}</p>}
          {editing && canManage && (
            <Panel className="mb-4">
              <PanelHead
                title="New segment"
                sub="Only transparent behavior-based rules; monetary and protected-trait filters are excluded."
              />
              <form className="grid gap-3 p-4 md:grid-cols-2" onSubmit={create}>
                <label className="grid gap-1 text-[12px]">
                  Segment code
                  <input className={crmFieldClass} required maxLength={40} value={code} onChange={(event) => setCode(event.target.value)} />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Segment name
                  <input className={crmFieldClass} required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Condition
                  <select className={crmFieldClass} value={field} onChange={(event) => setField(event.target.value as NumericField)}>
                    {Object.entries(fieldLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px]">
                  Comparison
                  <select className={crmFieldClass} value={operator} onChange={(event) => setOperator(event.target.value as Operator)}>
                    <option value="GTE">At least</option>
                    <option value="LTE">At most</option>
                    <option value="GT">Greater than</option>
                    <option value="LT">Less than</option>
                    <option value="EQ">Exactly</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[12px]">
                  Threshold
                  <input className={crmFieldClass} type="number" min={0} step={1} required value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
                </label>
                <div className="md:col-span-2">
                  <Btn variant="primary" type="submit" disabled={busy !== null}>{busy ? "Saving..." : "Create"}</Btn>
                </div>
              </form>
            </Panel>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Configured segments" value={rows.length} />
            <Metric label="Segments with snapshots" value={rows.filter((row) => row.latest_count !== null).length} />
            <Metric label="Snapshot coverage" value="Branch-specific" />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Current segments"
              sub="Snapshot counts are only from the selected branch; they are not live audience guarantees."
              right={<Btn onClick={list.refresh}>Refresh</Btn>}
            />
            {list.status === "loading" ? (
              <CrmLoading />
            ) : list.status === "error" ? (
              <CrmError message={list.error} retry={list.refresh} />
            ) : rows.length === 0 ? (
              <CrmEmpty title="No segments configured" body="Create a rule and build an evidence snapshot before scheduling a campaign." />
            ) : (
              <div className="divide-y divide-border">
                {rows.map((row) => (
                  <article key={row.id} className="space-y-2 p-4 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{row.name}</strong>
                      <Status>{readableStatus(row.status)}</Status>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                      {row.description || row.definition_json}
                    </p>
                    <p>
                      Last branch snapshot:{" "}
                      {row.latest_count === null ? "Not calculated" : row.latest_count + " customers"}
                      {" · "}Evidence: {readableStatus(row.latest_quality)}
                    </p>
                    <Btn onClick={() => void snapshot(row.id)} disabled={busy !== null}>
                      {busy === row.id ? "Calculating..." : "Rebuild branch snapshot"}
                    </Btn>
                  </article>
                ))}
              </div>
            )}
            <p className="border-t border-border p-3 text-[12px] text-muted-foreground">
              <Link to="/campaigns" className="font-semibold underline">Campaigns</Link>
              {" "}only send to customers with recorded consent and eligible provider channels.
            </p>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
