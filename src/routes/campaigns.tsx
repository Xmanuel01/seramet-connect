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
        throw new Error("An active segment and healthy email provider are required.");
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
      setNotice("Draft campaign created. Preview and seek approval before delivery.");
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
      setError("Provider readiness is not confirmed. Do not approve for delivery.");
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
      setNotice("Approval recorded. Delivery is a separate action.");
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
      setError("Campaign lacks verified provider readiness or an eligible audience.");
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
          ? "Campaign remains scheduled; no messages have been sent yet."
          : result.campaign.queued +
              " eligible deliveries queued. Provider confirmation is asynchronous.",
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
      subtitle={"Consent-gated, auditable campaign delivery - " + branchLabel}
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
                      setNotice(
                        "Email connection configured. Provider acceptance is not confirmed inbox delivery.",
                      );
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
              {creating ? "Cancel draft" : "New email campaign"}
            </Btn>
          </>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="p-5">
          <CrmEmpty title="Access restricted" body="Campaign viewing permission is required." />
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
              <PanelHead
                title="Create draft"
                sub="No dispatch until separate approval and explicit queue confirmation."
              />
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
                  Segment
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
                  Healthy email provider
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
                  Email template (approved variables only)
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
                    <p className="mb-2 text-[12px] text-warning">
                      No healthy email provider is configured. Creation is unavailable.
                    </p>
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
              CRM overview permission is required to inspect audiences or send campaigns. Existing
              campaign records remain viewable.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Campaigns in current scope" value={campaignRows.length} />
            <Metric
              label="Provider accepted"
              value={campaignRows.reduce((sum, row) => sum + row.sent, 0)}
            />
            <Metric
              label="Confirmed deliveries"
              value={campaignRows.reduce((sum, row) => sum + row.delivered, 0)}
            />
            <Metric
              label="Requires provider reconciliation"
              value={campaignRows.reduce((sum, row) => sum + row.unknown, 0)}
            />
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Campaign register"
              sub="Delivery results and audiences for each campaign"
              right={<Btn onClick={refresh}>Refresh</Btn>}
            />
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
                title="No campaigns recorded"
                body="Create a segment and configure a healthy provider before making a draft."
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
                      Segment: {row.segment_name} · Provider:{" "}
                      {row.provider_name || "Not configured"}
                      {" · "}Scheduled: {shortDate(row.schedule_at)}
                    </p>
                    <p className="text-[12px]">
                      Eligible: {row.eligible} · Provider accepted: {row.sent} · Delivered:{" "}
                      {row.delivered}
                      {row.unknown > 0 ? " · Unconfirmed outcomes: " + row.unknown : ""}
                    </p>
                    <Btn
                      onClick={() => void previewCampaign(row.id)}
                      disabled={busy !== null || !canViewSegments}
                    >
                      {busy === "preview" ? "Checking..." : "Preview current audience"}
                    </Btn>
                  </article>
                ))}
              </div>
            )}
          </Panel>
          {selectedRow && currentPreview && (
            <Panel className="mt-4">
              <PanelHead
                title={"Audience preview: " + selectedRow.name}
                sub="Fresh snapshot; final sending eligibility is re-evaluated server-side."
              />
              <div className="space-y-3 p-4 text-[13px]">
                <p>
                  Eligible: {currentPreview.eligible} · Without consent: {currentPreview.noConsent}
                </p>
                <p>Evidence: {readableStatus(currentPreview.segment.quality)}</p>
                <p>
                  Provider: <Status>{readableStatus(currentPreview.providerReadiness)}</Status>
                </p>
                {canApprove && selectedRow.status === "DRAFT" && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <label className="grid gap-1 text-[12px]">
                      Approval reason
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
                    <p>
                      Delivery can contact real customers. Review recipients and type SEND to
                      confirm.
                    </p>
                    <label className="grid gap-1 text-[12px]">
                      Confirm delivery
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
                      Queue eligible deliveries
                    </Btn>
                  </div>
                )}
              </div>
            </Panel>
          )}
          <p className="mt-3 text-[12px] text-muted-foreground">
            <Link className="font-semibold underline" to="/segments">
              Manage segments
            </Link>{" "}
            before targeting. Unapproved, nonconsenting and unsupported channel audiences must never
            be sent.
          </p>
        </>
      )}
    </AppShell>
  );
}
