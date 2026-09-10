import { BellRing, Clock3, DoorOpen, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/Tabs";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { useCrmApi, useCrmQuery } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";

type ReservationRow = {
  id: string;
  guest_name: string;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: string;
  confirmation_state: string;
  table_codes: string | null;
};
type WaitlistRow = {
  id: string;
  guest_name: string;
  party_size: number;
  status: string;
  estimated_wait_minutes: number;
  joined_at: string;
};
type TableRow = {
  id: string;
  code: string;
  seats: number;
  area: string | null;
  status: string;
  table_session_id: string | null;
};
type RequestRow = {
  id: string;
  table_session_id: string;
  request_type: string;
  status: string;
  note: string | null;
  created_at: string;
};
type HostResponse = {
  businessDate: string;
  reservations: ReservationRow[];
  waitlist: WaitlistRow[];
  tables: TableRow[];
  serviceRequests: RequestRow[];
};

export function HostStation() {
  const { branchId, branchLabel } = useAppContext();
  const { command } = useCrmApi();
  const [businessDate, setBusinessDate] = useState("");
  const path = `/api/seramet/guest-admin/host?branchId=${encodeURIComponent(branchId)}${businessDate ? `&businessDate=${businessDate}` : ""}`;
  const query = useCrmQuery<HostResponse>(path);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [walkIn, setWalkIn] = useState({ guestName: "", partySize: 2, tableId: "" });
  const [waitlistTables, setWaitlistTables] = useState<Record<string, string>>({});
  const data = query.data;
  const covers = useMemo(
    () => data?.reservations.reduce((sum, row) => sum + row.party_size, 0) ?? 0,
    [data],
  );
  const availableTables = data?.tables.filter((table) => table.status === "AVAILABLE") ?? [];

  const reservationAction = async (reservationId: string, status: string) => {
    setBusy(reservationId);
    try {
      await command("/api/seramet/guest-admin/reservations/transition", {
        branchId,
        reservationId,
        status,
      });
      setNotice(`Reservation moved to ${status.replaceAll("_", " ").toLowerCase()}.`);
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Reservation could not be updated");
    } finally {
      setBusy("");
    }
  };

  const operationalAction = async (
    area: "waitlist" | "service-requests",
    id: string,
    status: string,
    tableId?: string,
  ) => {
    setBusy(id);
    try {
      await command(`/api/seramet/guest-admin/${area}/transition`, {
        branchId,
        id,
        status,
        ...(tableId ? { tableId } : {}),
      });
      setNotice(`${area === "waitlist" ? "Waitlist" : "Service"} status updated.`);
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Status could not be updated");
    } finally {
      setBusy("");
    }
  };

  const seatWalkIn = async () => {
    if (!walkIn.guestName.trim() || !walkIn.tableId) return;
    setBusy("walk-in");
    try {
      await command("/api/seramet/guest-admin/walk-ins", {
        ...walkIn,
        branchId,
        idempotencyKey: crypto.randomUUID(),
      });
      setWalkIn({ guestName: "", partySize: 2, tableId: "" });
      setNotice("Walk-in seated and table session opened.");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Walk-in could not be seated");
    } finally {
      setBusy("");
    }
  };

  const closeTable = async (tableSessionId: string) => {
    setBusy(tableSessionId);
    try {
      await command("/api/seramet/guest-admin/tables/close", {
        branchId,
        tableSessionId,
        reason: "Host closed completed table service",
      });
      setNotice("Table session closed.");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Table could not be closed");
    } finally {
      setBusy("");
    }
  };

  return (
    <AppShell
      title="Host station"
      subtitle={`Reservations, seating, waitlist and guest requests - ${branchLabel}`}
      actions={<Btn onClick={() => query.refresh()}>Refresh</Btn>}
    >
      {notice && (
        <div
          role="status"
          className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px] font-medium"
        >
          {notice}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Bookings"
          value={data?.reservations.length ?? 0}
          note={data?.businessDate ?? "Loading"}
        />
        <Metric label="Covers" value={covers} note="Reserved and seated" />
        <Metric label="Waitlist" value={data?.waitlist.length ?? 0} note="Needs host attention" />
        <Metric
          label="Open requests"
          value={data?.serviceRequests.length ?? 0}
          note="Guest service"
        />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Panel>
          <PanelHead
            title="Arrivals"
            sub="Authoritative reservations and table assignments"
            right={
              <input
                type="date"
                value={businessDate || data?.businessDate || ""}
                onChange={(event) => setBusinessDate(event.target.value)}
                className="h-8 rounded-md border border-border bg-card px-2 text-[12px]"
                aria-label="Business date"
              />
            }
          />
          {query.status === "error" && <p className="p-4 text-sm text-danger">{query.error}</p>}
          <DataTable
            cols={["Time", "Guest", { l: "Party", r: true }, "Table", "Status", "Action"]}
            mobileCards={
              <div className="grid gap-3">
                {data?.reservations.map((row) => (
                  <ReservationCard
                    key={row.id}
                    row={row}
                    busy={busy === row.id}
                    action={reservationAction}
                  />
                ))}
              </div>
            }
          >
            {data?.reservations.map((row) => (
              <tr key={row.id}>
                <TD className="num font-semibold">{time(row.starts_at)}</TD>
                <TD>
                  <div className="font-semibold">{row.guest_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {row.confirmation_state.replaceAll("_", " ")}
                  </div>
                </TD>
                <TD className="num text-right">{row.party_size}</TD>
                <TD>{row.table_codes ?? "Unassigned"}</TD>
                <TD>
                  <Status>{row.status}</Status>
                </TD>
                <TD>
                  <ReservationActions row={row} busy={busy === row.id} action={reservationAction} />
                </TD>
              </tr>
            ))}
          </DataTable>
          {!data?.reservations.length && query.status !== "loading" && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No reservations for this business date.
            </p>
          )}
        </Panel>
        <div className="grid gap-4 self-start">
          <Panel>
            <PanelHead title="Seat walk-in" sub="Starts a normal table session" />
            <div className="grid gap-3 p-4">
              <label className="text-[12px] font-semibold">
                Guest name
                <input
                  value={walkIn.guestName}
                  onChange={(event) =>
                    setWalkIn((current) => ({ ...current, guestName: event.target.value }))
                  }
                  maxLength={120}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3"
                />
              </label>
              <label className="text-[12px] font-semibold">
                Party size
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={walkIn.partySize}
                  onChange={(event) =>
                    setWalkIn((current) => ({ ...current, partySize: Number(event.target.value) }))
                  }
                  className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3"
                />
              </label>
              <label className="text-[12px] font-semibold">
                Available table
                <select
                  value={walkIn.tableId}
                  onChange={(event) =>
                    setWalkIn((current) => ({ ...current, tableId: event.target.value }))
                  }
                  className="mt-1 h-9 w-full rounded-md border border-border bg-card px-3"
                >
                  <option value="">Choose table</option>
                  {availableTables
                    .filter((table) => table.seats >= walkIn.partySize)
                    .map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.code} · {table.seats} seats
                      </option>
                    ))}
                </select>
              </label>
              <Btn
                variant="primary"
                onClick={seatWalkIn}
                disabled={busy !== "" || !walkIn.guestName.trim() || !walkIn.tableId}
              >
                <DoorOpen className="h-4 w-4" />
                Seat party
              </Btn>
            </div>
          </Panel>
          <Panel>
            <PanelHead title="Table status" sub={`${availableTables.length} available`} />
            <div className="grid grid-cols-2 gap-2 p-4">
              {data?.tables.map((table) => (
                <div key={table.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[13px]">{table.code}</strong>
                    <Status>{table.status}</Status>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {table.area ?? "Dining"} · {table.seats} seats
                  </p>
                  {table.table_session_id && (
                    <Btn
                      className="mt-2 w-full"
                      disabled={busy === table.table_session_id}
                      onClick={() => closeTable(table.table_session_id!)}
                    >
                      Close
                    </Btn>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Waitlist" sub="Deterministic operational estimates" />
          <div className="divide-y divide-border">
            {data?.waitlist.map((row) => (
              <div key={row.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_150px_auto]">
                <div>
                  <div className="text-[13px] font-semibold">
                    {row.guest_name} · {row.party_size}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Joined {time(row.joined_at)} · estimated {row.estimated_wait_minutes} min
                  </div>
                </div>
                <select
                  aria-label={`Table for ${row.guest_name}`}
                  value={waitlistTables[row.id] ?? ""}
                  onChange={(event) =>
                    setWaitlistTables((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                  className="h-9 rounded-md border border-border bg-card px-2 text-[12px]"
                >
                  <option value="">Choose table</option>
                  {availableTables
                    .filter((table) => table.seats >= row.party_size)
                    .map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.code} · {table.seats}
                      </option>
                    ))}
                </select>
                <div className="flex gap-1">
                  <Btn
                    disabled={busy === row.id}
                    onClick={() => operationalAction("waitlist", row.id, "NOTIFIED")}
                  >
                    Notify
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={busy === row.id || !waitlistTables[row.id]}
                    onClick={() =>
                      operationalAction("waitlist", row.id, "SEATED", waitlistTables[row.id])
                    }
                  >
                    Seat
                  </Btn>
                </div>
              </div>
            ))}
            {!data?.waitlist.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">Waitlist is clear.</p>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Guest requests" sub="QR table service actions" />
          <div className="divide-y divide-border">
            {data?.serviceRequests.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <BellRing className="h-4 w-4" />
                    {row.request_type.replaceAll("_", " ")}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {time(row.created_at)}
                    {row.note ? ` · ${row.note}` : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Btn
                    disabled={busy === row.id}
                    onClick={() => operationalAction("service-requests", row.id, "ACKNOWLEDGED")}
                  >
                    Acknowledge
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={busy === row.id}
                    onClick={() => operationalAction("service-requests", row.id, "COMPLETED")}
                  >
                    Complete
                  </Btn>
                </div>
              </div>
            ))}
            {!data?.serviceRequests.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No guest requests need attention.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function ReservationActions({
  row,
  busy,
  action,
}: {
  row: ReservationRow;
  busy: boolean;
  action: (id: string, status: string) => Promise<void>;
}) {
  if (row.status === "PENDING")
    return (
      <Btn disabled={busy} onClick={() => action(row.id, "CONFIRMED")}>
        Confirm
      </Btn>
    );
  if (row.status === "CONFIRMED")
    return (
      <div className="flex gap-1">
        <Btn variant="primary" disabled={busy} onClick={() => action(row.id, "SEATED")}>
          Seat
        </Btn>
        <Btn disabled={busy} onClick={() => action(row.id, "NO_SHOW")}>
          No-show
        </Btn>
      </div>
    );
  if (row.status === "SEATED")
    return (
      <Btn disabled={busy} onClick={() => action(row.id, "COMPLETED")}>
        Complete
      </Btn>
    );
  return null;
}

function ReservationCard({
  row,
  busy,
  action,
}: {
  row: ReservationRow;
  busy: boolean;
  action: (id: string, status: string) => Promise<void>;
}) {
  return (
    <article className="rounded-md border border-border bg-card p-4">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{row.guest_name}</h3>
          <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            {time(row.starts_at)} · <Users className="ml-1 h-3.5 w-3.5" />
            {row.party_size}
          </p>
        </div>
        <Status>{row.status}</Status>
      </div>
      <p className="mt-3 text-[12px]">Table {row.table_codes ?? "unassigned"}</p>
      <div className="mt-3">
        <ReservationActions row={row} busy={busy} action={action} />
      </div>
    </article>
  );
}

function time(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}
