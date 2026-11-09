import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { CrmEmpty, CrmError, CrmLoading, readableStatus, shortDate } from "@/crm/crm-ui";
import {
  crmErrorMessage,
  crmFieldClass,
  crmTextAreaClass,
  useCrmScreenQuery,
} from "@/crm/use-crm-screen";
import { useCrmApi } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/campaigns")({
  head: () => ({ meta: [{ title: "Customer campaigns - Seramet" }] }),
  component: Campaigns,
});

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  objective: string;
  channels_json: string;
  segment_name: string;
  provider_name: string | null;
  provider_status: string | null;
  schedule_at: string | null;
  eligible: number;
  sent: number;
  delivered: number;
  unknown: number;
};
type Provider = {
  id: string;
  displayName: string;
  capabilities: string[];
  liveStatus: string;
  configuredStatus: string;
  secretConfigured: boolean;
};
type Segment = { id: string; name: string; status: string; latest_count: number | null };
type CampaignsResponse = { ok: boolean; campaigns: CampaignRow[] };
type ProvidersResponse = { ok: boolean; providers: Provider[] };
type SegmentsResponse = { ok: boolean; segments: Segment[] };
type Preview = {
  eligible: number;
  noConsent: number;
  providerReadiness: string;
  segment: { customerCount: number; quality: string };
};
type PreviewResponse = { ok: boolean; preview: Preview };

function Campaigns() {
  const { branchId, branchLabel, hasPermission } = useAppContext();
  const canView = hasPermission(permissions.campaignView);
  const canViewSegments = hasPermission(permissions.crmView);
  const canManage = hasPermission(permissions.campaignManage);
  const canApprove = hasPermission(permissions.campaignApprove);
  const canSend = hasPermission(permissions.campaignSend);
  const { command } = useCrmApi();
  const rows = useCrmScreenQuery<CampaignsResponse>(
    "/api/seramet/crm/campaigns?branchId=" + encodeURIComponent(branchId),
    canView,
  );
  const providers = useCrmScreenQuery<ProvidersResponse>(
    "/api/seramet/crm/campaigns/providers",
    canView,
  );
  const segments = useCrmScreenQuery<SegmentsResponse>(
    "/api/seramet/crm/segments?branchId=" + encodeURIComponent(branchId),
    canViewSegments,
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [subject, setSubject] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<{ id: string; data: Preview } | null>(null);
  const [approvalReason, setApprovalReason] = useState("");
  const [sendConfirmation, setSendConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const availableProviders = (providers.data?.providers ?? []).filter(
    (row) => row.capabilities.includes("SEND_EMAIL") && row.liveStatus === "CONFIGURED",
  );
  const campaignRows = rows.data?.campaigns ?? [];
  const selectedRow = campaignRows.find((row) => row.id === selected) ?? null;
  const currentPreview = preview?.id === selected ? preview.data : null;

  function refresh() {
    rows.refresh();
    providers.refresh();
    segments.refresh();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !canViewSegments || busy) return;
    setBusy("create");
    setError("");
    try {
      const provider = providerId || availableProviders[0]?.id;
      const segment = segmentId || segments.data?.segments[0]?.id;
      if (!provider || !segment) {
        throw new Error("Choose a customer group and connect email first.");
      }
      await command("/api/seramet/crm/campaigns", {
        name: name.trim(),
        objective: objective.trim(),
        segmentId: segment,
        providerConfigId: provider,
        channels: ["EMAIL"],
        templateSubject: subject.trim(),
        templateBody: templateBody.trim(),
        branchIds: [branchId],
        brandIds: [],
        approvalRequired: true,
      });
      setCreating(false);
      setNotice("Draft saved. Check who it reaches, then approve it.");
      setName("");
      setObjective("");
      setSubject("");
      setTemplateBody("");
      refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function previewCampaign(id: string) {
    if (!canView || !canViewSegments || busy) return;
    setBusy("preview");
    setError("");
    setPreview(null);
    try {
      const result = await command<PreviewResponse>(
        "/api/seramet/crm/campaigns/" + encodeURIComponent(id) + "/preview",
        {},
      );
      setSelected(id);
      setPreview({ id, data: result.preview });
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!canApprove || !selectedRow || !currentPreview || busy) return;
    if (currentPreview.providerReadiness !== "CONFIGURED") {
      setError("Email isn't connected yet, so this can't be approved.");
      return;
    }
    setBusy("approve");
    setError("");
    try {
      await command(
        "/api/seramet/crm/campaigns/" + encodeURIComponent(selectedRow.id) + "/approve",
        {
          campaignId: selectedRow.id,
          reason: approvalReason.trim(),
        },
      );
      setNotice("Approved. You can send it now.");
      setApprovalReason("");
      setPreview(null);
      rows.refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function queue() {
    if (!canSend || !selectedRow || !currentPreview || busy || sendConfirmation !== "SEND") return;
    if (currentPreview.providerReadiness !== "CONFIGURED" || currentPreview.eligible === 0) {
      setError(
        "Nobody can receive this yet. Connect email, or pick a group with customers who agreed to messages.",
      );
      return;
    }
    setBusy("queue");
    setError("");
    try {
      const result = await command<{
        ok: boolean;
        campaign: { queued: number; scheduled: boolean };
      }>("/api/seramet/crm/campaigns/" + encodeURIComponent(selectedRow.id) + "/queue", {});
      setNotice(
        result.campaign.scheduled
          ? "Scheduled. Nothing has been sent yet."
          : `Sending to ${result.campaign.queued} customers.`,
      );
      setPreview(null);
      setSendConfirmation("");
      rows.refresh();
    } catch (cause) {
      setError(crmErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell
      title="Campaigns"
      subtitle={branchLabel}
      actions={
        canManage && canViewSegments ? (
          <>
            {!availableProviders.length && (
              <Btn
                disabled={!!busy}
                onClick={() => {
                  setBusy("connect");
                  setError("");
                  void command("/api/seramet/crm/campaigns/providers/email", {})
                    .then(() => {
                      setNotice("Email connected.");
                      providers.refresh();
                    })
                    .catch((cause) => setError(crmErrorMessage(cause)))
                    .finally(() => setBusy(null));
                }}
              >
                Connect email
              </Btn>
            )}
            <Btn variant="primary" onClick={() => setCreating((value) => !value)}>
              {creating ? "Cancel" : "New campaign"}
            </Btn>
          </>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty title="No access" body="Ask the owner to give your role access to campaigns." />
        </Panel>
      ) : (
        <>
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
          {creating && canManage && canViewSegments && (
            <Panel className="mb-4">
              <PanelHead title="New campaign" />
              <form onSubmit={create} className="grid gap-3 p-4 md:grid-cols-2">
                <label className="grid gap-1 text-[12px]">
                  Campaign name
                  <input
                    required
                    maxLength={160}
                    className={crmFieldClass}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Purpose
                  <input
                    required
                    maxLength={500}
                    className={crmFieldClass}
                    value={objective}
                    onChange={(event) => setObjective(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px]">
                  Send to
                  <select
                    className={crmFieldClass}
                    required
                    value={segmentId || segments.data?.segments[0]?.id || ""}
                    onChange={(event) => setSegmentId(event.target.value)}
                  >
                    {(segments.data?.segments ?? [])
                      .filter((row) => row.status === "ACTIVE")
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px]">
                  Send with
                  <select
                    className={crmFieldClass}
                    required
                    value={providerId || availableProviders[0]?.id || ""}
                    onChange={(event) => setProviderId(event.target.value)}
                  >
                    {availableProviders.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px] md:col-span-2">
                  Email subject
                  <input
                    className={crmFieldClass}
                    required
                    maxLength={200}
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-[12px] md:col-span-2">
                  Message
                  <textarea
                    className={crmTextAreaClass}
                    required
                    maxLength={4000}
                    rows={4}
                    value={templateBody}
                    onChange={(event) => setTemplateBody(event.target.value)}
                  />
                </label>
                <div className="md:col-span-2">
                  {availableProviders.length === 0 && (
                    <p className="mb-2 text-[12px] text-warning">Connect email first.</p>
                  )}
                  <Btn
                    type="submit"
                    variant="primary"
                    disabled={
                      busy !== null ||
                      availableProviders.length === 0 ||
                      !segments.data?.segments.length
                    }
                  >
                    {busy === "create" ? "Saving..." : "Save draft"}
                  </Btn>
                </div>
              </form>
            </Panel>
          )}
          {!canViewSegments && (
            <p className="mb-3 rounded-md border border-border p-3 text-[12px] text-muted-foreground">
              You can see campaigns, but not who they go to. Ask the owner for customer access.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Campaigns" value={campaignRows.length} />
            <Metric label="Sent" value={campaignRows.reduce((sum, row) => sum + row.sent, 0)} />
            <Metric
              label="Delivered"
              value={campaignRows.reduce((sum, row) => sum + row.delivered, 0)}
            />
            <Metric
              label="Not confirmed"
              value={campaignRows.reduce((sum, row) => sum + row.unknown, 0)}
            />
          </div>
          <Panel className="mt-4">
            <PanelHead title="All campaigns" right={<Btn onClick={refresh}>Refresh</Btn>} />
            {rows.status === "loading" ||
            providers.status === "loading" ||
            (canViewSegments && segments.status === "loading") ? (
              <CrmLoading />
            ) : rows.status === "error" ||
              providers.status === "error" ||
              (canViewSegments && segments.status === "error") ? (
              <CrmError message={rows.error || providers.error || segments.error} retry={refresh} />
            ) : campaignRows.length === 0 ? (
              <CrmEmpty
                title="No campaigns yet"
                body="Make a customer group, connect email, then create your first campaign."
              />
            ) : (
              <div className="divide-y divide-border">
                {campaignRows.map((row) => (
                  <article key={row.id} className="space-y-2 p-4 text-[13px]">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>{row.name}</strong>
                      <Status>{readableStatus(row.status)}</Status>
                    </div>
                    <p>{row.objective}</p>
                    <p className="text-[12px] text-muted-foreground">
                      To: {row.segment_name} · Via: {row.provider_name || "Not connected"}
                      {row.schedule_at ? " · Scheduled: " + shortDate(row.schedule_at) : ""}
                    </p>
                    <p className="text-[12px]">
                      Can receive: {row.eligible} · Sent: {row.sent} · Delivered: {row.delivered}
                      {row.unknown > 0 ? " · Not confirmed: " + row.unknown : ""}
                    </p>
                    <Btn
                      onClick={() => void previewCampaign(row.id)}
                      disabled={busy !== null || !canViewSegments}
                    >
                      {busy === "preview" ? "Checking…" : "Check who it reaches"}
                    </Btn>
                  </article>
                ))}
              </div>
            )}
          </Panel>
          {selectedRow && currentPreview && (
            <Panel className="mt-4">
              <PanelHead title={selectedRow.name} />
              <div className="space-y-3 p-4 text-[13px]">
                <p>
                  Will receive it: {currentPreview.eligible} · Didn&apos;t agree to messages:{" "}
                  {currentPreview.noConsent}
                </p>
                <p>
                  Email:{" "}
                  <Status>
                    {currentPreview.providerReadiness === "CONFIGURED"
                      ? "Connected"
                      : "Not connected"}
                  </Status>
                </p>
                {canApprove && selectedRow.status === "DRAFT" && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <label className="grid gap-1 text-[12px]">
                      Why approve it?
                      <input
                        className={crmFieldClass}
                        minLength={4}
                        maxLength={500}
                        value={approvalReason}
                        onChange={(event) => setApprovalReason(event.target.value)}
                      />
                    </label>
                    <Btn
                      onClick={() => void approve()}
                      disabled={
                        busy !== null ||
                        approvalReason.trim().length < 4 ||
                        currentPreview.providerReadiness !== "CONFIGURED"
                      }
                    >
                      Approve campaign
                    </Btn>
                  </div>
                )}
                {canSend && ["ACTIVE", "SCHEDULED"].includes(selectedRow.status) && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p>This emails real customers. Type SEND to confirm.</p>
                    <label className="grid gap-1 text-[12px]">
                      Confirm
                      <input
                        className={crmFieldClass}
                        value={sendConfirmation}
                        onChange={(event) => setSendConfirmation(event.target.value)}
                        placeholder="SEND"
                      />
                    </label>
                    <Btn
                      variant="primary"
                      onClick={() => void queue()}
                      disabled={
                        busy !== null ||
                        sendConfirmation !== "SEND" ||
                        currentPreview.eligible === 0 ||
                        currentPreview.providerReadiness !== "CONFIGURED"
                      }
                    >
                      Send now
                    </Btn>
                  </div>
                )}
              </div>
            </Panel>
          )}
          <p className="mt-3 text-[12px] text-muted-foreground">
            <Link className="font-semibold underline" to="/segments">
              Manage customer groups
            </Link>
            . Only customers who agreed to messages receive campaigns.
          </p>
        </>
      )}
    </AppShell>
  );
}
