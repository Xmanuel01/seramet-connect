import { BellRing, CalendarDays, Clock3, DoorOpen, RefreshCcw, Users, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/Tabs";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { useCrmApi, useCrmQuery } from "@/crm/use-crm";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { cn } from "@/lib/utils";
import { TableManagement } from "@/guest/table-management";

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

const views = [
  { to: "/tables", label: "Tables", icon: Table2, permission: permissions.tableManage },
  {
    to: "/reservations",
    label: "Reservations",
    icon: CalendarDays,
    permission: permissions.reservationView,
  },
  { to: "/host", label: "Seating", icon: DoorOpen, permission: permissions.tableManage },
  { to: "/waitlist", label: "Waiting List", icon: Clock3, permission: permissions.waitlistView },
  {
    to: "/guest-service",
    label: "Guest requests",
    icon: BellRing,
    permission: permissions.guestServiceManage,
  },
] as const;

/** The legacy URLs remain valid bookmarks, but share a single backend-backed workspace. */
export function HostStation({ view: pathname }: { view: (typeof views)[number]["to"] }) {
  const { branchId, branchLabel, hasPermission } = useAppContext();
  const { command } = useCrmApi();
  const [businessDate, setBusinessDate] = useState("");
  const path = `/api/seramet/guest-admin/host?branchId=${encodeURIComponent(branchId)}${businessDate ? `&businessDate=${encodeURIComponent(businessDate)}` : ""}`;
  const query = useCrmQuery<HostResponse>(path);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [walkIn, setWalkIn] = useState({ guestName: "", partySize: 2, tableId: "" });
  const [waitlistTables, setWaitlistTables] = useState<Record<string, string>>({});
  const data = query.data;
  const canViewReservations = hasPermission(permissions.reservationView);
  const canViewWaitlist = hasPermission(permissions.waitlistView);
  const canManageWaitlist = hasPermission(permissions.waitlistManage);
  const canManageTables = hasPermission(permissions.tableManage);
  const canSeat = hasPermission(permissions.reservationSeat);
  const canManageRequests = hasPermission(permissions.guestServiceManage);
  const canSeeSeating = canManageTables || canSeat || canViewReservations;
  const visibleViews = views.filter((view) =>
    view.to === "/host" ? canSeeSeating : hasPermission(view.permission),
  );
  const currentView = visibleViews.find((view) => view.to === pathname) ?? visibleViews[0];
  const covers = useMemo(
    () => data?.reservations.reduce((sum, row) => sum + row.party_size, 0) ?? 0,
    [data],
  );
  const availableTables = data?.tables.filter((table) => table.status === "AVAILABLE") ?? [];
  const pendingRequests = data?.serviceRequests.filter((row) => row.status !== "COMPLETED") ?? [];

  const reservationAction = async (reservationId: string, status: string) => {
    if (status === "SEATED" && !canSeat) return;
    if (status !== "SEATED" && !hasPermission(permissions.reservationModify)) return;
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
      setNotice(cause instanceof Error ? cause.message : "Reservation could not be updated.");
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
    if (area === "waitlist" && !canManageWaitlist) return;
    if (area === "service-requests" && !canManageRequests) return;
    setBusy(id);
    try {
      await command(`/api/seramet/guest-admin/${area}/transition`, {
        branchId,
        id,
        status,
        ...(tableId ? { tableId } : {}),
      });
      setNotice(`${area === "waitlist" ? "Waitlist" : "Guest request"} updated.`);
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Status could not be updated.");
    } finally {
      setBusy("");
    }
  };

  const seatWalkIn = async () => {
    if (!canSeat || !walkIn.guestName.trim() || !walkIn.tableId) return;
    if (!Number.isInteger(walkIn.partySize) || walkIn.partySize < 1) return;
    const chosen = availableTables.find((table) => table.id === walkIn.tableId);
    if (!chosen || chosen.seats < walkIn.partySize) {
      setNotice("Choose an available table with enough seats for the party.");
      return;
    }
    setBusy("walk-in");
    try {
      await command("/api/seramet/guest-admin/walk-ins", {
        ...walkIn,
        guestName: walkIn.guestName.trim(),
        branchId,
        idempotencyKey: crypto.randomUUID(),
      });
      setWalkIn({ guestName: "", partySize: 2, tableId: "" });
      setNotice("Walk-in seated and table session opened.");
      await query.refresh();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Walk-in could not be seated.");
    } finally {
      setBusy("");
    }
  };

  const closeTable = async (tableSessionId: string) => {
    if (!canManageTables) return;
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
      setNotice(cause instanceof Error ? cause.message : "Table could not be closed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <AppShell
      title="Front of House"
      subtitle={`Tables, reservations, seating, waiting list and guest requests - ${branchLabel}`}
      actions={
        <Btn onClick={() => void query.refresh()} disabled={query.status === "loading"}>
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Btn>
      }
    >
      {notice && (
        <div
          role="status"
          className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px] font-medium"
        >
          {notice}
        </div>
      )}
      {query.status === "error" && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
        >
          {query.error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric
          label="Bookings"
          value={canViewReservations && data ? data.reservations.length : "—"}
          note={data?.businessDate ?? "Loading"}
        />
        <Metric
          label="Reserved covers"
          value={canViewReservations && data ? covers : "—"}
          note="Reservation party sizes"
        />
        <Metric
          label="Waiting parties"
          value={canViewWaitlist && data ? data.waitlist.length : "—"}
          note="Waitlist"
        />
        <Metric
          label="Open requests"
          value={canManageRequests && data ? pendingRequests.length : "—"}
          note="Guest service"
        />
      </div>

      <nav
        aria-label="Front of House sections"
        className="mt-4 flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {visibleViews.map((view) => {
          const Icon = view.icon;
          const selected = currentView?.to === view.to;
          return (
            <Link
              key={view.to}
              to={view.to}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition-colors",
                selected
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" /> {view.label}
            </Link>
          );
        })}
      </nav>

      {!currentView && (
        <p className="mt-4 rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
          You do not have permission to view any Front of House sections.
        </p>
      )}

      {currentView?.to === "/tables" && (
        <TableManagement
          key={branchId}
          statuses={data?.tables}
          onChanged={() => void query.refresh()}
        />
      )}

      {currentView?.to === "/reservations" && (
        <Panel className="mt-4">
          <PanelHead
            title="Reservations & arrivals"
            sub="Confirm bookings, track arrivals and manage reservation status"
            right={
              <input
                type="date"
                value={businessDate || data?.businessDate || ""}
                onChange={(event) => setBusinessDate(event.target.value)}
                className="h-8 rounded-md border border-border bg-card px-2 text-[12px]"
                aria-label="Reservation business date"
              />
            }
          />
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
                    canSeat={canSeat}
                    canModify={hasPermission(permissions.reservationModify)}
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
                  <ReservationActions
                    row={row}
                    busy={busy === row.id}
                    action={reservationAction}
                    canSeat={canSeat}
                    canModify={hasPermission(permissions.reservationModify)}
                  />
                </TD>
              </tr>
            ))}
          </DataTable>
          {!data?.reservations.length && query.status === "ready" && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No reservations for this business date.
            </p>
          )}
        </Panel>
      )}

      {currentView?.to === "/host" && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <Panel>
            <PanelHead
              title="Table status & seating"
              sub={`${availableTables.length} available · live branch table sessions`}
            />
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
              {data?.tables.map((table) => (
                <div key={table.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[13px]">{table.code}</strong>
                    <Status>{table.status}</Status>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {table.area ?? "Dining"} · {table.seats} seats
                  </p>
                  {table.table_session_id && canManageTables && (
                    <Btn
                      className="mt-3 w-full"
                      disabled={busy !== ""}
                      onClick={() => void closeTable(table.table_session_id!)}
                    >
                      Close session
                    </Btn>
                  )}
                </div>
              ))}
              {!data?.tables.length && query.status === "ready" && (
                <p className="col-span-full p-5 text-center text-sm text-muted-foreground">
                  No tables are configured for this branch.
                </p>
              )}
            </div>
          </Panel>
          {canSeat && (
            <Panel>
              <PanelHead title="Seat walk-in" sub="Opens an existing guest table session" />
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
                      setWalkIn((current) => ({
                        ...current,
                        partySize: Number(event.target.value),
                        tableId: "",
                      }))
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
                  onClick={() => void seatWalkIn()}
                  disabled={
                    busy !== "" ||
                    !walkIn.guestName.trim() ||
                    !walkIn.tableId ||
                    !Number.isInteger(walkIn.partySize) ||
                    walkIn.partySize < 1
                  }
                >
                  <DoorOpen className="h-4 w-4" /> Seat party
                </Btn>
              </div>
            </Panel>
          )}
        </div>
      )}

      {currentView?.to === "/waitlist" && (
        <Panel className="mt-4">
          <PanelHead title="Waitlist" sub="Notify guests and assign a suitable available table" />
          <div className="divide-y divide-border">
            {data?.waitlist.map((row) => (
              <div key={row.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    {row.guest_name} · {row.party_size} guests <Status>{row.status}</Status>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Joined {time(row.joined_at)} · estimated {row.estimated_wait_minutes} min
                  </p>
                </div>
                <select
                  aria-label={`Table for ${row.guest_name}`}
                  value={waitlistTables[row.id] ?? ""}
                  disabled={!canManageWaitlist || busy !== ""}
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
                        {table.code} · {table.seats} seats
                      </option>
                    ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    disabled={!canManageWaitlist || busy !== "" || row.status === "NOTIFIED"}
                    onClick={() => void operationalAction("waitlist", row.id, "NOTIFIED")}
                  >
                    Notify
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={!canManageWaitlist || busy !== "" || !waitlistTables[row.id]}
                    onClick={() =>
                      void operationalAction("waitlist", row.id, "SEATED", waitlistTables[row.id])
                    }
                  >
                    Seat
                  </Btn>
                </div>
              </div>
            ))}
            {!data?.waitlist.length && query.status === "ready" && (
              <p className="p-8 text-center text-sm text-muted-foreground">Waitlist is clear.</p>
            )}
          </div>
        </Panel>
      )}

      {currentView?.to === "/guest-service" && (
        <Panel className="mt-4">
          <PanelHead title="Guest requests" sub="Acknowledge and complete table service requests" />
          <div className="divide-y divide-border">
            {data?.serviceRequests.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-semibold">
                    <BellRing className="h-4 w-4" /> {row.request_type.replaceAll("_", " ")}{" "}
                    <Status>{row.status}</Status>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {time(row.created_at)}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    disabled={
                      busy !== "" || row.status === "ACKNOWLEDGED" || row.status === "COMPLETED"
                    }
                    onClick={() =>
                      void operationalAction("service-requests", row.id, "ACKNOWLEDGED")
                    }
                  >
                    Acknowledge
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={busy !== "" || row.status === "COMPLETED"}
                    onClick={() => void operationalAction("service-requests", row.id, "COMPLETED")}
                  >
                    Complete
                  </Btn>
                </div>
              </div>
            ))}
            {!data?.serviceRequests.length && query.status === "ready" && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No guest requests need attention.
              </p>
            )}
          </div>
        </Panel>
      )}
    </AppShell>
  );
}

function ReservationActions({
  row,
  busy,
  action,
  canSeat,
  canModify,
}: {
  row: ReservationRow;
  busy: boolean;
  action: (id: string, status: string) => Promise<void>;
  canSeat: boolean;
  canModify: boolean;
}) {
  if (row.status === "PENDING") {
    return (
      <Btn disabled={busy || !canModify} onClick={() => void action(row.id, "CONFIRMED")}>
        Confirm
      </Btn>
    );
  }
  if (row.status === "CONFIRMED") {
    return (
      <div className="flex flex-wrap gap-1">
        <Btn
          variant="primary"
          disabled={busy || !canSeat}
          onClick={() => void action(row.id, "SEATED")}
        >
          Seat
        </Btn>
        <Btn disabled={busy || !canModify} onClick={() => void action(row.id, "NO_SHOW")}>
          No-show
        </Btn>
      </div>
    );
  }
  if (row.status === "SEATED") {
    return (
      <Btn disabled={busy || !canModify} onClick={() => void action(row.id, "COMPLETED")}>
        Complete
      </Btn>
    );
  }
  return null;
}

function ReservationCard({
  row,
  busy,
  action,
  canSeat,
  canModify,
}: {
  row: ReservationRow;
  busy: boolean;
  action: (id: string, status: string) => Promise<void>;
  canSeat: boolean;
  canModify: boolean;
}) {
  return (
    <article className="rounded-md border border-border bg-card p-4">
      <div className="flex justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{row.guest_name}</h3>
          <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> {time(row.starts_at)} ·{" "}
            <Users className="ml-1 h-3.5 w-3.5" /> {row.party_size}
          </p>
        </div>
        <Status>{row.status}</Status>
      </div>
      <p className="mt-3 text-[12px]">Table {row.table_codes ?? "unassigned"}</p>
      <div className="mt-3">
        <ReservationActions
          row={row}
          busy={busy}
          action={action}
          canSeat={canSeat}
          canModify={canModify}
        />
      </div>
    </article>
  );
}

function time(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}
