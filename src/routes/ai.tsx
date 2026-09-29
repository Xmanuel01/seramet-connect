import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Check,
  Clock3,
  Database,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Segmented, Status } from "@/components/app/ui";
import { useSerametIntelligence } from "@/intelligence/use-intelligence";
import type { EvidenceMetric, IntelligenceResponse } from "@/intelligence/types";
import { useAppContext } from "@/lib/app-context";
import { formatMinor } from "@/payments/money";
import { permissions } from "@/platform/permissions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/ai")({
  head: () => ({
    meta: [
      { title: "Ask Seramet - Restaurant intelligence" },
      {
        name: "description",
        content: "Permission-scoped operational intelligence grounded in Seramet records.",
      },
    ],
  }),
  component: AskSeramet,
});

type View = "Ask" | "Morning Brief" | "EOD Brief" | "History" | "Usage";

function AskSeramet() {
  const {
    permissions: userPermissions,
    branchLabel,
    isAllBranches,
    currency,
    locale,
  } = useAppContext();
  const intelligence = useSerametIntelligence();
  const [view, setView] = useState<View>("Ask");
  const [question, setQuestion] = useState("");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const suggestions = useMemo(() => suggestedQuestions(userPermissions), [userPermissions]);
  const views: View[] = ["Ask"];
  if (userPermissions.includes(permissions.intelligenceBriefsView)) {
    views.push("Morning Brief", "EOD Brief");
  }
  views.push("History");
  if (userPermissions.includes(permissions.intelligenceUsageView)) views.push("Usage");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || intelligence.status === "loading") return;
    void intelligence.ask(value).catch(() => undefined);
  };

  return (
    <AppShell
      title="Ask Seramet"
      subtitle={`${isAllBranches ? "Authorized branches" : branchLabel} · server-grounded evidence`}
      actions={
        <Btn
          onClick={() => void intelligence.refresh()}
          disabled={intelligence.status === "loading"}
        >
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Btn>
      }
    >
      <div className="mb-4 overflow-x-auto pb-1">
        <Segmented options={views} value={view} onChange={(next) => setView(next as View)} />
      </div>

      {intelligence.error && (
        <div className="mb-4 flex items-start gap-3 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Intelligence unavailable</div>
            <div className="mt-0.5">{intelligence.error}</div>
          </div>
        </div>
      )}

      {view === "Ask" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid min-w-0 gap-4">
            <Panel className="p-4">
              <form onSubmit={submit} className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={1200}
                  placeholder="Ask about operations, food cost, inventory, finance, or close readiness"
                  aria-label="Question for Seramet"
                  className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-[13px] outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || intelligence.status === "loading"}
                  title="Send question"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {intelligence.status === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setQuestion(suggestion)}
                    className="rounded-md border border-border px-2.5 py-1.5 text-left text-[12px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </Panel>

            {intelligence.response ? (
              <AnswerPanel
                response={intelligence.response}
                currency={currency}
                locale={locale}
                onEvidence={() => setEvidenceOpen(true)}
                onFeedback={async (rating) => {
                  await intelligence.sendFeedback(intelligence.response!.messageId, rating);
                  setFeedback(rating);
                }}
                feedback={feedback}
              />
            ) : (
              <Panel className="grid min-h-[280px] place-items-center p-8 text-center">
                <div>
                  <MessageSquareText className="mx-auto h-8 w-8 text-muted-foreground" />
                  <div className="mt-3 text-[14px] font-semibold">No active analysis</div>
                  <div className="mt-1 text-[13px] text-muted-foreground">
                    {intelligence.status === "loading"
                      ? "Loading authorized intelligence context..."
                      : "Choose a question or enter one above."}
                  </div>
                </div>
              </Panel>
            )}
          </div>

          <div className="grid content-start gap-4">
            <Panel>
              <PanelHead title="Scope" sub="Applied before evidence retrieval" />
              <dl className="grid gap-3 p-4 text-[12px]">
                <Meta label="Branch scope" value={isAllBranches ? "All authorized" : branchLabel} />
                <Meta label="Evidence tools" value={String(intelligence.tools.length)} />
                <Meta
                  label="Provider"
                  value={intelligence.response?.provider.displayName ?? "Not invoked"}
                />
              </dl>
            </Panel>
            <Panel>
              <PanelHead title="Recent analyses" />
              <div className="divide-y divide-border">
                {intelligence.sessions.slice(0, 6).map((session) => (
                  <div key={session.id} className="px-4 py-3">
                    <div className="line-clamp-2 text-[12px] font-semibold">{session.title}</div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{session.retention_mode}</span>
                      <span>{formatDate(session.updated_at)}</span>
                    </div>
                  </div>
                ))}
                {intelligence.sessions.length === 0 && (
                  <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
                    No retained sessions
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {(view === "Morning Brief" || view === "EOD Brief") && (
        <BriefView
          title={view}
          type={view === "Morning Brief" ? "MORNING" : "EOD"}
          briefs={intelligence.briefs}
          loading={intelligence.status === "loading"}
          canGenerate={userPermissions.includes(permissions.intelligenceBriefsManage)}
          onGenerate={(type) => void intelligence.createBrief(type)}
        />
      )}

      {view === "History" && <HistoryView sessions={intelligence.sessions} />}
      {view === "Usage" && (
        <UsageView
          admin={intelligence.admin}
          canManage={userPermissions.includes(permissions.intelligenceAdmin)}
          saving={intelligence.status === "loading"}
          onSave={intelligence.saveProviderConfiguration}
        />
      )}

      <EvidenceSheet
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        response={intelligence.response}
      />
    </AppShell>
  );
}

function AnswerPanel({
  response,
  onEvidence,
  onFeedback,
  feedback,
  currency,
  locale,
}: {
  response: IntelligenceResponse;
  currency: string;
  locale: string;
  onEvidence: () => void;
  onFeedback: (
    rating: "HELPFUL" | "NOT_HELPFUL" | "INCORRECT_OR_MISSING_EVIDENCE",
  ) => Promise<void>;
  feedback: string;
}) {
  return (
    <Panel>
      <PanelHead
        title="Analysis"
        sub={`${response.evidence.period.label} · ${response.evidence.branchLabels.join(", ")}`}
        right={
          <div className="flex items-center gap-2">
            <Status>{response.answer.dataQuality}</Status>
            {response.cached && <Status>Cached</Status>}
          </div>
        }
      />
      <div className="space-y-5 p-4">
        <p className="text-[14px] leading-6">{response.answer.summary}</p>
        {response.answer.keyFindings.length > 0 && (
          <div className="grid gap-2">
            {response.answer.keyFindings.map((finding, index) => (
              <div key={`${finding.statement}-${index}`} className="border-l-2 border-primary pl-3">
                <div className="text-[13px] font-medium">{finding.statement}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {finding.classification} · {finding.evidenceRefs.length} evidence reference
                  {finding.evidenceRefs.length === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        )}
        {response.evidence.metrics.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {response.evidence.metrics.slice(0, 9).map((metric) => (
              <div
                key={`${metric.code}:${metric.evidenceRef}`}
                className="border-t border-border pt-3"
              >
                <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                  {metric.label}
                </div>
                <div className="num mt-1 text-[17px] font-bold">
                  {formatMetric(metric, currency, locale)}
                </div>
              </div>
            ))}
          </div>
        )}
        {response.answer.suggestedActions.length > 0 && (
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase text-muted-foreground">
              Next actions
            </div>
            <div className="flex flex-wrap gap-2">
              {response.answer.suggestedActions.map((action) => (
                <Btn
                  key={action.key}
                  onClick={() => window.location.assign(action.route)}
                  disabled={action.risk === "HIGH"}
                >
                  {action.label} <ArrowRight className="h-3.5 w-3.5" />
                </Btn>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <Btn onClick={onEvidence}>
            <BookOpenCheck className="h-4 w-4" /> Evidence
          </Btn>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void onFeedback("HELPFUL")}
              title="Helpful"
              className="grid h-8 w-8 place-items-center rounded-md hover:bg-secondary"
            >
              {feedback === "HELPFUL" ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <ThumbsUp className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => void onFeedback("NOT_HELPFUL")}
              title="Not helpful"
              className="grid h-8 w-8 place-items-center rounded-md hover:bg-secondary"
            >
              <ThumbsDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function BriefView({
  title,
  type,
  briefs,
  loading,
  canGenerate,
  onGenerate,
}: {
  title: string;
  type: "MORNING" | "EOD";
  briefs: ReturnType<typeof useSerametIntelligence>["briefs"];
  loading: boolean;
  canGenerate: boolean;
  onGenerate: (type: "MORNING" | "EOD") => void;
}) {
  const rows = briefs.filter((brief) => brief.brief_type === type);
  return (
    <Panel>
      <PanelHead
        title={title}
        sub="Durable, evidence-grounded generation"
        right={
          canGenerate ? (
            <Btn variant="primary" onClick={() => onGenerate(type)} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}{" "}
              Generate
            </Btn>
          ) : undefined
        }
      />
      <div className="divide-y divide-border">
        {rows.map((brief) => (
          <article key={brief.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">
                {brief.period_start} to {brief.period_end}
              </div>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                {brief.answer?.summary ??
                  (brief.status === "FAILED"
                    ? "Generation failed. The durable job can be retried."
                    : "Generation pending in the durable worker queue.")}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Status>{brief.status}</Status>
              <Status>{brief.quality}</Status>
            </div>
          </article>
        ))}
        {rows.length === 0 && (
          <div className="p-10 text-center text-[13px] text-muted-foreground">
            No {title.toLowerCase()} generated for this scope.
          </div>
        )}
      </div>
    </Panel>
  );
}

function HistoryView({
  sessions,
}: {
  sessions: ReturnType<typeof useSerametIntelligence>["sessions"];
}) {
  return (
    <Panel>
      <PanelHead title="Analysis history" sub="Current user only" />
      <div className="divide-y divide-border">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <div>
              <div className="text-[13px] font-semibold">{session.title}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {session.retention_mode} · updated {formatDate(session.updated_at)}
              </div>
            </div>
            <Status>{session.status}</Status>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="p-10 text-center text-[13px] text-muted-foreground">
            No retained analysis history.
          </div>
        )}
      </div>
    </Panel>
  );
}

function UsageView({
  admin,
  canManage,
  saving,
  onSave,
}: {
  admin: ReturnType<typeof useSerametIntelligence>["admin"];
  canManage: boolean;
  saving: boolean;
  onSave: ReturnType<typeof useSerametIntelligence>["saveProviderConfiguration"];
}) {
  if (!admin)
    return (
      <Panel className="p-10 text-center text-[13px] text-muted-foreground">
        Usage details are not available for this account.
      </Panel>
    );
  const usage = admin.usage;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHead title="Provider health" />
        <dl className="grid gap-3 p-4 text-[12px]">
          <Meta
            label="Status"
            value={admin.health?.status ?? admin.provider?.status ?? "Unavailable"}
          />
          <Meta label="Provider" value={admin.provider?.displayName ?? "Not configured"} />
          <Meta label="Model" value={admin.provider?.modelIdentifier ?? "Not configured"} />
          <Meta label="Prompt" value={admin.provider?.promptVersion ?? "Not configured"} />
          <Meta label="Retention" value={admin.provider?.retentionMode ?? "Not configured"} />
        </dl>
      </Panel>
      <Panel>
        <PanelHead title="Current month" />
        <dl className="grid gap-3 p-4 text-[12px]">
          <Meta label="Requests" value={String(usage["requests"] ?? 0)} />
          <Meta label="Succeeded" value={String(usage["succeeded"] ?? 0)} />
          <Meta label="Failed or rejected" value={String(usage["failed"] ?? 0)} />
          <Meta
            label="Average latency"
            value={`${Math.round(Number(usage["average_latency_ms"] ?? 0))} ms`}
          />
          <Meta label="Input units" value={Number(usage["input_units"] ?? 0).toLocaleString()} />
          <Meta label="Output units" value={Number(usage["output_units"] ?? 0).toLocaleString()} />
        </dl>
      </Panel>
      {canManage && (
        <div className="lg:col-span-2">
          <ProviderSettings provider={admin.provider} saving={saving} onSave={onSave} />
        </div>
      )}
    </div>
  );
}

type ProviderForm = {
  id?: string;
  providerKey: string;
  displayName: string;
  modelIdentifier: string;
  enabled: boolean;
  secretReference: string;
  timeoutMs: number;
  maxInputUnits: number;
  maxOutputUnits: number;
  perMinuteLimit: number;
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  perUserDailyLimit: number;
  retentionMode: "EPHEMERAL" | "SHORT" | "STANDARD";
  allowedFeatures: string;
  allowedRoleIds: string;
  promptVersion: string;
};

function ProviderSettings({
  provider,
  saving,
  onSave,
}: {
  provider: NonNullable<ReturnType<typeof useSerametIntelligence>["admin"]>["provider"];
  saving: boolean;
  onSave: ReturnType<typeof useSerametIntelligence>["saveProviderConfiguration"];
}) {
  const [form, setForm] = useState<ProviderForm>(() => providerForm(provider));
  useEffect(() => setForm(providerForm(provider)), [provider]);
  const field = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave({
      ...(form.id ? { id: form.id } : {}),
      providerKey: form.providerKey.trim().toUpperCase(),
      displayName: form.displayName.trim(),
      modelIdentifier: form.modelIdentifier.trim(),
      enabled: form.enabled,
      ...(form.secretReference.trim() ? { secretReference: form.secretReference.trim() } : {}),
      timeoutMs: form.timeoutMs,
      maxInputUnits: form.maxInputUnits,
      maxOutputUnits: form.maxOutputUnits,
      perMinuteLimit: form.perMinuteLimit,
      dailyRequestLimit: form.dailyRequestLimit,
      monthlyRequestLimit: form.monthlyRequestLimit,
      perUserDailyLimit: form.perUserDailyLimit,
      retentionMode: form.retentionMode,
      allowedFeatures: splitList(form.allowedFeatures),
      allowedRoleIds: splitList(form.allowedRoleIds),
      promptVersion: form.promptVersion.trim(),
    }).catch(() => undefined);
  };
  return (
    <Panel>
      <PanelHead
        title="Provider configuration"
        sub="Server-authoritative binding; secret values are never returned"
      />
      <form onSubmit={submit} className="grid gap-4 p-4">
        <label className="flex items-center gap-2 text-[12px] font-semibold">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => field("enabled", event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Provider enabled
        </label>
        <div className="grid gap-3 md:grid-cols-3">
          <TextField
            label="Provider key"
            value={form.providerKey}
            onChange={(value) => field("providerKey", value)}
          />
          <TextField
            label="Display name"
            value={form.displayName}
            onChange={(value) => field("displayName", value)}
          />
          <TextField
            label="Model identifier"
            value={form.modelIdentifier}
            onChange={(value) => field("modelIdentifier", value)}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <TextField
            label="Managed secret reference"
            value={form.secretReference}
            placeholder={
              provider?.secretConfigured
                ? "Configured; leave blank to keep"
                : "env://SERAMET_AI_SECRET"
            }
            onChange={(value) => field("secretReference", value)}
          />
          <TextField
            label="Prompt version"
            value={form.promptVersion}
            onChange={(value) => field("promptVersion", value)}
          />
          <label className="grid gap-1.5 text-[12px] font-semibold">
            Retention
            <select
              value={form.retentionMode}
              onChange={(event) =>
                field("retentionMode", event.target.value as ProviderForm["retentionMode"])
              }
              className="h-10 rounded-md border border-border bg-background px-3 font-normal"
            >
              <option value="EPHEMERAL">Ephemeral</option>
              <option value="SHORT">Short</option>
              <option value="STANDARD">Standard</option>
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label="Timeout (ms)"
            value={form.timeoutMs}
            onChange={(value) => field("timeoutMs", value)}
          />
          <NumberField
            label="Per minute"
            value={form.perMinuteLimit}
            onChange={(value) => field("perMinuteLimit", value)}
          />
          <NumberField
            label="Daily requests"
            value={form.dailyRequestLimit}
            onChange={(value) => field("dailyRequestLimit", value)}
          />
          <NumberField
            label="Monthly requests"
            value={form.monthlyRequestLimit}
            onChange={(value) => field("monthlyRequestLimit", value)}
          />
          <NumberField
            label="Per user daily"
            value={form.perUserDailyLimit}
            onChange={(value) => field("perUserDailyLimit", value)}
          />
          <NumberField
            label="Max input units"
            value={form.maxInputUnits}
            onChange={(value) => field("maxInputUnits", value)}
          />
          <NumberField
            label="Max output units"
            value={form.maxOutputUnits}
            onChange={(value) => field("maxOutputUnits", value)}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField
            label="Allowed features (comma separated)"
            value={form.allowedFeatures}
            onChange={(value) => field("allowedFeatures", value)}
          />
          <TextField
            label="Allowed role IDs (comma separated)"
            value={form.allowedRoleIds}
            onChange={(value) => field("allowedRoleIds", value)}
          />
        </div>
        <div className="flex justify-end">
          <Btn variant="primary" type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{" "}
            Save provider
          </Btn>
        </div>
      </form>
    </Panel>
  );
}

function providerForm(
  provider: NonNullable<ReturnType<typeof useSerametIntelligence>["admin"]>["provider"],
): ProviderForm {
  return {
    ...(provider?.id ? { id: provider.id } : {}),
    providerKey: provider?.key ?? "",
    displayName: provider?.displayName ?? "",
    modelIdentifier: provider?.modelIdentifier ?? "",
    enabled: provider?.status === "CONFIGURED",
    secretReference: "",
    timeoutMs: provider?.timeoutMs ?? 15000,
    maxInputUnits: provider?.maxInputUnits ?? 12000,
    maxOutputUnits: provider?.maxOutputUnits ?? 2000,
    perMinuteLimit: provider?.perMinuteLimit ?? 20,
    dailyRequestLimit: provider?.dailyRequestLimit ?? 200,
    monthlyRequestLimit: provider?.monthlyRequestLimit ?? 3000,
    perUserDailyLimit: provider?.perUserDailyLimit ?? 50,
    retentionMode: provider?.retentionMode ?? "SHORT",
    allowedFeatures: provider?.allowedFeatures.join(", ") ?? "",
    allowedRoleIds: provider?.allowedRoleIds.join(", ") ?? "",
    promptVersion: provider?.promptVersion ?? "seramet-intelligence-v1",
  };
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[12px] font-semibold">
      {label}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-md border border-border bg-background px-3 font-normal outline-none focus:border-primary"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[12px] font-semibold">
      {label}
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-10 min-w-0 rounded-md border border-border bg-background px-3 font-normal outline-none focus:border-primary"
      />
    </label>
  );
}

function splitList(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function EvidenceSheet({
  open,
  onOpenChange,
  response,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  response: IntelligenceResponse | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-border bg-card p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b border-border p-4 text-left">
          <SheetTitle>Evidence package</SheetTitle>
          <SheetDescription>
            {response
              ? `${response.evidence.period.label} · ${response.evidence.quality}`
              : "No active evidence"}
          </SheetDescription>
        </SheetHeader>
        {response && (
          <div className="grid gap-5 p-4">
            <div>
              <div className="text-[12px] font-semibold uppercase text-muted-foreground">
                Sources
              </div>
              <div className="mt-2 grid gap-2">
                {response.evidence.sources.map((source) => (
                  <div key={source.ref} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold">{source.sourceType}</span>
                      <Status>{source.quality}</Status>
                    </div>
                    <div className="mt-1 break-all text-[11px] text-muted-foreground">
                      {source.ref}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Calculated {formatDate(source.calculatedAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <EvidenceList
              title="Quality notes"
              items={response.answer.qualityReasons}
              icon={<Database className="h-4 w-4" />}
            />
            <EvidenceList
              title="Configuration gaps"
              items={response.evidence.configurationGaps}
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <EvidenceList
              title="Limitations"
              items={response.answer.limitations}
              icon={<Clock3 className="h-4 w-4" />}
            />
            <div className="break-all border-t border-border pt-3 text-[10px] text-muted-foreground">
              Evidence watermark: {response.evidence.evidenceWatermark}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function EvidenceList({ title, items, icon }: { title: string; items: string[]; icon: ReactNode }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase text-muted-foreground">
        {icon}
        {title}
      </div>
      <ul className="mt-2 grid gap-2 text-[12px]">
        {items.map((item) => (
          <li key={item} className="rounded-md bg-secondary/60 px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 max-w-[180px] truncate text-right font-semibold">{value}</dd>
    </div>
  );
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
function formatMetric(metric: EvidenceMetric, currency: string, locale: string) {
  if (metric.unit === "MINOR")
    return formatMinor(metric.value, metric.currency ?? currency, locale);
  if (metric.unit === "BPS") return `${(metric.value / 100).toFixed(1)}%`;
  if (metric.unit === "MILLISECONDS") return `${Math.round(metric.value)} ms`;
  if (metric.unit === "MICRO")
    return (metric.value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return metric.value.toLocaleString();
}
function suggestedQuestions(userPermissions: string[]) {
  const questions = ["What needs attention today?", "How are we doing today?"];
  if (userPermissions.includes(permissions.intelligenceFinance))
    questions.push("Why did food cost change this week?", "What is blocking close?");
  if (userPermissions.includes(permissions.intelligenceInventory))
    questions.push("Which inventory risks need action?", "What should we purchase next?");
  if (userPermissions.includes(permissions.intelligenceOwner))
    questions.push("Compare my authorized branches this week.");
  return questions;
}
