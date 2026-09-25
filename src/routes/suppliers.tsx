import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers - Seramet" },
      {
        name: "description",
        content: "Authoritative supplier master with purchasing terms and branch procurement evidence.",
      },
    ],
  }),
  component: Suppliers,
});

function Suppliers() {
  const { currency } = useAppContext();
  const control = useInventoryControlCentre(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const suppliers = useMemo(() => {
    const aggregate = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        lead_time_days: number;
        payment_terms_days: number;
        currency: string;
        order_count: number;
        ordered_minor: number;
        outstanding_minor: number;
        on_time_count: number;
        received_count: number;
      }
    >();

    for (const branch of control.data) {
      for (const supplier of branch.procurement.suppliers) {
        const current = aggregate.get(supplier.id);
        if (!current) {
          aggregate.set(supplier.id, {
            ...supplier,
            order_count: Number(supplier.order_count),
            ordered_minor: Number(supplier.ordered_minor),
            outstanding_minor: Number(supplier.outstanding_minor),
            on_time_count: Number(supplier.on_time_count),
            received_count: Number(supplier.received_count),
          });
          continue;
        }
        current.order_count += Number(supplier.order_count);
        current.ordered_minor += Number(supplier.ordered_minor);
        current.outstanding_minor += Number(supplier.outstanding_minor);
        current.on_time_count += Number(supplier.on_time_count);
        current.received_count += Number(supplier.received_count);
      }
    }
    return Array.from(aggregate.values()).sort((a, b) => b.ordered_minor - a.ordered_minor);
  }, [control.data]);

  const outstanding = suppliers.reduce((sum, supplier) => sum + supplier.outstanding_minor, 0);
  const orders = suppliers.reduce((sum, supplier) => sum + supplier.order_count, 0);
  const received = suppliers.reduce((sum, supplier) => sum + supplier.received_count, 0);
  const onTime = suppliers.reduce((sum, supplier) => sum + supplier.on_time_count, 0);
  const onTimePct = received ? Math.round((onTime / received) * 100) : 0;

  const createSupplier = async (body: unknown) => {
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
  };

  return (
    <AppShell
      title="Suppliers"
      subtitle="Tenant supplier master with branch purchasing evidence"
      actions={
        <>
          <Btn disabled={control.status === "loading"} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn variant="primary" disabled={busy} onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New supplier
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Suppliers" value={suppliers.length} />
        <Metric label="Open commitments" value={outstanding / 100} money />
        <Metric label="Purchase orders" value={orders} />
        <Metric label="On-time receipts" value={onTimePct} suffix="%" />
      </div>

      {(notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Supplier directory"
          sub="Commercial terms and evidence aggregated across the selected branch scope"
        />
        {!suppliers.length ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No active suppliers are configured.
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
                  <TH className="text-right">POs</TH>
                  <TH className="text-right">Purchased</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">On time</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => {
                  const supplierOnTime = supplier.received_count
                    ? Math.round((supplier.on_time_count / supplier.received_count) * 100)
                    : 0;
                  return (
                    <tr key={supplier.id} className="hover:bg-secondary/50">
                      <TD className="font-semibold">{supplier.name}</TD>
                      <TD className="num text-muted-foreground">{supplier.code}</TD>
                      <TD className="num text-right">{supplier.lead_time_days} d</TD>
                      <TD className="num text-right">{supplier.payment_terms_days} d</TD>
                      <TD className="num text-right">{supplier.order_count}</TD>
                      <TD className="num text-right">{ksh(supplier.ordered_minor / 100)}</TD>
                      <TD className="num text-right">{ksh(supplier.outstanding_minor / 100)}</TD>
                      <TD className="num text-right">
                        {supplier.received_count ? `${supplierOnTime}%` : "—"}
                      </TD>
                      <TD><Status>{supplier.received_count > 0 ? "ACTIVE" : "NEW"}</Status></TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <NewSupplierDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenantCurrency={currency}
        busy={busy}
        onSubmit={createSupplier}
      />
    </AppShell>
  );
}

function NewSupplierDialog({
  open,
  onOpenChange,
  tenantCurrency,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantCurrency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [terms, setTerms] = useState("30");
  const [leadTime, setLeadTime] = useState("1");
  const valid = Boolean(
    code.trim() &&
      name.trim() &&
      Number.isSafeInteger(Number(terms)) &&
      Number(terms) >= 0 &&
      Number.isSafeInteger(Number(leadTime)) &&
      Number(leadTime) >= 0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New supplier</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier code">
            <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Supplier name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Legal name">
            <input className={inputClass} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Tax number">
            <input className={inputClass} value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
          </Field>
          <Field label="Payment terms (days)">
            <input className={inputClass} inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </Field>
          <Field label="Lead time (days)">
            <input className={inputClass} inputMode="numeric" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />
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
                code: code.trim().toUpperCase(),
                name: name.trim(),
                ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
                ...(phone.trim() ? { phone: phone.trim() } : {}),
                ...(email.trim() ? { email: email.trim() } : {}),
                ...(taxNumber.trim() ? { taxNumber: taxNumber.trim() } : {}),
                paymentTermsDays: Number(terms),
                leadTimeDays: Number(leadTime),
                currency: tenantCurrency,
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
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary";
