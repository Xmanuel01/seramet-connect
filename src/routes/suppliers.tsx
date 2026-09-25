import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/Tabs";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers - Seramet" }] }),
  component: Suppliers,
});

function Suppliers() {
  const { currency } = useAppContext();
  const control = useInventoryControlCentre(true);
  const suppliers = control.data.flatMap((branch) =>
    branch.procurement.suppliers.map((supplier) => ({
      ...supplier,
      branchId: branch.branchId,
    })),
  );
  const outstanding = suppliers.reduce(
    (total, supplier) => total + Number(supplier.outstanding_minor),
    0,
  );
  const orders = suppliers.reduce(
    (total, supplier) => total + Number(supplier.order_count),
    0,
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  return (
    <AppShell
      title="Suppliers"
      subtitle="Authoritative supplier master, commercial terms and procurement evidence"
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>Refresh</Btn>
          <Btn variant="primary" onClick={() => setOpen(true)}>
            New supplier
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Suppliers" value={suppliers.length} />
        <Metric label="Outstanding" value={outstanding / 100} money />
        <Metric label="Purchase orders" value={orders} />
        <Metric
          label="Data status"
          value={control.status === "ready" ? "Current" : control.status}
        />
      </div>

      {notice && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Supplier directory"
          sub={
            control.error ||
            "Terms, lead time, purchasing and receipt history are sourced from the procurement ledger"
          }
        />
        <DataTable
          cols={[
            "Supplier",
            "Code",
            "Branch",
            "Lead time",
            "Terms",
            { l: "Ordered", r: true },
            { l: "Outstanding", r: true },
            "Status",
          ]}
        >
          {suppliers.map((supplier) => (
            <tr
              key={supplier.branchId + ":" + supplier.id}
              className="hover:bg-secondary/50"
            >
              <TD className="font-semibold">{supplier.name}</TD>
              <TD className="num text-muted-foreground">{supplier.code}</TD>
              <TD className="num text-muted-foreground">{supplier.branchId}</TD>
              <TD className="num">{supplier.lead_time_days} days</TD>
              <TD className="num">{supplier.payment_terms_days} days</TD>
              <TD className="num text-right">
                {ksh(Number(supplier.ordered_minor) / 100)}
              </TD>
              <TD className="num text-right">
                {ksh(Number(supplier.outstanding_minor) / 100)}
              </TD>
              <TD>
                <Status>{supplier.received_count > 0 ? "Active" : "New"}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <SupplierDialog
        open={open}
        onOpenChange={setOpen}
        currency={currency}
        busy={busy}
        onSubmit={async (body) => {
          setBusy(true);
          setNotice("");
          try {
            await control.command("/api/seramet/procurement/suppliers", body);
            setOpen(false);
            setNotice("Supplier added to the authoritative supplier master.");
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Could not create supplier");
          } finally {
            setBusy(false);
          }
        }}
      />
    </AppShell>
  );
}

function SupplierDialog({
  open,
  onOpenChange,
  currency,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  currency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState("0");
  const [lead, setLead] = useState("0");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New supplier</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px] font-semibold">
              Code
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <label className="text-[12px] font-semibold">
              Name
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px] font-semibold">
              Phone
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
            <label className="text-[12px] font-semibold">
              Email
              <input
                type="email"
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px] font-semibold">
              Payment terms (days)
              <input
                type="number"
                min="0"
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
                value={terms}
                onChange={(event) => setTerms(event.target.value)}
              />
            </label>
            <label className="text-[12px] font-semibold">
              Lead time (days)
              <input
                type="number"
                min="0"
                className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
                value={lead}
                onChange={(event) => setLead(event.target.value)}
              />
            </label>
          </div>

          <Btn
            variant="primary"
            disabled={busy || !code.trim() || !name.trim()}
            onClick={() =>
              void onSubmit({
                code: code.trim(),
                name: name.trim(),
                ...(phone.trim() ? { phone: phone.trim() } : {}),
                ...(email.trim() ? { email: email.trim() } : {}),
                paymentTermsDays: Number(terms),
                leadTimeDays: Number(lead),
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
