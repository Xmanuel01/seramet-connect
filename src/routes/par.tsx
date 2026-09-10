import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine } from "@/lib/transaction-engine";

export const Route = createFileRoute("/par")({
  head: () => ({
    meta: [
      { title: "PAR Levels - Seramet" },
      {
        name: "description",
        content:
          "Minimum, PAR and maximum levels per item with automatic purchase recommendations.",
      },
      { property: "og:title", content: "PAR Levels - Seramet" },
      { property: "og:description", content: "PAR management and suggested order quantities." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Par,
});

function Par() {
  const [notice, setNotice] = useState("");
  const { branch, currentUser } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const rows = TransactionEngine.getInventoryRows(state, branch).map((i) => ({
    ...i,
    suggested: Math.max(0, Math.round(i.par - i.stock)),
  }));
  const orderValue = rows.reduce((s, r) => s + r.suggested * r.averageCost, 0);
  const generate = () => {
    const result = TransactionEngine.generatePurchaseOrders(state, branch, currentUser.name);
    void mutate("generatePurchaseOrders", { branch });
    setNotice(
      result.created.length
        ? `Created ${result.created.join(", ")} by supplier from current PAR shortfalls.`
        : "No additional PO was created because open procurement already covers the shortfalls.",
    );
  };
  return (
    <AppShell
      title="PAR levels"
      subtitle="Replenishment thresholds and purchase recommendations"
      actions={
        <>
          <Btn>Edit PAR</Btn>
          <Btn variant="primary" onClick={generate}>
            Generate purchase recommendation
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Items below PAR" value={rows.filter((r) => r.stock < r.par).length} />
        <Metric label="Critical items" value={rows.filter((r) => r.status === "Critical").length} />
        <Metric label="Suggested order value" value={Math.round(orderValue)} money />
        <Metric label="Stock health" value="Not available" />
      </div>
      {notice && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice} Backend: {backendStatus}.
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead
          title="PAR table"
          sub="Suggested order tops stock back up to PAR"
          right={<Btn>Select all critical</Btn>}
        />
        <DataTable
          cols={[
            "Item",
            "Unit",
            { l: "Current", r: true },
            { l: "PAR", r: true },
            { l: "Suggested order", r: true },
            "Supplier",
            "Status",
          ]}
        >
          {rows.map((r) => (
            <tr key={r.sku} className="hover:bg-secondary/50">
              <TD className="font-semibold">{r.name}</TD>
              <TD className="text-muted-foreground">{r.unit}</TD>
              <TD className="num text-right">{r.stock}</TD>
              <TD className="num text-right">{r.par}</TD>
              <TD className="num text-right font-bold">{r.suggested || "-"}</TD>
              <TD className="text-muted-foreground">{r.supplier}</TD>
              <TD>
                <Status>{r.status}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="text-[13px] text-muted-foreground">
            Recommended purchase value{" "}
            <span className="num text-[16px] font-bold text-foreground">
              {ksh(Math.round(orderValue))}
            </span>
          </div>
          <Btn variant="primary" onClick={generate}>
            Create purchase orders by supplier
          </Btn>
        </div>
      </Panel>
    </AppShell>
  );
}
