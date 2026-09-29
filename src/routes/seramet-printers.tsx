import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Activity, Cable, ImageIcon, Printer, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { dispatchDurableKitchenObligation } from "@/lib/durable-kot-client";
import { permissions } from "@/platform/permissions";
import { processReceiptLogoFile, type LogoScope, type ReceiptLogoAsset } from "@/lib/receipt-logo";
import { bridgeConfigReady } from "@/lib/print-bridge-client-config";
import { useAppContext } from "@/lib/app-context";
import {
  SerametPrintService,
  SerametLocalPrintBridge,
  documentTemplates,
  type OrderForPrint,
  type PrintDocumentType,
  type PrintTemplateSettings,
} from "@/lib/seramet-print-service";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export const Route = createFileRoute("/seramet-printers")({
  head: () => ({
    meta: [
      { title: "Seramet Printers - Hardware and print routing" },
      {
        name: "description",
        content: "Printer settings, health, routing, templates and reprint audit controls.",
      },
    ],
  }),
  component: SerametPrinters,
});

function diagnosticOrder(
  branch: string,
  paymentMethod: string,
  orderType: string,
  operator: string,
): OrderForPrint {
  return {
    orderId: "#PRINT-TEST",
    branch,
    terminalId: `${branch.toUpperCase().replace(/[^A-Z0-9]/g, "")}-POS-01`,
    table: "TEST",
    orderType,
    requestedBy: operator,
    cashier: operator,
    waiter: operator,
    createdAt: "12:46",
    customer: "Printer test",
    kitchenNote: "Diagnostic kitchen ticket.",
    receiptNumber: "RCP-PRINT-TEST",
    invoiceNumber: "INV-PRINT-TEST",
    lines: [
      {
        id: "p1",
        name: "Kitchen test item",
        category: "Diagnostic",
        quantity: 1,
        unitPrice: 0,
        productionStation: "MAIN KITCHEN",
        modifiers: ["Modifier test"],
        itemNote: "Kitchen note test",
      },
      {
        id: "p8",
        name: "Bar test item",
        category: "Diagnostic",
        quantity: 2,
        unitPrice: 0,
        productionStation: "BAR",
        itemNote: "Bar note test",
      },
    ],
    subtotal: 0,
    tax: 0,
    total: 0,
    paid: 0,
    change: 0,
    paymentMethod,
    paymentReference: "PRINT-TEST",
    paymentBreakdown: [{ method: paymentMethod, amount: 0, reference: "PRINT-TEST" }],
  };
}

function SerametPrinters() {
  const {
    activeTenantId,
    branch: activeBranch,
    branchId: activeBranchId,
    canSwitchBranch,
    hasPermission,
    currentUser,
    switchableBranchRecords,
  } = useAppContext();
  const [branch, setBranch] = useState(activeBranch);
  const branchOptions = switchableBranchRecords.map((item) => item.name);
  const selectedBranchId =
    switchableBranchRecords.find((item) => item.name === branch)?.id ?? branch;
  const [bridgeStatus, setBridgeStatus] = useState(() => SerametLocalPrintBridge.getStatus());
  const [installedBridge, setInstalledBridge] = useState<{
    online: boolean;
    version?: string;
    platform?: string;
    printers: string[];
    error?: string;
  }>({
    online: false,
    printers: [],
  });
  const [notice, setNotice] = useState("No test job sent in this session.");
  const [kotNotice, setKotNotice] = useState("");
  const [kotBusyId, setKotBusyId] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const { state: liveTransactions, mutate: mutateTicket, syncFromBackend } = useTransactionEngine();
  const [logoNotice, setLogoNotice] = useState("No receipt logo uploaded in this session.");
  const [logoAssets, setLogoAssets] = useState<Record<string, ReceiptLogoAsset | undefined>>({});

  useEffect(() => setBranch(activeBranch), [activeBranch]);
  const {
    profile,
    configurationError,
    jobs,
    reprints,
    bridgeConfig,
    printCustomerDocument,
    sendKitchenTickets,
    deliverDurableKitchenTicket,
    reprintJob,
  } = useSerametPrintQueue(selectedBranchId);
  const visiblePrinters = useMemo(
    () => (profile ? SerametLocalPrintBridge.discoverPrinters(profile) : []),
    [profile],
  );
  const connected =
    profile?.printers.filter((printer) => printer.connection === "Connected").length ?? 0;
  const failures = profile?.printers.reduce((sum, printer) => sum + printer.failures, 0) ?? 0;
  const activeLogo = logoAssets[`Branch:${branch}`] ?? logoAssets["Company"];
  const previewPaymentMethod =
    getConfigurationRepository().listPaymentMethods(activeTenantId, true)[0]?.displayName ??
    "Configured payment";
  const previewOrderType =
    getConfigurationRepository().listOrderChannels(activeTenantId, true)[0]?.displayName ??
    "Configured channel";
  const previewOrder = useMemo(
    () => diagnosticOrder(branch, previewPaymentMethod, previewOrderType, currentUser.name),
    [branch, currentUser.name, previewOrderType, previewPaymentMethod],
  );
  const customerPreviews = useMemo(
    () =>
      profile
        ? {
            BILL: SerametPrintService.createDocumentJob(profile, previewOrder, "BILL").content,
            RECEIPT: SerametPrintService.createDocumentJob(profile, previewOrder, "RECEIPT")
              .content,
            INVOICE: SerametPrintService.createDocumentJob(profile, previewOrder, "INVOICE")
              .content,
          }
        : { BILL: "", RECEIPT: "", INVOICE: "" },
    [previewOrder, profile],
  );
  const productionPreviews = useMemo(
    () =>
      profile
        ? SerametPrintService.createProductionTicketJobs(profile, previewOrder, [], "NEW").jobs
        : [],
    [previewOrder, profile],
  );

  const refreshInstalledBridge = useCallback(async () => {
    if (!bridgeConfigReady(bridgeConfig)) {
      setInstalledBridge({
        online: false,
        printers: [],
        error: "Installed bridge is not configured.",
      });
      return;
    }
    try {
      const health = await SerametLocalPrintBridge.getInstalledBridgeHealth(bridgeConfig.endpoint);
      const printers = await SerametLocalPrintBridge.discoverInstalledPrinters(
        bridgeConfig.token,
        bridgeConfig.endpoint,
      );
      setInstalledBridge({
        online: health.ok,
        version: health.version,
        platform: health.platform,
        printers: printers.map((printer) => printer.name),
      });
    } catch (error) {
      setInstalledBridge({
        online: false,
        printers: [],
        error: error instanceof Error ? error.message : "Installed bridge is unavailable.",
      });
    }
  }, [bridgeConfig]);

  useEffect(() => {
    void refreshInstalledBridge();
  }, [refreshInstalledBridge]);

  const runTest = (type: "BILL" | "RECEIPT" | "INVOICE" | "KITCHEN") => {
    const order = previewOrder;
    const result =
      type === "KITCHEN" ? sendKitchenTickets(order) : printCustomerDocument(order, type);
    setBridgeStatus(SerametLocalPrintBridge.getStatus());
    setNotice(
      `${result.jobs.length} ${type.toLowerCase()} test job${result.jobs.length === 1 ? "" : "s"} accepted. ${result.skipped.length} duplicate blocked.`,
    );
  };

  const reprintLatest = () => {
    const latest = jobs.find(
      (job) => job.status === "Printed" || job.status === "Fallback Printed",
    );
    if (!latest) {
      setNotice("Print a test job before requesting a reprint.");
      return;
    }
    const result = reprintJob(latest.id, "Branch Manager", "Manager authorized duplicate copy");
    setBridgeStatus(SerametLocalPrintBridge.getStatus());
    setNotice(result?.skipped ?? `Reprint logged against ${latest.id}.`);
  };

  const outstandingTickets = (liveTransactions.kitchenPrintObligations ?? [])
    .filter(
      (ticket) =>
        ticket.tenantId === activeTenantId &&
        ticket.branchId === selectedBranchId &&
        ["PENDING", "CLAIMED", "UNCERTAIN"].includes(ticket.status),
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const canReviewTickets = hasPermission(permissions.settingsHardwareManage);
  const activeRecoveryBranch = selectedBranchId === activeBranchId;
  const physicalBridgeRequired = profile?.kitchenMode !== "KDS_ONLY";
  const canAttemptDelivery =
    activeRecoveryBranch && (!physicalBridgeRequired || bridgeConfigReady(bridgeConfig));

  const recoverTicket = async (ticketId: string) => {
    if (!canAttemptDelivery || kotBusyId) return;
    const ticket = outstandingTickets.find(
      (item) => item.id === ticketId && item.status === "PENDING",
    );
    if (!ticket) {
      setKotNotice("Only an unclaimed ticket can be delivered. Investigate older attempts first.");
      return;
    }
    setKotBusyId(ticketId);
    try {
      const result = await dispatchDurableKitchenObligation({
        obligation: ticket,
        terminalId: `${activeBranchId}-POS-RECOVERY`,
        mutate: mutateTicket,
        deliver: deliverDurableKitchenTicket,
      });
      setKotNotice(
        `${ticket.orderId} / ${ticket.station}: ${result.jobs.length} delivery job(s) accepted. ` +
          "OS spool acknowledgement is not proof that paper printed.",
      );
      await syncFromBackend();
    } catch (error) {
      setKotNotice(
        error instanceof Error ? error.message : "The ticket outcome requires investigation.",
      );
      await syncFromBackend().catch(() => undefined);
    } finally {
      setKotBusyId(null);
    }
  };

  const authorizeReviewedReprint = async (ticketId: string) => {
    if (!canReviewTickets || !activeRecoveryBranch || kotBusyId) return;
    if (reviewReason.trim().length < 12) {
      setKotNotice("Enter at least 12 characters documenting the manual printer check.");
      return;
    }
    const ticket = outstandingTickets.find((item) => item.id === ticketId);
    if (!ticket || !["CLAIMED", "UNCERTAIN"].includes(ticket.status)) return;
    if (
      ticket.status === "CLAIMED" &&
      ticket.claimedAt &&
      Date.now() - Date.parse(ticket.claimedAt) < 120_000
    ) {
      setKotNotice("This print claim is still recent. Investigate before authorizing a reprint.");
      return;
    }
    setKotBusyId(ticket.id);
    try {
      const updated = await mutateTicket("authorizeKitchenReprint", {
        obligationId: ticket.id,
        reason: reviewReason.trim(),
      });
      const created = updated?.state.kitchenPrintObligations?.find(
        (item) => item.reprintOf === ticket.id && item.status === "PENDING",
      );
      if (!created) throw new Error("Audited reprint was not confirmed by the server.");
      setReviewReason("");
      setKotNotice(
        `Audited reprint ${created.id} created for ${ticket.orderId}. ` +
          "Use Deliver outstanding KOT to dispatch it intentionally.",
      );
    } catch (error) {
      setKotNotice(error instanceof Error ? error.message : "Cannot authorize reprint.");
    } finally {
      setKotBusyId(null);
    }
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>, scope: LogoScope) => {
    const file = event.target.files?.[0];
    if (!file || !profile) return;
    try {
      const asset = await processReceiptLogoFile(
        file,
        scope,
        scope === "Branch" ? branch : undefined,
        150,
        profile.printIdentity.businessName,
      );
      const key = scope === "Branch" ? `Branch:${branch}` : "Company";
      setLogoAssets((current) => ({ ...current, [key]: asset }));
      setLogoNotice(
        `${scope === "Branch" ? branch : "Company"} logo processed for 80mm/58mm monochrome receipt printers.`,
      );
    } catch (error) {
      setLogoNotice(error instanceof Error ? error.message : "Could not process receipt logo.");
    } finally {
      event.target.value = "";
    }
  };

  if (!profile) {
    return (
      <AppShell
        title="Seramet printers"
        subtitle="Hardware health, document templates, routing and audited reprints"
        actions={
          <select
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            disabled={!canSwitchBranch}
            title={canSwitchBranch ? "Select an assigned branch" : "Assigned branch"}
            className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold outline-none"
          >
            {branchOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        }
      >
        <Panel>
          <PanelHead
            title="Print setup required"
            sub={branch}
            right={<Printer className="h-4 w-4 text-warning" />}
          />
          <div className="space-y-3 p-4 text-[13px]">
            <p className="max-w-2xl text-muted-foreground">
              {configurationError ?? "Printing is not configured for this branch."}
            </p>
            <p className="max-w-2xl text-muted-foreground">
              Configure the document identity, trusted devices, templates and print routes in Setup
              Centre before running a test or issuing a printed document.
            </p>
            <a
              href="/seramet-setup"
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground"
            >
              Open Setup Centre
            </a>
          </div>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Seramet printers"
      subtitle="Hardware health, document templates, routing and audited reprints"
      actions={
        <>
          <select
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            disabled={!canSwitchBranch}
            title={canSwitchBranch ? "Select an assigned branch" : "Assigned branch"}
            className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold outline-none"
          >
            {branchOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <Btn variant="primary" onClick={() => runTest("BILL")}>
            Test bill
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Printers" value={profile.printers.length} />
        <Metric label="Connected" value={connected} />
        <Metric label="Print jobs" value={jobs.length} />
        <Metric
          label="Failures"
          value={failures + jobs.filter((job) => job.status === "Failed").length}
          invert
        />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Durable kitchen KOT recovery"
          sub="Server-owned tickets survive a POS crash. Claimed or uncertain physical jobs never automatically reprint."
          right={<Status>{outstandingTickets.length} require attention</Status>}
        />
        <div className="space-y-3 p-4">
          {!activeRecoveryBranch && (
            <p className="text-[12px] text-amber-700">
              Switch your active working branch to {branch} before recovering its tickets.
            </p>
          )}
          {physicalBridgeRequired && !bridgeConfigReady(bridgeConfig) && (
            <p className="text-[12px] text-amber-700">
              Configure the installed print bridge before claiming a physical KOT.
            </p>
          )}
          {kotNotice && (
            <div role="status" className="rounded-md border border-border p-3 text-[12px]">
              {kotNotice}
            </div>
          )}
          {outstandingTickets.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              No outstanding server-owned KOT obligations for this branch. Old pre-upgrade kitchen
              orders are not automatically reprinted.
            </p>
          )}
          {outstandingTickets.map((ticket) => (
            <div key={ticket.id} className="rounded-lg border border-border p-3 text-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-bold">
                  {ticket.orderId} / {ticket.station}
                </div>
                <Status>{ticket.status}</Status>
              </div>
              <p className="mt-1 text-muted-foreground">
                {ticket.kind.replaceAll("_", " ")} / {ticket.lines.length} production line(s) /{" "}
                {ticket.createdAt}
              </p>
              {ticket.status === "PENDING" ? (
                <Btn
                  onClick={() => void recoverTicket(ticket.id)}
                  disabled={!canAttemptDelivery || kotBusyId !== null}
                >
                  {kotBusyId === ticket.id ? "Delivering..." : "Deliver outstanding KOT"}
                </Btn>
              ) : (
                <div className="mt-2 space-y-2">
                  <p className="text-amber-700">
                    Previous printer output is uncertain. Check the local bridge spool and kitchen
                    physically before authorizing a new copy.
                  </p>
                  {canReviewTickets && (
                    <>
                      <label className="block font-semibold" htmlFor={`kot-reason-${ticket.id}`}>
                        Manager reprint reason
                      </label>
                      <input
                        id={`kot-reason-${ticket.id}`}
                        value={reviewReason}
                        onChange={(event) => setReviewReason(event.target.value)}
                        placeholder="What was checked and why is another ticket required?"
                        className="w-full rounded-md border border-border bg-background p-2"
                      />
                      <Btn
                        onClick={() => void authorizeReviewedReprint(ticket.id)}
                        disabled={!activeRecoveryBranch || kotBusyId !== null}
                      >
                        Authorize audited reprint
                      </Btn>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
        <Panel>
          <PanelHead
            title="Printer health"
            sub={`${profile.branch} - ${profile.kitchenMode.replaceAll("_", " ").toLowerCase()}`}
            right={
              <Status>
                {bridgeStatus.online && bridgeStatus.authenticated ? "Healthy" : "Attention"}
              </Status>
            }
          />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {visiblePrinters.map((printer) => (
              <article
                key={printer.id}
                className="rounded-lg border border-border bg-secondary/30 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13px] font-bold">
                      <Printer className="h-4 w-4 text-primary" />
                      <span className="truncate">{printer.name}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      {printer.id} - {printer.driver}
                    </div>
                  </div>
                  <Status>{printer.connection}</Status>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {printer.roles.map((role) => (
                    <span
                      key={role}
                      className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-semibold text-muted-foreground"
                    >
                      {role}
                    </span>
                  ))}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                  <div>
                    <dt className="text-muted-foreground">Queue</dt>
                    <dd className="num font-bold">{printer.queue}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Failures</dt>
                    <dd className="num font-bold">{printer.failures}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last</dt>
                    <dd className="font-bold">{printer.lastPrintAt}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="Local print bridge"
            sub={bridgeConfigReady(bridgeConfig) ? bridgeConfig.endpoint : bridgeStatus.machine}
            right={<Cable className="h-4 w-4 text-primary" />}
          />
          <div className="space-y-3 p-4 text-[13px]">
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{bridgeStatus.name}</span>
                <Status>
                  {bridgeConfigReady(bridgeConfig)
                    ? installedBridge.online
                      ? "Connected"
                      : "Offline"
                    : "Simulation"}
                </Status>
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {bridgeConfigReady(bridgeConfig)
                  ? installedBridge.online
                    ? `Version ${installedBridge.version ?? "unknown"} - ${installedBridge.platform ?? "OS"} - ${installedBridge.printers.length} OS printer(s) visible`
                    : (installedBridge.error ?? "Installed bridge is unavailable")
                  : `Simulation bridge ${bridgeStatus.version} - heartbeat ${bridgeStatus.lastHeartbeat}`}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bridgeStatus.supportedConnections.map((item) => (
                  <span
                    key={item}
                    className="rounded-md bg-card px-2 py-1 text-[11px] font-semibold text-muted-foreground"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => void refreshInstalledBridge()}>
                <ShieldCheck className="h-4 w-4" />
                Test bridge
              </Btn>
              <Btn
                onClick={() => {
                  setBridgeStatus(SerametLocalPrintBridge.getStatus());
                  void refreshInstalledBridge();
                }}
              >
                <Activity className="h-4 w-4" />
                Refresh
              </Btn>
            </div>
            <div className="rounded-md bg-card px-3 py-2 text-[12px] text-muted-foreground">
              {notice}
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Routing matrix"
            sub="One-printer and multi-printer routing uses the same resolver as POS"
          />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <TH>Document</TH>
                  <TH>Primary role</TH>
                  <TH>Fallback</TH>
                  <TH>Template</TH>
                  <TH className="text-right">Copies</TH>
                  <TH>Action</TH>
                </tr>
              </thead>
              <tbody>
                {(
                  Object.entries(profile.documentRoutes) as [
                    PrintDocumentType,
                    (typeof profile.documentRoutes)[PrintDocumentType],
                  ][]
                ).map(([documentType, route]) => (
                  <tr key={documentType}>
                    <TD className="font-semibold">{documentType.replaceAll("_", " ")}</TD>
                    <TD>{route.primaryRole}</TD>
                    <TD>{route.fallbackRole ?? "Auto front fallback"}</TD>
                    <TD className="text-muted-foreground">{route.template}</TD>
                    <TD className="num text-right">{route.copies}</TD>
                    <TD>
                      <button
                        onClick={() =>
                          runTest(
                            documentType === "FOOD_KOT" ||
                              documentType === "BAR_TICKET" ||
                              documentType === "DISPATCH_TICKET"
                              ? "KITCHEN"
                              : (documentType as "BILL" | "RECEIPT" | "INVOICE"),
                          )
                        }
                        className="text-[12px] font-semibold text-primary hover:underline"
                      >
                        Test
                      </button>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="Reprint audit"
            sub={`${reprints.length} duplicate events this session`}
            right={
              <Btn onClick={reprintLatest}>
                <RotateCcw className="h-4 w-4" />
                Reprint latest
              </Btn>
            }
          />
          <div className="max-h-[320px] space-y-2 overflow-y-auto p-4">
            {reprints.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted-foreground">
                Reprinted receipts, bills, invoices and KOTs appear here with reason, operator and
                original job.
              </div>
            )}
            {reprints.map((entry) => (
              <article
                key={entry.id}
                className="rounded-lg border border-border bg-secondary/30 p-3 text-[12px]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{entry.documentType.replaceAll("_", " ")}</span>
                  <Status>{entry.status === "Logged" ? "Approved" : "Rejected"}</Status>
                </div>
                <div className="mt-1 text-muted-foreground">
                  Original {entry.originalJobId} - New {entry.jobId}
                </div>
                <div className="mt-1">{entry.reason}</div>
                <div className="mt-1 text-muted-foreground">
                  {entry.requestedBy} - {entry.createdAt}
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Receipt logo assets"
          sub="Company logo is the default; branch logo overrides it for the selected branch"
          right={<ImageIcon className="h-4 w-4 text-primary" />}
        />
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-5 text-[13px] font-semibold hover:bg-secondary">
                <Upload className="h-4 w-4 text-primary" />
                Upload company logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => uploadLogo(event, "Company")}
                  className="hidden"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-5 text-[13px] font-semibold hover:bg-secondary">
                <Upload className="h-4 w-4 text-primary" />
                Upload {branch} logo
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => uploadLogo(event, "Branch")}
                  className="hidden"
                />
              </label>
            </div>
            <div className="rounded-md bg-card px-3 py-2 text-[12px] text-muted-foreground">
              {logoNotice}
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <dt className="text-muted-foreground">Active scope</dt>
                <dd className="mt-1 font-bold">
                  {activeLogo
                    ? `${activeLogo.scope}${activeLogo.branch ? ` - ${activeLogo.branch}` : ""}`
                    : "Text fallback"}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <dt className="text-muted-foreground">Printer payload</dt>
                <dd className="mt-1 font-bold">
                  {activeLogo
                    ? `${Math.ceil(activeLogo.escposHex.length / 2).toLocaleString()} bytes`
                    : "Logo disabled"}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <dt className="text-muted-foreground">Raster size</dt>
                <dd className="mt-1 font-bold">
                  {activeLogo ? `${activeLogo.width} x ${activeLogo.height}px` : "Text only"}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <dt className="text-muted-foreground">Fallback text</dt>
                <dd className="mt-1 font-bold">
                  {activeLogo?.fallbackText ?? profile.printIdentity.businessName}
                </dd>
              </div>
            </dl>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="mb-2 text-[12px] font-bold text-muted-foreground">Original</div>
              {activeLogo ? (
                <img
                  src={activeLogo.originalDataUrl}
                  alt=""
                  className="h-36 w-full rounded-md border border-border bg-white object-contain p-3"
                />
              ) : (
                <div className="grid h-36 place-items-center rounded-md border border-dashed border-border text-[12px] text-muted-foreground">
                  No logo uploaded
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <div className="mb-2 text-[12px] font-bold text-muted-foreground">
                Printer monochrome
              </div>
              {activeLogo ? (
                <img
                  src={activeLogo.monochromeDataUrl}
                  alt=""
                  className="h-36 w-full rounded-md border border-border bg-white object-contain p-3 [image-rendering:pixelated]"
                />
              ) : (
                <div className="grid h-36 place-items-center rounded-md border border-dashed border-border text-[12px] text-muted-foreground">
                  Text fallback prints instead
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="mt-4">
        <PanelHead
          title="Receipt, bill and invoice templates"
          sub="Template settings drive the rendered print content used by POS"
        />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {(Object.values(documentTemplates) as PrintTemplateSettings[]).map((template) => (
            <article
              key={template.id}
              className="rounded-lg border border-border bg-secondary/30 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold">{template.label}</div>
                  <div className="text-[12px] text-muted-foreground">{template.id}</div>
                </div>
                <Status>{template.width}</Status>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div>
                  <dt className="text-muted-foreground">Copies</dt>
                  <dd className="font-bold">{template.copies}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">QR</dt>
                  <dd className="font-bold">{template.showQrCode ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="font-bold">{template.showTax ? "Shown" : "Hidden"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Payment</dt>
                  <dd className="font-bold">{template.showPayment ? "Shown" : "Hidden"}</dd>
                </div>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-md bg-card px-3 py-2 text-[12px]">
                <span className="text-muted-foreground">Logo</span>
                <span className="font-bold">
                  {activeLogo
                    ? `${activeLogo.scope}${activeLogo.branch ? ` - ${activeLogo.branch}` : ""}`
                    : "Text fallback"}
                </span>
              </div>
              <div className="mt-3 rounded-md bg-card px-3 py-2 text-[12px] text-muted-foreground">
                {template.footerMessage}
              </div>
              <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[10px] leading-relaxed text-foreground">
                {customerPreviews[template.documentType]}
              </pre>
            </article>
          ))}
        </div>
      </Panel>

      <Panel className="mt-4">
        <PanelHead
          title="Production ticket previews"
          sub="Kitchen, bar and KDS content uses the same renderer as POS send-to-kitchen"
        />
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {productionPreviews.map((job) => (
            <article
              key={`${job.documentType}-${job.kitchenDelivery}-${job.productionStation}`}
              className="rounded-lg border border-border bg-secondary/30 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[13px] font-bold">{job.documentType.replaceAll("_", " ")}</div>
                <Status>{job.kitchenDelivery?.replaceAll("_", " ")}</Status>
              </div>
              <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[10px] leading-relaxed text-foreground">
                {job.content}
              </pre>
            </article>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
