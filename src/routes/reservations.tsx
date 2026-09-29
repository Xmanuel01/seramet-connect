import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";

export const Route = createFileRoute("/reservations")({
  head: () => ({
    meta: [
      { title: "Reservations - Seramet" },
      {
        name: "description",
        content:
          "Table bookings, guest counts, deposits and seating status across service periods.",
      },
      { property: "og:title", content: "Reservations - Seramet" },
      {
        property: "og:description",
        content: "Bookings, deposits and seating status by service period.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reservations,
});

const initialRows = [
  {
    date: "2026-08-13",
    time: "12:30",
    name: "Mercy Wambui",
    guests: 6,
    table: "05",
    area: "Main Dining",
    phone: "0722 118 402",
    deposit: "KSh 2,000",
    status: "Reserved",
  },
  {
    date: "2026-08-13",
    time: "13:00",
    name: "Riverside Events",
    guests: 8,
    table: "11",
    area: "Private Room",
    phone: "0733 902 118",
    deposit: "KSh 5,000",
    status: "Reserved",
  },
  {
    date: "2026-08-13",
    time: "13:30",
    name: "Daniel Kiptoo",
    guests: 2,
    table: "01",
    area: "Main Dining",
    phone: "0710 448 220",
    deposit: "-",
    status: "Pending",
  },
  {
    date: "2026-08-14",
    time: "19:00",
    name: "Achieng Family",
    guests: 4,
    table: "09",
    area: "Terrace",
    phone: "0745 220 118",
    deposit: "KSh 1,000",
    status: "Reserved",
  },
  {
    date: "2026-08-14",
    time: "19:30",
    name: "Tech Hub Dinner",
    guests: 10,
    table: "11",
    area: "Private Room",
    phone: "0768 400 213",
    deposit: "KSh 8,000",
    status: "Pending",
  },
];

const slots = ["12:00", "13:00", "14:00", "18:00", "19:00", "20:00"];

function Reservations() {
  const [reservationRows, setReservationRows] = useState(initialRows);
  const [statusFilter, setStatusFilter] = useState("All");
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const filteredRows = reservationRows
    .filter((row) => statusFilter === "All" || row.status === statusFilter)
    .filter((row) => !periodDate || row.date === periodDate);
  const seatReservation = (reservation: (typeof initialRows)[number]) => {
    setReservationRows((current) =>
      current.map((row) =>
        row.date === reservation.date &&
        row.time === reservation.time &&
        row.name === reservation.name
          ? { ...row, status: "Seated" }
          : row,
      ),
    );
  };

  return (
    <AppShell
      title="Reservations"
      subtitle={`${formatFilterDate(periodDate)} - Westlands`}
      actions={
        <>
          <Btn>Waitlist</Btn>
          <Btn variant="primary">New reservation</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Bookings today" value={filteredRows.length} delta={8} />
        <Metric
          label="Covers booked"
          value={filteredRows.reduce((sum, row) => sum + row.guests, 0)}
          delta={12}
        />
        <Metric label="Deposits held" value="KSh 16,000" />
        <Metric label="No-show rate" value="4.2" suffix="%" delta={-1.2} invert />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel>
          <PanelHead title="Bookings" sub="Seat guests directly to a table" />
          <div className="border-b border-border px-4 py-3">
            <Chips
              items={[
                { label: "Scope", value: "Westlands Branch" },
                {
                  label: "Period",
                  value: formatFilterDate(periodDate),
                  dateValue: periodDate,
                  onDateChange: setPeriodDate,
                  onClear: () => setPeriodDate(""),
                },
                {
                  label: "Status",
                  value: statusFilter,
                  options: ["All", "Reserved", "Pending", "Seated"],
                  selectedOption: statusFilter,
                  onOptionChange: setStatusFilter,
                  onClear: () => setStatusFilter("All"),
                },
              ]}
              onClear={() => {
                setStatusFilter("All");
                setPeriodDate("");
              }}
            />
          </div>
          <DataTable
            cols={[
              "Date",
              "Time",
              "Guest",
              { l: "Party", r: true },
              "Table",
              "Area",
              "Phone",
              "Deposit",
              "Status",
              "",
            ]}
          >
            {filteredRows.map((r) => (
              <tr key={r.date + r.time + r.name} className="hover:bg-secondary/50">
                <TD className="num text-muted-foreground">{r.date}</TD>
                <TD className="num font-semibold">{r.time}</TD>
                <TD>{r.name}</TD>
                <TD className="num text-right">{r.guests}</TD>
                <TD className="num">{r.table}</TD>
                <TD className="text-muted-foreground">{r.area}</TD>
                <TD className="num text-muted-foreground">{r.phone}</TD>
                <TD className="num">{r.deposit}</TD>
                <TD>
                  <Status>{r.status}</Status>
                </TD>
                <TD>
                  {r.status === "Seated" ? (
                    <Status>Seated</Status>
                  ) : (
                    <button
                      onClick={() => seatReservation(r)}
                      className="text-[12px] font-semibold text-primary"
                    >
                      Seat
                    </button>
                  )}
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead title="Capacity by slot" sub="Covers booked vs 96 seats" />
          <div className="space-y-3 p-4">
            {slots.map((s, i) => {
              const pct = [42, 74, 38, 55, 88, 61][i];
              return (
                <div key={s}>
                  <div className="mb-1 flex items-center justify-between text-[12px]">
                    <span className="num font-semibold">{s}</span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary">
                    <div className="h-2 rounded-full bg-primary" style={{ width: pct + "%" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
