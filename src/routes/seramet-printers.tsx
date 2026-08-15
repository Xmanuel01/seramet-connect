import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ChangeEvent } from "react";
import { Activity, Cable, ImageIcon, Printer, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { processReceiptLogoFile, type LogoScope, type ReceiptLogoAsset } from "@/lib/receipt-logo";
import {
  SerametPrintService,
  SerametLocalPrintBridge,
  documentTemplates,
  type OrderForPrint,
  type PrintDocumentType,
} from "@/lib/seramet-print-service";

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

const branches = ["Westlands", "Ngong Road"];

function sampleOrder(branch: string): OrderForPrint {
  return {
    orderId: "#TEST-1844",
    branch,
    terminalId: `${branch.toUpperCase().replace(/[^A-Z0-9]/g, "")}-POS-01`,
    table: "08",
    orderType: "Dine-In",
    requestedBy: "Amina W.",
    cashier: "Amina W.",
    waiter: "Joan A.",
    createdAt: "12:46",
    customer: "Walk-in Customer",
    kitchenNote: "No chilli on one biryani. Serve all meals together.",
    tillNumber: "4235484",
    receiptNumber: "RCP #TEST-1844",
    invoiceNumber: "INV #TEST-1844",
    lines: [
      {
        id: "p1",
        name: "Chicken Biryani",
        category: "Main Meals",
        quantity: 1,
        unitPrice: 780,
        productionStation: "MAIN KITCHEN",
        modifiers: ["Extra gravy"],
        itemNote: "No chilli",
      },
      {
        id: "p8",
        name: "Tamarind Juice",
        category: "Drinks",
        quantity: 2,
        unitPrice: 220,
        productionStation: "BAR",
        itemNote: "No ice in one glass",
      },
    ],
    subtotal: 1220,
    tax: 195,
    total: 1415,
    paid: 1500,
    change: 85,
    paymentMethod: "M-Pesa",
    paymentReference: "TH7XXXXXXX",
    paymentBreakdown: [{ method: "M-Pesa", amount: 1415, reference: "TH7XXXXXXX" }],
  };
}

function SerametPrinters() {
  const [branch, setBranch] = useState(branches[0]);
  const [bridgeStatus, setBridgeStatus] = useState(() => SerametLocalPrintBridge.getStatus());
  const [notice, setNotice] = useState("No test job sent in this session.");
  const [logoNotice, setLogoNotice] = useState("No receipt logo uploaded in this session.");
  const [logoAssets, setLogoAssets] = useState<Record<string, ReceiptLogoAsset | undefined>>({});
  const { profile, jobs, reprints, printCustomerDocument, sendKitchenTickets, reprintJob } =
    useSerametPrintQueue(branch);
  const visiblePrinters = useMemo(
    () => SerametLocalPrintBridge.discoverPrinters(profile),
    [profile],
  );
  const connected = profile.printers.filter((printer) => printer.connection === "Connected").length;
  const failures = profile.printers.reduce((sum, printer) => sum + printer.failures, 0);
  const activeLogo = logoAssets[`Branch:${branch}`] ?? logoAssets.Company;
  const previewOrder = useMemo(() => sampleOrder(branch), [branch]);
  const customerPreviews = useMemo(
    () => ({
      BILL: SerametPrintService.createDocumentJob(profile, previewOrder, "BILL").content,
      RECEIPT: SerametPrintService.createDocumentJob(profile, previewOrder, "RECEIPT").content,
      INVOICE: SerametPrintService.createDocumentJob(profile, previewOrder, "INVOICE").content,
    }),
    [previewOrder, profile],
  );
  const productionPreviews = useMemo(
    () => SerametPrintService.createProductionTicketJobs(profile, previewOrder, [], "NEW").jobs,
    [previewOrder, profile],
  );

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

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>, scope: LogoScope) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const asset = await processReceiptLogoFile(
        file,
        scope,
        scope === "Branch" ? branch : undefined,
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

  return (
    <AppShell
      title="Seramet printers"
      subtitle="Hardware health, document templates, routing and audited reprints"
      actions={
        <>
          <select
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold outline-none"
          >
            {branches.map((item) => (
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
        <Metric label="Bridge jobs" value={bridgeStatus.acceptedJobs} />
        <Metric label="Failures" value={failures + bridgeStatus.rejectedJobs} invert />
      </div>

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
            sub={bridgeStatus.machine}
            right={<Cable className="h-4 w-4 text-primary" />}
          />
          <div className="space-y-3 p-4 text-[13px]">
            <div className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{bridgeStatus.name}</span>
                <Status>{bridgeStatus.online ? "Connected" : "Offline"}</Status>
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                Version {bridgeStatus.version} - heartbeat {bridgeStatus.lastHeartbeat}
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
              <Btn onClick={() => setBridgeStatus(SerametLocalPrintBridge.authenticate("1234"))}>
                <ShieldCheck className="h-4 w-4" />
                Authenticate
              </Btn>
              <Btn onClick={() => setBridgeStatus(SerametLocalPrintBridge.getStatus())}>
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
                <dd className="mt-1 font-bold">{activeLogo?.fallbackText ?? "Mona Swahili"}</dd>
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
          {Object.values(documentTemplates).map((template) => (
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
