import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, ChefHat, Printer, Settings2, Store, Wifi } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Segmented, Status } from "@/components/app/ui";
import { cn } from "@/lib/utils";
import {
  SerametLocalPrintBridge,
  SerametPrintService,
  type BranchCapability,
  type KitchenOperatingMode,
  type PrinterRole,
} from "@/lib/seramet-print-service";

export const Route = createFileRoute("/seramet-setup")({
  head: () => ({
    meta: [
      { title: "Hardware Setup - Seramet" },
      {
        name: "description",
        content:
          "Branch hardware setup wizard for POS, kitchen printers, bridge and module capabilities.",
      },
    ],
  }),
  component: SerametSetup,
});

const branches = ["Westlands", "Ngong Road"];
const steps = ["Branch", "Capabilities", "Printers", "Review"];
const capabilityLabels: Record<BranchCapability, string> = {
  POS_ENABLED: "POS enabled",
  TABLE_SERVICE: "Table service",
  KDS_ENABLED: "Kitchen display",
  KITCHEN_PRINTING: "Kitchen printing",
  BAR_PRINTING: "Bar printing",
  RESERVATIONS: "Reservations",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  ONLINE_ORDERS: "Online orders",
  LOYALTY: "Loyalty",
  CUSTOMER_DISPLAY: "Customer display",
  BAR_MODULE: "Bar module",
  RECEIPT_PRINTING: "Receipt printing",
  INVOICE_PRINTING: "Invoice printing",
};
const printerRoles: PrinterRole[] = [
  "RECEIPT",
  "BILL",
  "INVOICE",
  "KITCHEN",
  "BAR",
  "DISPATCH",
  "REPORT",
];

function SerametSetup() {
  const [step, setStep] = useState(0);
  const [branch, setBranch] = useState(branches[0]);
  const sourceProfile = useMemo(
    () => SerametPrintService.getBranchHardwareProfile(branch),
    [branch],
  );
  const [kitchenMode, setKitchenMode] = useState<KitchenOperatingMode>(sourceProfile.kitchenMode);
  const [terminalCount, setTerminalCount] = useState(sourceProfile.posTerminals);
  const [printerCount, setPrinterCount] = useState(sourceProfile.printers.length);
  const [capabilities, setCapabilities] = useState(sourceProfile.capabilities);
  const [roleMap, setRoleMap] = useState<Record<PrinterRole, boolean>>(
    () =>
      Object.fromEntries(
        printerRoles.map((role) => [
          role,
          sourceProfile.printers.some((printer) => printer.roles.includes(role)),
        ]),
      ) as Record<PrinterRole, boolean>,
  );
  const [savedAt, setSavedAt] = useState("");
  const bridgeStatus = SerametLocalPrintBridge.getStatus();
  const enabledCount = Object.values(capabilities).filter(Boolean).length;

  const loadBranch = (nextBranch: string) => {
    const next = SerametPrintService.getBranchHardwareProfile(nextBranch);
    setBranch(nextBranch);
    setKitchenMode(next.kitchenMode);
    setTerminalCount(next.posTerminals);
    setPrinterCount(next.printers.length);
    setCapabilities(next.capabilities);
    setRoleMap(
      Object.fromEntries(
        printerRoles.map((role) => [
          role,
          next.printers.some((printer) => printer.roles.includes(role)),
        ]),
      ) as Record<PrinterRole, boolean>,
    );
    setSavedAt("");
  };

  const toggleCapability = (capability: BranchCapability) => {
    setCapabilities((current) => ({ ...current, [capability]: !current[capability] }));
  };

  const toggleRole = (role: PrinterRole) => {
    setRoleMap((current) => ({ ...current, [role]: !current[role] }));
  };

  const saveSetup = () => {
    setSavedAt(new Date().toLocaleString("en-KE", { hour12: false }));
  };

  return (
    <AppShell
      title="Hardware setup"
      subtitle="Configure branch capabilities, print bridge, printers and role routing"
      actions={
        <>
          <Status>{savedAt ? "Approved" : "Pending"}</Status>
          <Btn variant="primary" onClick={saveSetup}>
            Save setup
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Setup step" value={`${step + 1}/${steps.length}`} />
        <Metric label="Capabilities" value={enabledCount} />
        <Metric label="Printers" value={printerCount} />
        <Metric label="POS terminals" value={terminalCount} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="p-2">
          <nav className="space-y-1">
            {steps.map((item, index) => (
              <button
                key={item}
                onClick={() => setStep(index)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] font-semibold",
                  step === index
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <span>{item}</span>
                {index < step || savedAt ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <span className="num text-[11px]">{index + 1}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3 text-[12px] text-muted-foreground">
            <div className="font-semibold text-foreground">{branch}</div>
            Bridge {bridgeStatus.authenticated ? "authenticated" : "needs authentication"} -{" "}
            {bridgeStatus.acceptedJobs} jobs accepted.
          </div>
        </Panel>

        <div className="grid gap-4">
          {step === 0 && (
            <Panel>
              <PanelHead
                title="Branch profile"
                sub="Choose the operating branch and terminal footprint"
                right={<Store className="h-4 w-4 text-primary" />}
              />
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  Branch
                  <select
                    value={branch}
                    onChange={(event) => loadBranch(event.target.value)}
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                  >
                    {branches.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                  POS terminals
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={terminalCount}
                    onChange={(event) => setTerminalCount(Number(event.target.value))}
                    className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                  />
                </label>
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="text-[13px] font-bold">Branch lock</div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    POS terminals inherit this branch during setup; cashiers do not change it from
                    the till.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="text-[13px] font-bold">Hardware mode</div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Printer and module visibility are derived from the saved branch capability
                    profile.
                  </p>
                </div>
              </div>
            </Panel>
          )}

          {step === 1 && (
            <Panel>
              <PanelHead
                title="Branch capabilities"
                sub="Modules hide or appear based on these enabled branch features"
                right={<Settings2 className="h-4 w-4 text-primary" />}
              />
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {(Object.keys(capabilityLabels) as BranchCapability[]).map((capability) => (
                  <button
                    key={capability}
                    onClick={() => toggleCapability(capability)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] font-semibold",
                      capabilities[capability]
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    <span>{capabilityLabels[capability]}</span>
                    <span className="text-[11px]">{capabilities[capability] ? "On" : "Off"}</span>
                  </button>
                ))}
              </div>
            </Panel>
          )}

          {step === 2 && (
            <Panel>
              <PanelHead
                title="Printers and stations"
                sub="Choose operating mode, printer count and roles handled at this branch"
                right={<Printer className="h-4 w-4 text-primary" />}
              />
              <div className="space-y-4 p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-muted-foreground">
                      Kitchen operating mode
                    </div>
                    <Segmented
                      options={[
                        "KDS_ONLY",
                        "PRINTER_ONLY",
                        "KDS_AND_PRINTER",
                        "NO_DEDICATED_KITCHEN_SYSTEM",
                      ]}
                      value={kitchenMode}
                      onChange={(value) => setKitchenMode(value as KitchenOperatingMode)}
                    />
                  </div>
                  <label className="grid gap-1 text-[12px] font-semibold text-muted-foreground">
                    Printer count
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={printerCount}
                      onChange={(event) => setPrinterCount(Number(event.target.value))}
                      className="h-10 rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none"
                    />
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {printerRoles.map((role) => (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-[13px] font-semibold",
                        roleMap[role]
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {role}
                      <span className="mt-1 block text-[11px] opacity-70">
                        {roleMap[role] ? "Mapped" : "Not mapped"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-[12px] text-muted-foreground">
                  One-printer branches route every enabled role to the same bridge-visible printer.
                  Multi-printer branches route kitchen, bar, dispatch and front counter separately
                  with fallback to the front printer.
                </div>
              </div>
            </Panel>
          )}

          {step === 3 && (
            <Panel>
              <PanelHead
                title="Review and activate"
                sub="Final setup summary before saving branch hardware capabilities"
                right={<Wifi className="h-4 w-4 text-primary" />}
              />
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="text-[13px] font-bold">Branch capability model</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(Object.keys(capabilities) as BranchCapability[])
                      .filter((capability) => capabilities[capability])
                      .map((capability) => (
                        <span
                          key={capability}
                          className="rounded-md bg-card px-2 py-1 text-[11px] font-semibold text-muted-foreground"
                        >
                          {capabilityLabels[capability]}
                        </span>
                      ))}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="text-[13px] font-bold">Print routing</div>
                  <dl className="mt-2 space-y-1 text-[12px]">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Mode</dt>
                      <dd className="font-semibold">{kitchenMode.replaceAll("_", " ")}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Printers</dt>
                      <dd className="font-semibold">{printerCount}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Mapped roles</dt>
                      <dd className="font-semibold">
                        {Object.values(roleMap).filter(Boolean).length}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Bridge</dt>
                      <dd className="font-semibold">
                        {bridgeStatus.authenticated ? "Ready" : "Needs auth"}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="md:col-span-2 rounded-lg border border-success/30 bg-success-soft p-3 text-[13px] text-success">
                  {savedAt
                    ? `Setup saved on ${savedAt}.`
                    : "Review the setup and click Save setup to activate this branch profile in the UI."}
                </div>
              </div>
            </Panel>
          )}

          <div className="flex justify-between">
            <Btn onClick={() => setStep((current) => Math.max(0, current - 1))}>Back</Btn>
            <Btn
              variant="primary"
              onClick={() =>
                step === steps.length - 1
                  ? saveSetup()
                  : setStep((current) => Math.min(steps.length - 1, current + 1))
              }
            >
              {step === steps.length - 1 ? "Save setup" : "Next"}
            </Btn>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
