import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type ProcurementSupplierRow,
  useProcurementControlCentre,
} from "@/procurement/use-procurement-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers - Seramet" },
      {
        name: "description",
        content: "Authoritative supplier master, terms, purchasing and payable evidence.",
      },
    ],
  }),
  component: Suppliers,
});

type AggregatedSupplier = ProcurementSupplierRow & { branchCount: number };

function Suppliers() {
  const { currentUser, currency, branchLabel } = useAppContext();
  const control = useProcurementControlCentre(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const suppliers = useMemo<AggregatedSupplier[]>(() => {
    const byId = new Map<string, AggregatedSupplier>();
    for (const branch of control.data) {
      for (const supplier of branch.suppliers) {
        const existing = byId.get(supplier.id);
        if (!existing) {
          byId.set(supplier.id, {
            ...supplier,
            branchCount: 1,
          });
          continue;
        }
        existing.branchCount += 1;
        existing.order_count += Number(supplier.order_count);
        existing.ordered_minor += Number(supplier.ordered_minor);
        existing.outstanding_minor += Number(supplier.outstanding_minor);
        existing.on_time_count += Number(supplier.on_time_count);
        existing.received_count += Number(supplier.received_count);
      }
    }
    return [...byId.values()].sort(
      (a, b) => Number(b.ordered_minor) - Number(a.ordered_minor) || a.name.localeCompare(b.name),
    );
  }, [control.data]);

  const outstandingMinor = suppliers.reduce(
    (total, supplier) => total + Number(supplier.outstanding_minor),
    0,
  );
  const orderedMinor = suppliers.reduce(
    (total, supplier) => total + Number(supplier.ordered_minor),
    0,
  );
  const receivedOrders = suppliers.reduce(
    (total, supplier) => total + Number(supplier.received_count),
    0,
  );
  const onTimeOrders = suppliers.reduce(
    (total, supplier) => total + Number(supplier.on_time_count),
    0,
  );
  const onTimeRate = receivedOrders ? Math.round((onTimeOrders / receivedOrders) * 100) : 0;
  const canCreate = currentUser.permissions.includes(permissions.procurementCreate);

  return (
    <AppShell
      title="Suppliers"
      subtitle={`Supplier master and purchasing evidence - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn variant="primary" disabled={!canCreate} onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New supplier
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Active suppliers" value={suppliers.length} />
        <Metric label="Purchase value" value={orderedMinor / 100} money />
        <Metric label="Open commitments" value={outstandingMinor / 100} money />
        <Metric label="On-time receipts" value={onTimeRate} suffix="%" />
      </div>

      {(notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Supplier directory"
          sub="Tenant supplier master with branch-scoped purchase and receipt evidence"
        />
        {control.status === "loading" ? (
          <div className="p-6 text-[13px] text-muted-foreground">Loading suppliers...</div>
        ) : suppliers.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No active suppliers are registered yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <TH>Supplier</TH>
                  <TH>Code</TH>
                  <TH className="text-right">Lead time</TH>
                  <TH className="text-right">Terms</TH>
                  <TH className="text-right">Orders</TH>
                  <TH className="text-right">Purchased</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">On time</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => {
                  const received = Number(supplier.received_count);
                  const onTime = received
                    ? Math.round((Number(supplier.on_time_count) / received) * 100)
                    : 0;
                  return (
                    <tr key={supplier.id} className="hover:bg-secondary/50">
                      <TD className="font-semibold">{supplier.name}</TD>
                      <TD className="num text-muted-foreground">{supplier.code}</TD>
                      <TD className="num text-right">{supplier.lead_time_days ?? 0} days</TD>
                      <TD className="num text-right">{supplier.payment_terms_days ?? 0} days</TD>
                      <TD className="num text-right">{supplier.order_count}</TD>
                      <TD className="num text-right">
                        {ksh(Number(supplier.ordered_minor) / 100)}
                      </TD>
                      <TD className="num text-right">
                        {ksh(Number(supplier.outstanding_minor) / 100)}
                      </TD>
                      <TD className="num text-right">{received ? `${onTime}%` : "-"}</TD>
                      <TD>
                        <Status>{received || supplier.order_count ? "ACTIVE" : "NEW"}</Status>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <CreateSupplierDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        currency={currency}
        busy={busy}
        onSubmit={async (body) => {
          setBusy(true);
          setNotice("");
          try {
            await control.command("/api/seramet/procurement/suppliers", body);
            setNotice("Supplier created in the authoritative supplier master.");
            setCreateOpen(false);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Supplier could not be created");
          } finally {
            setBusy(false);
          }
        }}
      />
    </AppShell>
  );
}

function CreateSupplierDialog({
  open,
  onOpenChange,
  currency,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [address, setAddress] = useState("");
  const [terms, setTerms] = useState("0");
  const [leadTime, setLeadTime] = useState("0");
  const [minimumOrder, setMinimumOrder] = useState("0");
  const valid =
    code.trim().length > 0 &&
    name.trim().length > 0 &&
    Number(terms) >= 0 &&
    Number(leadTime) >= 0 &&
    Number(minimumOrder) >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New supplier</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier code">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Supplier name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Legal name">
            <input
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Tax / KRA PIN">
            <input
              value={taxNumber}
              onChange={(event) => setTaxNumber(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Payment terms (days)">
            <input
              type="number"
              min={0}
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Lead time (days)">
            <input
              type="number"
              min={0}
              value={leadTime}
              onChange={(event) => setLeadTime(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={`Minimum order (${currency})`}>
            <input
              inputMode="decimal"
              value={minimumOrder}
              onChange={(event) => setMinimumOrder(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Address">
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              void onSubmit({
                code: code.trim(),
                name: name.trim(),
                ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
                ...(phone.trim() ? { phone: phone.trim() } : {}),
                ...(email.trim() ? { email: email.trim() } : {}),
                ...(taxNumber.trim() ? { taxNumber: taxNumber.trim() } : {}),
                ...(address.trim() ? { address: address.trim() } : {}),
                paymentTermsDays: Math.round(Number(terms)),
                leadTimeDays: Math.round(Number(leadTime)),
                minimumOrderMinor: Math.round(Number(minimumOrder) * 100),
                currency,
              })
            }
          >
            Create supplier
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary";
