import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PosCustomerPicker } from "@/components/app/PosCustomerPicker";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus } from "@/crm/crm-ui";
import { crmErrorMessage, crmFieldClass, useCrmScreenQuery } from "@/crm/use-crm-screen";
import { useCrmApi } from "@/crm/use-crm";
import type { PosCustomerIdentity } from "@/crm/pos-customer-link";
import { useAppContext } from "@/lib/app-context";
import { parseMajorAmount } from "@/payments/money";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/loyalty")({
  head: () => ({ meta: [{ title: "Loyalty - Seramet" }] }),
  component: Loyalty,
});

type Program = {
  id: string;
  name: string;
  code: string;
  status: string;
  earning_type: string;
  spend_minor_per_point: number | null;
  members: number | null;
  outstanding_points: number | null;
};
type Tier = { id: string; program_id: string; name: string; rank: number; active: number };
type Reward = {
  id: string;
  program_id: string;
  name: string;
  reward_type: string;
  points_cost: number;
  active: number;
};
type ProgramsResponse = { ok: boolean; programs: Program[] };
type TiersResponse = { ok: boolean; tiers: Tier[] };
type RewardsResponse = { ok: boolean; rewards: Reward[] };
type LoyaltyForm = "none" | "program" | "tier" | "reward" | "enrol" | "adjust";

function Loyalty() {
  const { branchId, branchLabel, hasPermission, currency } = useAppContext();
  const canView = hasPermission(permissions.loyaltyView);
  const canManage = hasPermission(permissions.loyaltyManage);
  const canAdjust = hasPermission(permissions.loyaltyAdjust);
  const { command } = useCrmApi();
  const programs = useCrmScreenQuery<ProgramsResponse>(
    "/api/seramet/crm/loyalty/programs?branchId=" + encodeURIComponent(branchId),
    canView,
  );
  const tiers = useCrmScreenQuery<TiersResponse>(
    "/api/seramet/crm/loyalty/tiers?branchId=" + encodeURIComponent(branchId),
    canView,
  );
  const rewards = useCrmScreenQuery<RewardsResponse>(
    "/api/seramet/crm/loyalty/rewards?branchId=" + encodeURIComponent(branchId),
    canView,
  );
  const [form, setForm] = useState<LoyaltyForm>("none");
  const [selectedProgram, setSelectedProgram] = useState("");
  const [customer, setCustomer] = useState<PosCustomerIdentity | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cost, setCost] = useState(100);
  const [points, setPoints] = useState(0);
  const [reason, setReason] = useState("");
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeProgram = selectedProgram || programs.data?.programs[0]?.id || "";
  const refresh = () => {
    programs.refresh();
    tiers.refresh();
    rewards.refresh();
  };

  function switchForm(next: LoyaltyForm) {
    setForm(next);
    setError("");
    setNotice("");
    setOperationKey(crypto.randomUUID());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (form === "program" && canManage) {
        await command("/api/seramet/crm/loyalty/programs", {
          code: code.trim(),
          name: name.trim(),
          scopeType: "BRANCH",
          branchId,
          effectiveFrom: new Date().toISOString(),
          earningType: "SPEND",
          spendMinorPerPoint: parseMajorAmount(cost, currency),
          minimumSpendMinor: 0,
          roundingPolicy: "FLOOR",
          expiryType: "NONE",
          eligibleBranchIds: [branchId],
          eligibleChannels: [],
          redemptionRules: {},
        });
      } else if (form === "tier" && canManage) {
        if (!activeProgram) throw new Error("Choose a program first.");
        await command("/api/seramet/crm/loyalty/tiers", {
          programId: activeProgram,
          code: code.trim(),
          name: name.trim(),
          rank: Math.max(0, Math.floor(cost)),
          qualificationType: "POINTS_EARNED",
          thresholdMinorOrPoints: Math.max(0, Math.floor(points)),
          effectiveFrom: new Date().toISOString(),
        });
      } else if (form === "reward" && canManage) {
        if (!activeProgram) throw new Error("Choose a program first.");
        await command("/api/seramet/crm/loyalty/rewards", {
          programId: activeProgram,
          code: code.trim(),
          name: name.trim(),
          rewardType: "FIXED_DISCOUNT",
          pointsCost: Math.max(1, Math.floor(points)),
          valueMinor: parseMajorAmount(cost, currency),
          validFrom: new Date().toISOString(),
        });
      } else if (form === "enrol" && canManage) {
        if (!activeProgram || !customer) throw new Error("Choose a program and customer.");
        await command("/api/seramet/crm/loyalty/memberships", {
          programId: activeProgram,
          customerId: customer.id,
        });
      } else if (form === "adjust" && canAdjust) {
        if (!activeProgram || !customer || !points || reason.trim().length < 4) {
          throw new Error("Choose a program, customer, nonzero points and a recorded reason.");
        }
        await command("/api/seramet/crm/loyalty/adjust", {
          programId: activeProgram,
          customerId: customer.id,
          branchId,
          points,
          reason: reason.trim(),
          idempotencyKey: operationKey,
        });
      } else {
        throw new Error("Your role does not permit this action.");
      }
      setNotice("Operation confirmed by the server.");
      setForm("none");
      setCode("");
      setName("");
      setReason("");
      setOperationKey(crypto.randomUUID());
      refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Loyalty"
      subtitle={"Real loyalty programs, tiers and rewards - " + branchLabel}
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty title="Access restricted" body="Loyalty viewing permission is required." />
        </Panel>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Btn onClick={refresh}>Refresh</Btn>
            {canManage && (
              <>
                <Btn onClick={() => switchForm("program")}>Create program</Btn>
                <Btn onClick={() => switchForm("tier")}>Create tier</Btn>
                <Btn onClick={() => switchForm("reward")}>Create reward</Btn>
                <Btn onClick={() => switchForm("enrol")}>Enrol customer</Btn>
              </>
            )}
            {canAdjust && <Btn onClick={() => switchForm("adjust")}>Adjust points</Btn>}
          </div>
          {notice && (
            <p role="status" className="mb-3 text-[12px] text-success">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 text-[12px] text-danger">
              {error}
            </p>
          )}
          {form !== "none" && (
            <Panel className="mb-4">
              <PanelHead
                title={readableStatus(form)}
                sub="All changes are saved to the authoritative loyalty service."
              />
              <form onSubmit={submit} className="grid gap-3 p-4 md:grid-cols-2">
                {!["program"].includes(form) && (
                  <label className="grid gap-1 text-[12px]">
                    Program
                    <select
                      className={crmFieldClass}
                      value={activeProgram}
                      onChange={(event) => setSelectedProgram(event.target.value)}
                      required
                    >
                      {programs.data?.programs.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {["program", "tier", "reward"].includes(form) && (
                  <>
                    <label className="grid gap-1 text-[12px]">
                      Code
                      <input
                        required
                        maxLength={40}
                        className={crmFieldClass}
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-[12px]">
                      Name
                      <input
                        required
                        maxLength={120}
                        className={crmFieldClass}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                  </>
                )}
                {form === "program" && (
                  <label className="grid gap-1 text-[12px]">
                    Spend per point ({currency})
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      required
                      className={crmFieldClass}
                      value={cost}
                      onChange={(event) => setCost(Number(event.target.value))}
                    />
                  </label>
                )}
                {form === "tier" && (
                  <>
                    <label className="grid gap-1 text-[12px]">
                      Tier rank
                      <input
                        type="number"
                        min={0}
                        step={1}
                        required
                        className={crmFieldClass}
                        value={cost}
                        onChange={(event) => setCost(Number(event.target.value))}
                      />
                    </label>
                    <label className="grid gap-1 text-[12px]">
                      Minimum earned points
                      <input
                        type="number"
                        min={0}
                        step={1}
                        required
                        className={crmFieldClass}
                        value={points}
                        onChange={(event) => setPoints(Number(event.target.value))}
                      />
                    </label>
                  </>
                )}
                {form === "reward" && (
                  <>
                    <label className="grid gap-1 text-[12px]">
                      Points cost
                      <input
                        type="number"
                        min={1}
                        step={1}
                        required
                        className={crmFieldClass}
                        value={points}
                        onChange={(event) => setPoints(Number(event.target.value))}
                      />
                    </label>
                    <label className="grid gap-1 text-[12px]">
                      Fixed discount ({currency})
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        required
                        className={crmFieldClass}
                        value={cost}
                        onChange={(event) => setCost(Number(event.target.value))}
                      />
                    </label>
                  </>
                )}
                {["enrol", "adjust"].includes(form) && (
                  <div className="md:col-span-2">
                    <PosCustomerPicker value={customer} disabled={busy} onSelect={setCustomer} />
                  </div>
                )}
                {form === "adjust" && (
                  <>
                    <label className="grid gap-1 text-[12px]">
                      Points (+/-)
                      <input
                        type="number"
                        step={1}
                        required
                        className={crmFieldClass}
                        value={points}
                        onChange={(event) => setPoints(Number(event.target.value))}
                      />
                    </label>
                    <label className="grid gap-1 text-[12px]">
                      Reason (required audit)
                      <input
                        required
                        minLength={4}
                        maxLength={500}
                        className={crmFieldClass}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                  </>
                )}
                <div className="flex gap-2 md:col-span-2">
                  <Btn type="submit" variant="primary" disabled={busy}>
                    {busy ? "Submitting..." : "Save"}
                  </Btn>
                  <Btn type="button" onClick={() => switchForm("none")}>
                    Cancel
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          {programs.status === "loading" ||
          tiers.status === "loading" ||
          rewards.status === "loading" ? (
            <Panel>
              <CrmLoading label="Loading loyalty records" />
            </Panel>
          ) : programs.status === "error" ||
            tiers.status === "error" ||
            rewards.status === "error" ? (
            <Panel>
              <CrmError message={programs.error || tiers.error || rewards.error} retry={refresh} />
            </Panel>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Metric label="Configured programs" value={programs.data?.programs.length ?? 0} />
                <Metric
                  label="Memberships across programs"
                  value={
                    programs.data?.programs.some((row) => row.members === null)
                      ? "Restricted"
                      : (programs.data?.programs ?? []).reduce(
                          (sum, row) => sum + (row.members ?? 0),
                          0,
                        )
                  }
                />
                <Metric
                  label="Program-wide outstanding points"
                  value={
                    programs.data?.programs.some((row) => row.outstanding_points === null)
                      ? "Restricted"
                      : (programs.data?.programs ?? []).reduce(
                          (sum, row) => sum + (row.outstanding_points ?? 0),
                          0,
                        )
                  }
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Panel>
                  <PanelHead
                    title="Configured programs"
                    sub="Branch access is enforced by the server."
                  />
                  {(programs.data?.programs.length ?? 0) === 0 ? (
                    <CrmEmpty
                      title="No loyalty program configured"
                      body="Create a program before enrolling members or issuing rewards."
                    />
                  ) : (
                    <div className="divide-y divide-border">
                      {programs.data?.programs.map((row) => (
                        <div key={row.id} className="space-y-1 p-4 text-[13px]">
                          <div className="flex justify-between gap-2">
                            <strong>{row.name}</strong>
                            <Status>{readableStatus(row.status)}</Status>
                          </div>
                          <p>
                            {readableStatus(row.earning_type)} ·{" "}
                            {row.members === null
                              ? "Membership totals restricted"
                              : row.members + " memberships"}
                          </p>
                          <p className="text-[12px] text-muted-foreground">
                            {row.outstanding_points === null
                              ? "Program-wide balance restricted"
                              : row.outstanding_points + " outstanding points"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
                <Panel>
                  <PanelHead
                    title="Tiers and rewards"
                    sub="Reward redemption occurs only through authoritative POS checkout."
                  />
                  <div className="divide-y divide-border">
                    {tiers.data?.tiers.map((row) => (
                      <div className="p-3 text-[12px]" key={row.id}>
                        Tier: {row.name} · Rank {row.rank}
                      </div>
                    ))}
                    {rewards.data?.rewards.map((row) => (
                      <div className="p-3 text-[12px]" key={row.id}>
                        Reward: {row.name} · {row.points_cost} points
                      </div>
                    ))}
                    {!tiers.data?.tiers.length && !rewards.data?.rewards.length && (
                      <CrmEmpty
                        title="No tiers or rewards"
                        body="Configure tiers and rewards to enable member redemption."
                      />
                    )}
                  </div>
                  <p className="border-t border-border p-3 text-[12px] text-muted-foreground">
                    <Link to="/customers" className="font-semibold underline">
                      Customer 360
                    </Link>{" "}
                    shows each member's individual balance.
                  </p>
                </Panel>
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
