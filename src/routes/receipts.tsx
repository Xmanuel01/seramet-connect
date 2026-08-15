import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";

export const Route = createFileRoute("/receipts")({
  head: () => ({
    meta: [
      { title: "Receipts - Seramet" },
      {
        name: "description",
        content:
          "Every receipt issued across tills and branches, with reprint and delivery options.",
      },
      { property: "og:title", content: "Receipts - Seramet" },
      {
        property: "og:description",
        content: "Till receipts with reprint, WhatsApp and email delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Receipts,
});

function Receipts() {
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const { branch, branchLabel } = useAppContext();
  const { state, apply } = useTransactionEngine();
  const rows = state.receipts
    .filter((receipt) => branch === "All Branches" || receipt.branch === branch)
    .filter((receipt) => !periodDate || receipt.issuedAt.slice(0, 10) === periodDate);
  const value = rows.reduce((sum, receipt) => sum + receipt.paidAmount, 0);
  const reprints = rows.reduce((sum, receipt) => sum + receipt.reprints.length, 0);

  const printReceipt = (receiptId: string) => {
    window.dispatchEvent(
      new CustomEvent("seramet:workflow-action", {
        detail: { label: `Print receipt ${receiptId}` },
      }),
    );
  };

  const sendWhatsApp = (receiptId: string) => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(`Mona Swahili receipt ${receiptId} is ready.`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const sendEmail = (receiptId: string) => {
    window.location.href = `mailto:?subject=${encodeURIComponent(`Receipt ${receiptId}`)}&body=${encodeURIComponent(`Mona Swahili receipt ${receiptId} is ready.`)}`;
  };

  const reprintFirst = () => {
    const receipt = rows[0];
    if (!receipt) return;
    apply((current) => ({
      ...current,
      receipts: current.receipts.map((item) =>
        item.id === receipt.id
          ? {
              ...item,
              reprints: [
                {
                  requestedBy: "Amina W.",
                  reason: "Customer requested duplicate copy",
                  timestamp: "2026-08-14T12:58:00+03:00",
                },
                ...item.reprints,
              ],
            }
          : item,
      ),
      auditEvents: [
        {
          id: `AUD-${String(current.auditEvents.length + 1).padStart(5, "0")}`,
          time: "2026-08-14T12:58:00+03:00",
          actor: "Amina W.",
          role: "Cashier",
          branch: receipt.branch,
          module: "Receipts",
          action: "Reprinted receipt",
          record: receipt.id,
          before: `${receipt.reprints.length} reprints`,
          after: `${receipt.reprints.length + 1} reprints`,
        },
        ...current.auditEvents,
      ],
    }));
  };

  return (
    <AppShell
      title="Receipts"
      subtitle={`Immutable issued receipt register - ${branchLabel}`}
      actions={
        <>
          <Btn>Export</Btn>
          <Btn variant="primary" onClick={reprintFirst}>
            Reprint with reason
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Receipts" value={rows.length} delta={4.1} />
        <Metric label="Value" value={value} money delta={8.4} />
        <Metric label="Reprints" value={reprints} note="requires reason" />
        <Metric label="Digital delivery" value="Ready" note="WhatsApp + email" />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Receipt register"
          sub="Immutable log - receipts are created only after confirmed payment"
          right={<SearchInput placeholder="Search receipt or order..." />}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips
            items={[
              {
                label: "Period",
                value: formatFilterDate(periodDate),
                dateValue: periodDate,
                onDateChange: setPeriodDate,
                onClear: () => setPeriodDate(""),
              },
              { label: "Scope", value: branchLabel },
              { label: "Payment", value: "All" },
              { label: "Retention", value: "Permanent" },
            ]}
            onClear={() => setPeriodDate("")}
          />
        </div>
        <DataTable
          cols={[
            "Receipt",
            "Order",
            "Invoice",
            "Issued",
            "Cashier",
            { l: "Amount", r: true },
            "Method",
            "Status",
            "Send",
          ]}
        >
          {rows.map((receipt) => (
            <tr key={receipt.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{receipt.id}</TD>
              <TD className="num text-muted-foreground">{receipt.orderId}</TD>
              <TD className="num text-muted-foreground">{receipt.invoiceId}</TD>
              <TD className="text-muted-foreground">{receipt.issuedAt.slice(11, 16)}</TD>
              <TD>{receipt.cashier}</TD>
              <TD className="num text-right font-semibold">{ksh(receipt.paidAmount)}</TD>
              <TD>
                {receipt.paymentBreakdown
                  .map((payment) => payment.method.replaceAll("_", " "))
                  .join(" + ")}
              </TD>
              <TD>
                <Status>{receipt.reprints.length ? "Reprinted" : "Paid"}</Status>
              </TD>
              <TD>
                <div className="flex gap-1.5 text-[12px] font-semibold text-primary">
                  <button onClick={() => printReceipt(receipt.id)}>Print</button>
                  <button onClick={() => sendWhatsApp(receipt.id)}>WhatsApp</button>
                  <button onClick={() => sendEmail(receipt.id)}>Email</button>
                </div>
              </TD>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <TD className="text-muted-foreground" colSpan={9}>
                No paid receipts in the selected branch yet.
              </TD>
            </tr>
          )}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
