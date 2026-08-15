import { createFileRoute } from "@tanstack/react-router";
import { Building2, FileText, Phone, Star } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { DataTable, Tabs, Timeline } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/suppliers")({
  head: () => ({
    meta: [
      { title: "Supplier 360 - Seramet" },
      {
        name: "description",
        content: "Supplier profile, spend, performance, products, invoices and documents.",
      },
      { property: "og:title", content: "Supplier 360 - Seramet" },
      {
        property: "og:description",
        content: "Supplier spend, quality, delivery and payables in one view.",
      },
    ],
  }),
  component: Suppliers,
});

const products = [
  { item: "Beef Boneless", sku: "MEAT-001", last: 620, change: "+12%", status: "Attention" },
  { item: "Chicken Whole", sku: "MEAT-004", last: 480, change: "+4%", status: "Healthy" },
  { item: "Goat Meat", sku: "MEAT-009", last: 720, change: "0%", status: "Healthy" },
  { item: "Mince Beef", sku: "MEAT-010", last: 590, change: "+6%", status: "Low" },
];

const history = [
  { doc: "PO-2026-0182", date: "13 Aug", branch: "Westlands", value: 58400, state: "Pending" },
  { doc: "BILL-MMS-2291", date: "10 Aug", branch: "Westlands", value: 128400, state: "Partial" },
  { doc: "GRN-0912", date: "12 Aug", branch: "Ngong Road", value: 73400, state: "Completed" },
];

type SupplierRow = (typeof products)[number] | (typeof history)[number];

function Suppliers() {
  return (
    <AppShell
      title="Main Meat Supplier"
      subtitle="Active supplier - contact: Grace Njeri - payment terms: Net 14 - preferred meat partner"
      actions={
        <>
          <Btn>Message</Btn>
          <Btn>Request quote</Btn>
          <Btn variant="primary">New purchase order</Btn>
        </>
      }
    >
      <Panel className="mb-4 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-accent-foreground">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[18px] font-bold">Main Meat Supplier</h2>
                <Status>Attention</Status>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> +254 711 204 660
                </span>
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3.5 w-3.5" /> 4.2 rating
                </span>
                <span>Main contact: Grace Njeri</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-secondary/60 px-3 py-2">
              <div className="num text-[15px] font-bold">88%</div>
              <div className="text-[11px] text-muted-foreground">On-time</div>
            </div>
            <div className="rounded-lg bg-secondary/60 px-3 py-2">
              <div className="num text-[15px] font-bold">3</div>
              <div className="text-[11px] text-muted-foreground">Quality issues</div>
            </div>
            <div className="rounded-lg bg-secondary/60 px-3 py-2">
              <div className="num text-[15px] font-bold">Net 14</div>
              <div className="text-[11px] text-muted-foreground">Terms</div>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="90 day spend" value={842000} money delta={11.4} />
        <Metric label="Outstanding" value={68400} money delta={8.1} invert />
        <Metric label="Open POs" value={2} />
        <Metric label="Price changes" value={2} delta={100} invert />
      </div>

      <div className="mt-4">
        <Tabs
          tabs={["Overview", "Products", "Purchase history", "Invoices", "Payments", "Documents"]}
        >
          {(tab) => (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Panel>
                <PanelHead
                  title={tab === "Overview" ? "Products supplied" : tab}
                  sub="Performance-linked supplier records"
                />
                <DataTable
                  cols={["Record", "Reference", "Branch", { l: "Value", r: true }, "Status"]}
                  mobileCards={(tab === "Products" || tab === "Overview" ? products : history).map(
                    (row: SupplierRow) => (
                      <article
                        key={row.item ?? row.doc}
                        className="rounded-lg border border-border bg-card p-3 shadow-card"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-bold">
                              {row.item ?? row.doc}
                            </div>
                            <div className="num text-[12px] text-muted-foreground">
                              {row.sku ?? row.date}
                            </div>
                          </div>
                          <Status>{row.status ?? row.state}</Status>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                          <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                            <span className="text-muted-foreground">Branch </span>
                            <span className="font-semibold">{row.change ?? row.branch}</span>
                          </div>
                          <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                            <span className="text-muted-foreground">Value </span>
                            <span className="num font-semibold">{ksh(row.last ?? row.value)}</span>
                          </div>
                        </div>
                      </article>
                    ),
                  )}
                >
                  {(tab === "Products" || tab === "Overview" ? products : history).map(
                    (row: SupplierRow) => (
                      <tr key={row.item ?? row.doc} className="hover:bg-secondary/50">
                        <TD className="font-semibold">{row.item ?? row.doc}</TD>
                        <TD className="num text-muted-foreground">{row.sku ?? row.date}</TD>
                        <TD className="text-muted-foreground">{row.change ?? row.branch}</TD>
                        <TD className="num text-right font-semibold">
                          {ksh(row.last ?? row.value)}
                        </TD>
                        <TD>
                          <Status>{row.status ?? row.state}</Status>
                        </TD>
                      </tr>
                    ),
                  )}
                </DataTable>
              </Panel>
              <Panel>
                <PanelHead title="Activity" sub="Approval and document timeline" />
                <Timeline
                  items={[
                    ["Price increase flagged", "Beef Boneless moved from KSh 554 to KSh 620."],
                    ["Bill partially paid", "KSh 60,000 posted against BILL-MMS-2291."],
                    [
                      "Quality note added",
                      "Kitchen reported excess fat trimming on last delivery.",
                    ],
                  ]}
                />
                <div className="border-t border-border p-3">
                  <Btn className="w-full">
                    <FileText className="h-4 w-4" /> Open supplier file
                  </Btn>
                </div>
              </Panel>
            </div>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
