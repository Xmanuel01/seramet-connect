import { createFileRoute } from "@tanstack/react-router";
import { Download, Printer, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { useCrmApi, useCrmQuery } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";

type QrRow = {
  id: string;
  table_id: string;
  table_code: string;
  token_last_four: string;
  version: number;
  mode: string;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
};
type TableRow = { id: string; code: string; seats: number; area: string | null; status: string };
type HostResponse = { tables: TableRow[] };
type IssuedQr = {
  id: string;
  token: string;
  mode: string;
  version: number;
  guestPath: string;
  tableCode: string;
  dataUrl?: string;
};

export const Route = createFileRoute("/qr-management")({ component: QrManagement });

function QrManagement() {
  const { branchId, branchLabel } = useAppContext();
  const { command } = useCrmApi();
  const query = useCrmQuery<{ tokens: QrRow[] }>(
    `/api/seramet/guest-admin/qr?branchId=${encodeURIComponent(branchId)}`,
  );
  const host = useCrmQuery<HostResponse>(
    `/api/seramet/guest-admin/host?branchId=${encodeURIComponent(branchId)}`,
  );
  const [tableId, setTableId] = useState("");
  const [mode, setMode] = useState("ORDERING_ENABLED");
  const [issued, setIssued] = useState<IssuedQr | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tableId && host.data?.tables[0]) setTableId(host.data.tables[0].id);
  }, [host.data, tableId]);

  const rotate = async () => {
    const table = host.data?.tables.find((candidate) => candidate.id === tableId);
    if (!table) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await command<{ qr: Omit<IssuedQr, "tableCode" | "dataUrl"> }>(
        "/api/seramet/guest-admin/qr/rotate",
        { branchId, tableId, mode },
      );
      const absoluteUrl = new URL(response.qr.guestPath, window.location.origin).toString();
      const dataUrl = await QRCode.toDataURL(absoluteUrl, {
        width: 640,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: "#17231f", light: "#ffffff" },
      });
      setIssued({ ...response.qr, tableCode: table.code, dataUrl });
      setNotice("A new QR capability was issued. Any previous code for this table is now revoked.");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "QR could not be generated");
    } finally {
      setBusy(false);
    }
  };

  const disable = async (id: string) => {
    setBusy(true);
    try {
      await command(
        `/api/seramet/guest-admin/qr/${id}?branchId=${encodeURIComponent(branchId)}`,
        undefined,
        "DELETE",
      );
      setNotice("QR disabled. Scans of that code no longer open a guest session.");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "QR could not be disabled");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!issued?.dataUrl) return;
    const link = document.createElement("a");
    link.href = issued.dataUrl;
    link.download = `table-${issued.tableCode}-qr.png`;
    link.click();
  };

  return (
    <AppShell
      title="QR management"
      subtitle={`Secure table menu and ordering codes - ${branchLabel}`}
    >
      {notice && (
        <div
          role="status"
          className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px]"
        >
          {notice}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Panel>
          <PanelHead title="Issue table QR" sub="Rotation immediately revokes the previous code" />
          <div className="grid gap-4 p-4">
            <label className="text-[12px] font-semibold">
              Table
              <select
                value={tableId}
                onChange={(event) => setTableId(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-card px-3"
              >
                <option value="">Choose table</option>
                {host.data?.tables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.code} · {table.area ?? "Dining"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-semibold">
              Mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-border bg-card px-3"
              >
                <option value="MENU_ONLY">Menu only</option>
                <option value="ORDERING_ENABLED">Ordering enabled</option>
                <option value="ORDER_AND_PAY">Order and pay</option>
                <option value="CALL_WAITER_ONLY">Call waiter only</option>
              </select>
            </label>
            <Btn variant="primary" onClick={rotate} disabled={busy || !tableId}>
              <RefreshCw className="h-4 w-4" />
              {busy ? "Issuing" : "Generate or rotate"}
            </Btn>
            <p className="flex gap-2 text-[11px] leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Codes are random, table scoped, hashed at rest, revocable, and never grant staff
              access.
            </p>
          </div>
        </Panel>
        <Panel>
          <PanelHead
            title={issued ? `Table ${issued.tableCode}` : "Printable table card"}
            sub="The raw QR capability is shown only when issued"
            right={
              issued && (
                <div className="flex gap-1">
                  <Btn onClick={download}>
                    <Download className="h-4 w-4" />
                    Download
                  </Btn>
                  <Btn onClick={() => window.print()}>
                    <Printer className="h-4 w-4" />
                    Print
                  </Btn>
                </div>
              )
            }
          />
          <div className="flex min-h-[360px] items-center justify-center p-6">
            {issued?.dataUrl ? (
              <div className="text-center print:fixed print:inset-0 print:flex print:items-center print:justify-center">
                <p className="text-2xl font-bold">Scan to view the menu</p>
                <img
                  src={issued.dataUrl}
                  alt={`Table ${issued.tableCode} QR code`}
                  className="mx-auto mt-4 h-64 w-64"
                />
                <p className="mt-3 text-lg font-bold">Table {issued.tableCode}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {issued.mode.replaceAll("_", " ")}
                </p>
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                <QrCode className="mx-auto h-10 w-10" />
                <p className="mt-3 text-sm">Select a table and issue a code to preview it.</p>
              </div>
            )}
          </div>
        </Panel>
      </div>
      <Panel className="mt-4">
        <PanelHead title="QR history" sub="Capability status without exposing raw tokens" />
        <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
          {query.data?.tokens.map((row) => (
            <article key={row.id} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[13px] font-semibold">Table {row.table_code}</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Version {row.version} · ending {row.token_last_four}
                  </p>
                </div>
                <Status>{row.status}</Status>
              </div>
              <p className="mt-3 text-[11px]">{row.mode.replaceAll("_", " ")}</p>
              {row.status === "ACTIVE" && (
                <Btn
                  className="mt-3 w-full"
                  variant="danger"
                  disabled={busy}
                  onClick={() => disable(row.id)}
                >
                  Disable
                </Btn>
              )}
            </article>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
