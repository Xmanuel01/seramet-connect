import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link2, Pencil, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type ProcurementSupplierItemRow,
  type ProcurementSupplierRow,
  useInventoryControlCentre,
} from "@/inventory/use-inventory-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { formatNumber, ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers - Seramet" },
      {
        name: "description",
        content:
          "Authoritative supplier master data, purchasing terms and supplier-item relationships.",
      },
    ],
  }),
  component: Suppliers,
});

type SupplierView = ProcurementSupplierRow & {
  branchIds: string[];
};

function Suppliers() {
  const { branchLabel, currency } = useAppContext();
  const { persistenceMode, backendStatus } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const suppliers = useMemo<SupplierView[]>(() => {
    const byId = new Map<string, SupplierView>();
    for (const branch of control.data) {
      for (const supplier of branch.procurement.suppliers) {
        const current = byId.get(supplier.id);
        if (!current) {
          byId.set(supplier.id, {
            ...supplier,
            branchIds: [branch.branchId],
          });
          continue;
        }
        if (!current.branchIds.includes(branch.branchId)) {
          current.branchIds.push(branch.branchId);
        }
        current.order_count += Number(supplier.order_count);
        current.ordered_minor += Number(supplier.ordered_minor);
        current.outstanding_minor += Number(supplier.outstanding_minor);
        current.on_time_count += Number(supplier.on_time_count);
        current.received_count += Number(supplier.received_count);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [control.data]);

  const supplierItems = useMemo(() => {
    const byId = new Map<string, ProcurementSupplierItemRow>();
    for (const branch of control.data) {
      for (const row of branch.procurement.supplierItems) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return Array.from(byId.values());
  }, [control.data]);

  const items = useMemo(() => {
    const byId = new Map<string, (typeof control.data)[number]["items"][number]>();
    for (const branch of control.data) {
      for (const item of branch.items) {
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [control.data]);

  const units = useMemo(() => {
    const byId = new Map<string, (typeof control.data)[number]["units"][number]>();
    for (const branch of control.data) {
      for (const unit of branch.units) {
        if (!byId.has(unit.id)) byId.set(unit.id, unit);
      }
    }
    return Array.from(byId.values());
  }, [control.data]);

  useEffect(() => {
    if (selectedId && !suppliers.some((row) => row.id === selectedId)) {
      setSelectedId("");
    }
  }, [selectedId, suppliers]);

  const selected = suppliers.find((row) => row.id === selectedId) ?? suppliers[0];
  const selectedItems = supplierItems.filter((row) => row.supplier_id === selected?.id);
  const outstandingMinor = suppliers.reduce(
    (sum, supplier) => sum + Number(supplier.outstanding_minor),
    0,
  );
  const purchaseOrders = suppliers.reduce((sum, supplier) => sum + Number(supplier.order_count), 0);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Supplier operation failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Suppliers"
      subtitle={`Supplier master, purchasing terms and item relationships - ${branchLabel}`}
      actions={
        <>
          <Link to="/supplier-performance">
            <Btn>Supplier performance</Btn>
          </Link>
          <Btn disabled={!authoritative} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!authoritative || busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New supplier
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Suppliers" value={suppliers.length} />
        <Metric label="Outstanding" value={Math.round(outstandingMinor / 100)} money />
        <Metric label="Purchase orders" value={purchaseOrders} />
        <Metric label="Linked items" value={supplierItems.length} />
      </div>

      {(!authoritative || notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {!authoritative
            ? `Supplier changes require the authoritative server database. Backend: ${backendStatus}.`
            : notice || control.error}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHead title="Supplier directory" sub={`${suppliers.length} active suppliers`} />
          <div className="divide-y divide-border">
            {suppliers.map((supplier) => (
              <button
                key={supplier.id}
                type="button"
                onClick={() => setSelectedId(supplier.id)}
                className={`w-full px-4 py-3 text-left hover:bg-secondary/50 ${
                  selected?.id === supplier.id ? "bg-accent/50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{supplier.name}</span>
                  <Status>Active</Status>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {supplier.code} · {supplier.order_count} PO
                  {Number(supplier.order_count) === 1 ? "" : "s"}
                </div>
                <div className="num mt-1 text-[12px] font-semibold">
                  {ksh(Number(supplier.ordered_minor) / 100)} purchased
                </div>
              </button>
            ))}
            {!suppliers.length && (
              <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                No suppliers have been created yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title={selected?.name ?? "Supplier detail"}
            sub={
              selected
                ? `${selected.code} · ${selected.legal_name || "No legal name recorded"}`
                : "Select or create a supplier"
            }
            right={
              selected ? (
                <div className="flex gap-2">
                  <Btn disabled={!authoritative || busy} onClick={() => setEditOpen(true)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Btn>
                  <Btn disabled={!authoritative || busy} onClick={() => setLinkOpen(true)}>
                    <Link2 className="h-4 w-4" /> Link item
                  </Btn>
                </div>
              ) : undefined
            }
          />

          {selected ? (
            <>
              <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
                <Info label="Phone" value={selected.phone || "Not recorded"} />
                <Info label="Email" value={selected.email || "Not recorded"} />
                <Info label="Payment terms" value={`${Number(selected.payment_terms_days)} days`} />
                <Info label="Lead time" value={`${Number(selected.lead_time_days)} days`} />
                <Info label="Tax number" value={selected.tax_number || "Not recorded"} />
                <Info
                  label="Minimum order"
                  value={
                    Number(selected.minimum_order_minor) > 0
                      ? ksh(Number(selected.minimum_order_minor) / 100)
                      : "Not set"
                  }
                />
                <Info label="On-time receipts" value={onTimeLabel(selected)} />
                <Info
                  label="Branch evidence"
                  value={`${selected.branchIds.length} branch${selected.branchIds.length === 1 ? "" : "es"}`}
                />
              </div>

              {selected.address && (
                <div className="border-b border-border px-4 py-3 text-[12px] text-muted-foreground">
                  <span className="font-semibold text-foreground">Address:</span> {selected.address}
                </div>
              )}

              <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
                <Metric
                  label="Purchase value"
                  value={Math.round(Number(selected.ordered_minor) / 100)}
                  money
                />
                <Metric
                  label="Outstanding"
                  value={Math.round(Number(selected.outstanding_minor) / 100)}
                  money
                  invert={Number(selected.outstanding_minor) > 0}
                />
                <Metric label="Purchase orders" value={Number(selected.order_count)} />
              </div>

              <PanelHead
                title="Supplier items"
                sub="Supplier SKU, purchase unit, contract price and minimum order terms"
              />
              {!selectedItems.length ? (
                <div className="p-8 text-center text-[12px] text-muted-foreground">
                  No inventory items are linked to this supplier yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px]">
                    <thead>
                      <tr>
                        <TH>Item</TH>
                        <TH>Supplier SKU</TH>
                        <TH>Purchase unit</TH>
                        <TH className="text-right">Contract price</TH>
                        <TH className="text-right">Minimum qty</TH>
                        <TH className="text-right">Lead time</TH>
                        <TH>Status</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedItems.map((row) => (
                        <tr key={row.id}>
                          <TD>
                            <div className="font-semibold">{row.item_name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {row.sku ?? "No SKU"}
                            </div>
                          </TD>
                          <TD className="num text-muted-foreground">{row.supplier_sku || "—"}</TD>
                          <TD>{row.purchase_unit_symbol ?? "Unit"}</TD>
                          <TD className="num text-right">
                            {row.contract_price_minor === null
                              ? "—"
                              : ksh(Number(row.contract_price_minor) / 100)}
                          </TD>
                          <TD className="num text-right">
                            {row.minimum_quantity_minor === null
                              ? "—"
                              : formatNumber(Number(row.minimum_quantity_minor) / 1_000_000, {
                                  maximumFractionDigits: 3,
                                })}
                          </TD>
                          <TD className="num text-right">
                            {row.lead_time_days === null ? "—" : `${row.lead_time_days} days`}
                          </TD>
                          <TD>
                            <Status>{row.preferred ? "Preferred" : "Linked"}</Status>
                          </TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center text-[13px] text-muted-foreground">
              Create the supplier master first, then link the inventory items and commercial terms
              used when purchasing from that supplier.
            </div>
          )}
        </Panel>
      </div>

      <CreateSupplierDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        currency={currency}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/suppliers", body),
            "Supplier created.",
          ).then((succeeded) => {
            if (succeeded) setCreateOpen(false);
          })
        }
      />

      <CreateSupplierDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        currency={currency}
        supplier={selected}
        busy={busy}
        onSubmit={(body) =>
          selected
            ? run(
                () =>
                  control.command(
                    `/api/seramet/procurement/suppliers/${encodeURIComponent(selected.id)}/update`,
                    body,
                  ),
                "Supplier details updated.",
              ).then((succeeded) => {
            if (succeeded) setEditOpen(false);
          })
            : Promise.resolve()
        }
      />

      <LinkSupplierItemDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        supplier={selected}
        items={items}
        units={units}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/supplier-items", body),
            "Supplier item terms linked.",
          ).then((succeeded) => {
            if (succeeded) setLinkOpen(false);
          })
        }
      />
    </AppShell>
  );
}

type InventoryItem = ReturnType<typeof useInventoryControlCentre>["data"][number]["items"][number];
type UnitRow = ReturnType<typeof useInventoryControlCentre>["data"][number]["units"][number];

function CreateSupplierDialog({
  open,
  onOpenChange,
  currency,
  supplier,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  supplier?: SupplierView;
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
  const [supplierCurrency, setSupplierCurrency] = useState(currency);
  const [paymentTerms, setPaymentTerms] = useState("0");
  const [leadTime, setLeadTime] = useState("0");
  const [minimumOrder, setMinimumOrder] = useState("0");

  useEffect(() => {
    if (!open) return;
    setCode(supplier?.code ?? "");
    setName(supplier?.name ?? "");
    setLegalName(supplier?.legal_name ?? "");
    setPhone(supplier?.phone ?? "");
    setEmail(supplier?.email ?? "");
    setTaxNumber(supplier?.tax_number ?? "");
    setAddress(supplier?.address ?? "");
    setSupplierCurrency(supplier?.currency || currency);
    setPaymentTerms(String(Number(supplier?.payment_terms_days ?? 0)));
    setLeadTime(String(Number(supplier?.lead_time_days ?? 0)));
    setMinimumOrder(String(Number(supplier?.minimum_order_minor ?? 0) / 100));
  }, [currency, open, supplier]);

  const valid =
    code.trim().length > 0 &&
    name.trim().length > 0 &&
    supplierCurrency.trim().length === 3 &&
    nonNegative(paymentTerms) !== null &&
    nonNegative(leadTime) !== null &&
    nonNegative(minimumOrder) !== null;

  const submit = () => {
    if (!valid) return;
    void onSubmit({
      code: code.trim(),
      name: name.trim(),
      ...(legalName.trim() ? { legalName: legalName.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(taxNumber.trim() ? { taxNumber: taxNumber.trim() } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
      currency: supplierCurrency.trim().toUpperCase(),
      paymentTermsDays: Math.round(Number(paymentTerms)),
      leadTimeDays: Math.round(Number(leadTime)),
      minimumOrderMinor: Math.round(Number(minimumOrder) * 100),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</DialogTitle>
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
          <Field label="Tax number">
            <input
              value={taxNumber}
              onChange={(event) => setTaxNumber(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Currency">
            <input
              value={supplierCurrency}
              onChange={(event) => setSupplierCurrency(event.target.value)}
              maxLength={3}
              className={inputClass}
            />
          </Field>
          <Field label="Payment terms (days)">
            <input
              inputMode="numeric"
              value={paymentTerms}
              onChange={(event) => setPaymentTerms(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Lead time (days)">
            <input
              inputMode="numeric"
              value={leadTime}
              onChange={(event) => setLeadTime(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Minimum order value">
            <input
              inputMode="decimal"
              value={minimumOrder}
              onChange={(event) => setMinimumOrder(event.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <textarea
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className={`${inputClass} min-h-20 py-2`}
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn variant="primary" disabled={!valid || busy} onClick={submit}>
            {supplier ? "Save changes" : "Create supplier"}
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinkSupplierItemDialog({
  open,
  onOpenChange,
  supplier,
  items,
  units,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: SupplierView | undefined;
  items: InventoryItem[];
  units: UnitRow[];
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [itemId, setItemId] = useState("");
  const [supplierSku, setSupplierSku] = useState("");
  const [contractPrice, setContractPrice] = useState("0");
  const [minimumQuantity, setMinimumQuantity] = useState("0");
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [preferred, setPreferred] = useState(false);

  useEffect(() => {
    if (!open) return;
    const first = items.find((item) => item.purchase_unit_id) ?? items[0];
    setItemId((current) => current || first?.id || "");
  }, [items, open]);

  const item = items.find((row) => row.id === itemId) ?? items[0];
  const unit = units.find((row) => row.id === item?.purchase_unit_id);
  const valid =
    Boolean(supplier && item?.purchase_unit_id) &&
    nonNegative(contractPrice) !== null &&
    nonNegative(minimumQuantity) !== null &&
    (leadTimeDays.trim() === "" || nonNegative(leadTimeDays) !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link item to {supplier?.name ?? "supplier"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Inventory item">
            <select
              value={item?.id ?? ""}
              onChange={(event) => setItemId(event.target.value)}
              className={inputClass}
            >
              {items.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <InfoField
            label="Purchase unit"
            value={
              unit?.symbol ?? (item?.purchase_unit_id ? item.purchase_unit_id : "Not configured")
            }
          />
          <Field label="Supplier SKU">
            <input
              value={supplierSku}
              onChange={(event) => setSupplierSku(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Contract unit price">
            <input
              inputMode="decimal"
              value={contractPrice}
              onChange={(event) => setContractPrice(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Minimum purchase quantity">
            <input
              inputMode="decimal"
              value={minimumQuantity}
              onChange={(event) => setMinimumQuantity(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Supplier lead time (days)">
            <input
              inputMode="numeric"
              value={leadTimeDays}
              onChange={(event) => setLeadTimeDays(event.target.value)}
              className={inputClass}
              placeholder="Use supplier default"
            />
          </Field>
        </div>
        {!item?.purchase_unit_id && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
            This inventory item has no purchase unit. Configure its purchase unit before linking it
            to a supplier.
          </div>
        )}
        <label className="flex items-center gap-2 text-[12px] font-semibold">
          <input
            type="checkbox"
            checked={preferred}
            onChange={(event) => setPreferred(event.target.checked)}
          />
          Preferred supplier for this item
        </label>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              void onSubmit({
                supplierId: supplier!.id,
                inventoryItemId: item!.id,
                purchaseUnitId: item!.purchase_unit_id!,
                ...(supplierSku.trim() ? { supplierSku: supplierSku.trim() } : {}),
                contractPriceMinor: Math.round(Number(contractPrice) * 100),
                minimumQuantityMicro: Math.round(Number(minimumQuantity) * 1_000_000),
                ...(leadTimeDays.trim() ? { leadTimeDays: Math.round(Number(leadTimeDays)) } : {}),
                preferred,
              })
            }
          >
            Link item
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

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-[12px] font-semibold">
      <span>{label}</span>
      <div className="flex h-9 items-center rounded-md border border-border bg-secondary/40 px-3">
        {value}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function onTimeLabel(supplier: SupplierView) {
  const received = Number(supplier.received_count);
  if (!received) return "No receipt history";
  const percentage = Math.round((Number(supplier.on_time_count) / received) * 100);
  return `${percentage}% (${supplier.on_time_count}/${received})`;
}

function nonNegative(value: string) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[12px] outline-none focus:border-primary";
