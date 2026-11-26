import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Printer } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { PrinterAdministration } from "@/components/app/PrinterAdministration";
import { ReceiptLogoPanel } from "@/components/app/ReceiptLogoPanel";
import { KitchenModeChooser } from "@/components/app/KitchenModeChooser";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { KitchenPrintBypassPanel } from "@/components/app/KitchenPrintBypassPanel";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { permissions } from "@/platform/permissions";
import type { KitchenPrintObligation } from "@/lib/transaction-engine";
import { businessDateForTimestamp } from "@/lib/business-date";
import { kitchenPrintRecoveryItems } from "@/lib/kitchen-print-recovery";
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
import {
  documentTypeLabels,
  kitchenTicketKindLabels,
  kitchenTicketStatusLabels,
  printerRoleLabels,
} from "@/lib/printer-labels";
import { solidRules } from "../../printing-core/solid-rules.mjs";
import { RichDocumentPreview } from "@/components/app/DocumentTextPreview";

export const Route = createFileRoute("/seramet-printers")({
  head: () => ({
    meta: [
      { title: "Printers" },
      {
        name: "description",
        content: "Set up your printers, choose what each one prints and print test pages.",
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
    hasPermission,
    canSwitchBranch,
    currentUser,
    switchableBranchRecords,
    timeZone,
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
  const [notice, setNotice] = useState("");
  const [kotRecoveryBusy, setKotRecoveryBusy] = useState(false);
  const kotActionRef = useRef(false);
  const [kotRecoveryReason, setKotRecoveryReason] = useState("");
  const { state: transactions, mutate: mutateTransaction } = useTransactionEngine();
  const selectedBranchRecord = switchableBranchRecords.find((item) => item.id === selectedBranchId);
  // Only tickets for orders still open in the kitchen today need a manager's attention.
  const recoveryItems = kitchenPrintRecoveryItems(
    transactions.kitchenPrintObligations ?? [],
    selectedBranchId,
    {
      orders: transactions.orders,
      today: businessDateForTimestamp(
        new Date(),
        selectedBranchRecord?.timezone ?? timeZone,
        Number(selectedBranchRecord?.metadata["businessDayCutoffMinutes"] ?? 0),
      ),
    },
  );
  const recentlyAccepted = (transactions.kitchenPrintObligations ?? [])
    .filter((item) => item.branchId === selectedBranchId && item.status === "BRIDGE_ACCEPTED")
    .slice(0, 12);
  const mayReviewKot =
    selectedBranchId === activeBranchId && hasPermission(permissions.settingsBranchManage);
  const mayDeliverKot =
    selectedBranchId === activeBranchId && hasPermission(permissions.ordersUpdate);

  useEffect(() => setBranch(activeBranch), [activeBranch]);
  const {
    profile,
    configurationError,
    jobs,
    reprints,
    bridgeConfig,
    printCustomerDocument,
    sendKitchenTickets,
  } = useSerametPrintQueue(selectedBranchId);
  const recoverPendingKot = async (obligation: KitchenPrintObligation) => {
    if (kotActionRef.current || !mayDeliverKot) return;
    const original = transactions.orders.find(
      (order) => order.id === obligation.orderId && order.branchId === selectedBranchId,
    );
    if (!original) {
      setNotice("This order isn't in the selected branch. Switch to the branch that took it.");
      return;
    }
    kotActionRef.current = true;
    setKotRecoveryBusy(true);
    const token = crypto.randomUUID();
    try {
      await mutateTransaction("claimKitchenPrintObligation", {
        obligationId: obligation.id,
        claimToken: token,
      });
      const outcomes = new Map<string, "BRIDGE_ACCEPTED" | "UNCERTAIN">();
      let expectedJobs = 0;
      let finalized = false;
      const callback = (jobId: string, outcome: "BRIDGE_ACCEPTED" | "UNCERTAIN") => {
        outcomes.set(jobId, outcome);
        if (!expectedJobs || outcomes.size !== expectedJobs || finalized) return;
        finalized = true;
        const overall = [...outcomes.values()].every((value) => value === "BRIDGE_ACCEPTED")
          ? "BRIDGE_ACCEPTED"
          : "UNCERTAIN";
        void mutateTransaction("settleKitchenPrintObligation", {
          obligationId: obligation.id,
          claimToken: token,
          outcome: overall,
          ...(overall === "UNCERTAIN"
            ? { failureReason: "One or more recovery delivery routes were unconfirmed" }
            : {}),
        }).catch(() =>
          setNotice(
            "The ticket was sent, but Seramet couldn't record it. " +
              "Check the kitchen printer before printing it again.",
          ),
        );
      };
      const result = sendKitchenTickets(
        {
          orderId: original.id,
          branch: original.branch,
          terminalId: "MANUAL-KOT-RECOVERY",
          ...(original.table ? { table: original.table } : {}),
          orderType: original.channel,
          requestedBy: currentUser.name,
          cashier: original.cashier,
          waiter: original.waiter ?? original.cashier,
          createdAt: obligation.createdAt,
          lines: obligation.lines.map((line) => ({
            id: line.id,
            name: line.name,
            category: line.category,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            productionStation: (line.productionStation ??
              "NONE") as OrderForPrint["lines"][number]["productionStation"],
            ...(line.itemNote ? { itemNote: line.itemNote } : {}),
          })),
          subtotal: original.subtotal,
          tax: original.tax,
          total: original.total,
          customer: original.customer,
          ...(original.kitchenNote ? { kitchenNote: original.kitchenNote } : {}),
        },
        obligation.reviewReason ? "REPRINT" : obligation.kind === "ORIGINAL" ? "NEW" : "ADDITION",
        (job, outcome) => {
          queueMicrotask(() => callback(job.id, outcome));
        },
        { obligationId: obligation.id, claimToken: token },
      );
      expectedJobs = result.jobs.length;
      if (!expectedJobs) {
        await mutateTransaction("settleKitchenPrintObligation", {
          obligationId: obligation.id,
          claimToken: token,
          outcome: "UNCERTAIN",
          failureReason: "No recovery delivery route was queued",
        });
        throw new Error("No printer is set up for this station. Check Your printers above.");
      }
      setNotice(
        `Printing ${obligation.orderId} for ${obligation.station}. ` +
          "Check that the ticket came out of the printer.",
      );
    } catch (error) {
      setNotice(
        (error instanceof Error ? error.message : "Couldn't print this ticket.") +
          " Check the kitchen printer before trying again.",
      );
    } finally {
      kotActionRef.current = false;
      setKotRecoveryBusy(false);
    }
  };

  const reviewKot = async (
    obligation: KitchenPrintObligation,
    decision: "CONFIRM_DELIVERED" | "RETRY",
  ) => {
    if (kotActionRef.current || !mayReviewKot || kotRecoveryReason.trim().length < 12) return;
    kotActionRef.current = true;
    setKotRecoveryBusy(true);
    try {
      await mutateTransaction("reviewKitchenPrintObligation", {
        obligationId: obligation.id,
        decision,
        reason: kotRecoveryReason,
      });
      setNotice(
        decision === "RETRY"
          ? "Reprint allowed. Choose Print again once you've checked the printer."
          : "Marked as printed.",
      );
      setKotRecoveryReason("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn't save your decision. Try again.");
    } finally {
      kotActionRef.current = false;
      setKotRecoveryBusy(false);
    }
  };

  const requestAuditedReprint = async (obligation: KitchenPrintObligation) => {
    if (kotActionRef.current || !mayReviewKot || kotRecoveryReason.trim().length < 12) return;
    kotActionRef.current = true;
    setKotRecoveryBusy(true);
    try {
      await mutateTransaction("requestKitchenReprint", {
        obligationId: obligation.id,
        reason: kotRecoveryReason.trim(),
      });
      setNotice("Reprint approved. It's listed under Kitchen tickets to check, ready to print.");
      setKotRecoveryReason("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Couldn't approve the reprint. Try again.",
      );
    } finally {
      kotActionRef.current = false;
      setKotRecoveryBusy(false);
    }
  };

  const visiblePrinters = useMemo(
    () => (profile ? SerametLocalPrintBridge.discoverPrinters(profile) : []),
    [profile],
  );
  const connected =
    profile?.printers.filter((printer) => printer.connection === "Connected").length ?? 0;
  const failures = profile?.printers.reduce((sum, printer) => sum + printer.failures, 0) ?? 0;
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
            BILL: SerametPrintService.createDocumentJob(profile, previewOrder, "BILL"),
            RECEIPT: SerametPrintService.createDocumentJob(profile, previewOrder, "RECEIPT"),
            INVOICE: SerametPrintService.createDocumentJob(profile, previewOrder, "INVOICE"),
          }
        : undefined,
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
        error: "This computer isn't connected to a print bridge.",
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
        error: error instanceof Error ? error.message : "The print bridge isn't responding.",
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
    const label = type === "KITCHEN" ? "kitchen ticket" : type.toLowerCase();
    setNotice(
      result.jobs.length
        ? `Test ${label} sent. Check that it came out of the printer.`
        : `No printer is set up to print a ${label}.`,
    );
  };

  const branchPicker = (
    <select
      value={branch}
      onChange={(event) => setBranch(event.target.value)}
      disabled={!canSwitchBranch}
      title={canSwitchBranch ? "Select an assigned branch" : "Assigned branch"}
      aria-label="Branch"
      className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold outline-none"
    >
      {branchOptions.map((item) => (
        <option key={item}>{item}</option>
      ))}
    </select>
  );

  if (!profile) {
    return (
      <AppShell title="Printers" actions={branchPicker}>
        <PrinterAdministration />
        <KitchenPrintBypassPanel />
        <Panel>
          <PanelHead
            title="Finish setting up printing"
            sub={branch}
            right={<Printer className="h-4 w-4 text-warning" />}
          />
          <div className="space-y-3 p-4 text-[13px]">
            {configurationError === "Kitchen operating mode is not configured" ? (
              <>
                <p className="max-w-2xl">
                  Choose how orders reach the kitchen. Until you do, tills can&apos;t send orders to
                  the kitchen.
                </p>
                <KitchenModeChooser />
              </>
            ) : (
              <p className="max-w-2xl text-muted-foreground">
                {configurationError ?? "Printing isn't set up for this branch yet."}
              </p>
            )}
            <p className="max-w-2xl text-muted-foreground">
              Finish printer setup in Setup Centre, then come back to print a test page.
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

  const failedJobs = jobs.filter((job) => job.status === "Failed").length;
  const bridgeOnline = bridgeConfigReady(bridgeConfig) && installedBridge.online;
  const kitchenTicketsToCheck = recoveryItems.length > 0 || recentlyAccepted.length > 0;
  const routeRows = (Object.keys(profile.documentRoutes) as PrintDocumentType[]).map(
    (documentType) => {
      const resolution = SerametPrintService.resolvePrinter(profile, documentType);
      const route = profile.documentRoutes[documentType];
      const printedOn =
        route.primaryRole === "KDS"
          ? "Kitchen screen"
          : (resolution.printer?.name ?? resolution.fallbackPrinter?.name);
      return {
        documentType,
        printedOn,
        backup:
          resolution.printer && resolution.fallbackPrinter
            ? resolution.fallbackPrinter.name
            : undefined,
        copies: resolution.route.copies,
      };
    },
  );
  const testKind = (documentType: PrintDocumentType) =>
    documentType === "FOOD_KOT" ||
    documentType === "BAR_TICKET" ||
    documentType === "DISPATCH_TICKET"
      ? ("KITCHEN" as const)
      : documentType === "BILL" || documentType === "RECEIPT" || documentType === "INVOICE"
        ? documentType
        : null;

  return (
    <AppShell
      title="Printers"
      actions={
        <>
          {branchPicker}
          <Btn variant="primary" onClick={() => runTest("BILL")}>
            Test bill
          </Btn>
        </>
      }
    >
      <PrinterAdministration />
      {notice && (
        <div className="mb-4 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
          {notice}
        </div>
      )}
      {kitchenTicketsToCheck && (
        <Panel className="mb-4">
          <PanelHead
            title="Kitchen tickets to check"
            sub="These tickets may not have printed. Check the kitchen printer before printing again, so the kitchen doesn't make an order twice."
            right={<Status>{recoveryItems.length} to check</Status>}
          />
          <div className="space-y-3 p-4 text-[13px]">
            {!mayDeliverKot && (
              <p className="text-muted-foreground">
                To print this branch's tickets, switch to it as your working branch.
              </p>
            )}
            {mayReviewKot && (
              <label className="block">
                <span className="font-semibold">
                  What did you check? (manager, at least 12 characters)
                </span>
                <input
                  value={kotRecoveryReason}
                  onChange={(event) => setKotRecoveryReason(event.target.value)}
                  className="mt-2 w-full rounded-md border bg-card px-3 py-2"
                  placeholder="For example: checked the kitchen printer, ticket was missing"
                />
              </label>
            )}
            {recoveryItems.length === 0 && (
              <p className="text-muted-foreground">Nothing to check right now.</p>
            )}
            {recoveryItems.map((obligation) => (
              <div key={obligation.id} className="rounded-lg border p-3">
                <div className="font-semibold">
                  {obligation.orderId} · {obligation.station} ·{" "}
                  {kitchenTicketKindLabels[obligation.kind] ?? obligation.kind}
                </div>
                <p className="mt-1 text-muted-foreground">
                  {kitchenTicketStatusLabels[obligation.status] ?? obligation.status} ·{" "}
                  {obligation.lines.length} item{obligation.lines.length === 1 ? "" : "s"}.
                  {obligation.status !== "PENDING" &&
                    " It may have printed even though Seramet didn't hear back."}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {obligation.status === "PENDING" && (
                    <Btn
                      onClick={() => void recoverPendingKot(obligation)}
                      disabled={kotRecoveryBusy || !mayDeliverKot}
                    >
                      {obligation.reviewReason ? "Print again" : "Print ticket now"}
                    </Btn>
                  )}
                  {obligation.status !== "PENDING" && mayReviewKot && (
                    <>
                      <Btn
                        onClick={() => void reviewKot(obligation, "CONFIRM_DELIVERED")}
                        disabled={kotRecoveryBusy || kotRecoveryReason.trim().length < 12}
                      >
                        It printed
                      </Btn>
                      <Btn
                        onClick={() => void reviewKot(obligation, "RETRY")}
                        disabled={kotRecoveryBusy || kotRecoveryReason.trim().length < 12}
                      >
                        It didn't print: allow a reprint
                      </Btn>
                    </>
                  )}
                </div>
              </div>
            ))}
            {recentlyAccepted.length > 0 && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer font-semibold">
                  Recently sent kitchen tickets ({recentlyAccepted.length})
                </summary>
                <p className="mt-2 text-muted-foreground">
                  These reached the printer. If one didn't come out, a manager can approve a
                  reprint.
                </p>
                <div className="mt-2 space-y-2">
                  {recentlyAccepted.map((obligation) => (
                    <div
                      key={obligation.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <div className="font-semibold">
                          {obligation.orderId} · {obligation.station}
                        </div>
                        <div className="text-muted-foreground">
                          {kitchenTicketKindLabels[obligation.kind] ?? obligation.kind} ·{" "}
                          {obligation.createdAt}
                        </div>
                      </div>
                      {mayReviewKot && (
                        <Btn
                          onClick={() => void requestAuditedReprint(obligation)}
                          disabled={kotRecoveryBusy || kotRecoveryReason.trim().length < 12}
                        >
                          Approve a reprint
                        </Btn>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </Panel>
      )}

      <Panel className="mb-4">
        <PanelHead
          title="What prints where"
          sub="Each document and the printer it prints on."
          right={<KitchenModeChooser current={profile.kitchenMode} />}
        />
        <div className="overflow-x-auto">
          <table aria-label="What prints where" className="w-full">
            <thead>
              <tr>
                <TH>Document</TH>
                <TH>Prints on</TH>
                <TH>Backup</TH>
                <TH className="text-right">Copies</TH>
                <TH>Test</TH>
              </tr>
            </thead>
            <tbody>
              {routeRows.map((row) => {
                const kind = testKind(row.documentType);
                return (
                  <tr key={row.documentType}>
                    <TD className="font-semibold">
                      {documentTypeLabels[row.documentType] ?? row.documentType}
                    </TD>
                    <TD>
                      {row.printedOn ?? <span className="text-warning">No printer set up</span>}
                    </TD>
                    <TD className="text-muted-foreground">{row.backup ?? "None"}</TD>
                    <TD className="num text-right">{row.copies}</TD>
                    <TD>
                      {kind && (
                        <button
                          onClick={() => runTest(kind)}
                          className="text-[12px] font-semibold text-primary hover:underline"
                        >
                          Test
                        </button>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <ReceiptLogoPanel businessName={profile.printIdentity.businessName} />

      <details className="mb-4 rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">
          Preview receipts and tickets
        </summary>
        <div className="grid gap-3 border-t border-border p-4 md:grid-cols-3">
          {Object.values(profile.templateSettings).map((template) => (
            <article
              key={template.id}
              className="rounded-lg border border-border bg-secondary/30 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] font-bold">{template.label}</div>
                <Status>{template.width}</Status>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {template.copies} cop{template.copies === 1 ? "y" : "ies"} · tax{" "}
                {template.showTax ? "shown" : "hidden"} · payment{" "}
                {template.showPayment ? "shown" : "hidden"}
                {template.showQrCode ? " · QR code" : ""}
              </p>
              {customerPreviews?.[template.documentType]?.rich ? (
                <div className="mt-3 max-h-96 overflow-auto">
                  <RichDocumentPreview document={customerPreviews[template.documentType].rich!} />
                </div>
              ) : (
                <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[10px] leading-none text-foreground">
                  {solidRules(customerPreviews?.[template.documentType]?.content ?? "")}
                </pre>
              )}
            </article>
          ))}
          {productionPreviews.map((job) => (
            <article
              key={`${job.documentType}-${job.kitchenDelivery}-${job.productionStation}`}
              className="rounded-lg border border-border bg-secondary/30 p-3"
            >
              <div className="mb-2 text-[13px] font-bold">
                {documentTypeLabels[job.documentType] ?? job.documentType}
                {job.kitchenDelivery === "KDS_DISPLAY" ? " (kitchen screen)" : ""}
              </div>
              {job.rich ? (
                <div className="max-h-96 overflow-auto">
                  <RichDocumentPreview document={job.rich} />
                </div>
              ) : (
                <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[10px] leading-none text-foreground">
                  {solidRules(job.content)}
                </pre>
              )}
            </article>
          ))}
        </div>
      </details>

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">
          Printer status and reprint history (for technicians)
        </summary>
        <div className="space-y-4 border-t border-border p-4 text-[13px]">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Printers" value={profile.printers.length} />
            <Metric label="Connected" value={connected} />
            <Metric label="Print jobs" value={jobs.length} />
            <Metric label="Failures" value={failures + failedJobs} invert />
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Seramet Print Bridge on this computer</span>
              <Status>
                {bridgeConfigReady(bridgeConfig)
                  ? bridgeOnline
                    ? "Connected"
                    : "Offline"
                  : "Not connected"}
              </Status>
            </div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              {bridgeConfigReady(bridgeConfig)
                ? bridgeOnline
                  ? `Version ${installedBridge.version ?? "unknown"} · ${installedBridge.printers.length} printer(s) installed in Windows`
                  : (installedBridge.error ?? "The print bridge isn't responding.")
                : 'Not connected. Use "Connect this PC" under Your printers.'}
            </div>
            <div className="mt-2">
              <Btn
                onClick={() => {
                  setBridgeStatus(SerametLocalPrintBridge.getStatus());
                  void refreshInstalledBridge();
                }}
              >
                <Activity className="h-4 w-4" />
                Check connection
              </Btn>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {visiblePrinters.map((printer) => (
              <article
                key={printer.id}
                className="rounded-lg border border-border bg-secondary/30 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 font-bold">
                    <Printer className="h-4 w-4 text-primary" />
                    <span className="truncate">{printer.name}</span>
                  </div>
                  <Status>{printer.connection}</Status>
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {printer.roles.map((role) => printerRoleLabels[role] ?? role).join(", ")}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                  <div>
                    <dt className="text-muted-foreground">Waiting</dt>
                    <dd className="num font-bold">{printer.queue}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Failures</dt>
                    <dd className="num font-bold">{printer.failures}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last print</dt>
                    <dd className="font-bold">{printer.lastPrintAt}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
          <section>
            <h3 className="font-semibold">Reprints this session ({reprints.length})</h3>
            <div className="mt-2 max-h-[320px] space-y-2 overflow-y-auto">
              {reprints.length === 0 && (
                <p className="text-muted-foreground">
                  Reprinted receipts, bills, invoices and kitchen tickets appear here with who
                  reprinted them and why.
                </p>
              )}
              {reprints.map((entry) => (
                <article
                  key={entry.id}
                  title={`Original ${entry.originalJobId} · new ${entry.jobId}`}
                  className="rounded-lg border border-border bg-secondary/30 p-3 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">
                      {documentTypeLabels[entry.documentType] ?? entry.documentType}
                    </span>
                    <Status>{entry.status === "Logged" ? "Approved" : "Rejected"}</Status>
                  </div>
                  <div className="mt-1">{entry.reason}</div>
                  <div className="mt-1 text-muted-foreground">
                    {entry.requestedBy} · {entry.createdAt}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </details>
    </AppShell>
  );
}
