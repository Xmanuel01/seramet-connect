import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRightLeft, Copy, GripVertical, Minus, Plus } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { employees } from "@/data/mock";
import { useBranchRows } from "@/lib/app-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/schedule")({
  head: () => ({
    meta: [
      { title: "Schedule - Seramet" },
      {
        name: "description",
        content: "Weekly shift scheduling, coverage, conflicts and overtime.",
      },
      { property: "og:title", content: "Schedule - Seramet" },
      {
        property: "og:description",
        content: "Weekly scheduling with conflicts, gaps and overtime visibility.",
      },
    ],
  }),
  component: Schedule,
});

type ShiftCode = "OFF" | "07:00-16:00" | "09:30-21:30" | "12:00-21:30" | "16:00-23:00";
type ShiftMap = Record<string, ShiftCode>;

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const shiftOptions: ShiftCode[] = [
  "OFF",
  "07:00-16:00",
  "09:30-21:30",
  "12:00-21:30",
  "16:00-23:00",
];
const shiftFor = (employeeIndex: number, dayIndex: number): ShiftCode =>
  (employeeIndex + dayIndex) % 4 === 0
    ? "OFF"
    : (employeeIndex + dayIndex) % 3 === 0
      ? "12:00-21:30"
      : "09:30-21:30";

const cellKey = (employee: string, day: string) => `${employee}|${day}`;

function Schedule() {
  const branchEmployees = useBranchRows(employees);
  const roster = branchEmployees.length > 0 ? branchEmployees : employees;
  const [shifts, setShifts] = useState<ShiftMap>(() =>
    Object.fromEntries(
      employees.flatMap((employee, employeeIndex) =>
        days.map((day, dayIndex) => [
          cellKey(employee.name, day),
          shiftFor(employeeIndex, dayIndex),
        ]),
      ),
    ),
  );
  const [selected, setSelected] = useState(cellKey(roster[0]?.name ?? employees[0].name, "Mon"));
  const [dragging, setDragging] = useState<string | null>(null);
  const [moveSource, setMoveSource] = useState<string | null>(null);

  const selectedParts = selected.split("|");
  const selectedEmployee = selectedParts[0] ?? "";
  const selectedDay = selectedParts[1] ?? "";
  const selectedShift = shifts[selected] ?? "OFF";

  const stats = useMemo(() => {
    const visibleKeys = roster.flatMap((employee) =>
      days.map((day) => cellKey(employee.name, day)),
    );
    const scheduled = visibleKeys.filter((key) => shifts[key] !== "OFF").length;
    const gaps = days.filter((day) =>
      roster.every((employee) => shifts[cellKey(employee.name, day)] === "OFF"),
    ).length;
    const conflicts = roster.filter(
      (employee) => days.filter((day) => shifts[cellKey(employee.name, day)] !== "OFF").length > 6,
    ).length;
    const overtime =
      roster.reduce(
        (hours, employee) =>
          hours +
          days.reduce((sum, day) => sum + shiftHours(shifts[cellKey(employee.name, day)]), 0),
        0,
      ) -
      roster.length * 45;
    return { scheduled, gaps, conflicts, overtime: Math.max(0, Math.round(overtime)) };
  }, [roster, shifts]);

  const updateShift = (key: string, shift: ShiftCode) => {
    setShifts((current) => ({ ...current, [key]: shift }));
    setSelected(key);
  };

  const moveShift = (from: string, to: string) => {
    if (from === to) return;
    setShifts((current) => {
      const next = { ...current };
      next[to] = current[from] ?? "OFF";
      next[from] = "OFF";
      return next;
    });
    setSelected(to);
    setMoveSource(null);
  };

  const handleCellClick = (key: string) => {
    if (moveSource && moveSource !== key) {
      moveShift(moveSource, key);
      return;
    }
    setSelected(key);
  };

  const resizeSelected = (delta: number) => {
    const index = shiftOptions.indexOf(selectedShift);
    const next = shiftOptions[Math.min(shiftOptions.length - 1, Math.max(0, index + delta))];
    updateShift(selected, next);
  };

  const duplicateDay = (fromDay: string, toDay: string) => {
    setShifts((current) => {
      const next = { ...current };
      roster.forEach((employee) => {
        next[cellKey(employee.name, toDay)] = current[cellKey(employee.name, fromDay)] ?? "OFF";
      });
      return next;
    });
  };

  const duplicateWeek = () => {
    setShifts((current) => {
      const next = { ...current };
      roster.forEach((employee, employeeIndex) => {
        days.forEach((day, dayIndex) => {
          next[cellKey(employee.name, day)] = shiftFor(employeeIndex + 1, dayIndex);
        });
      });
      return next;
    });
  };

  const publishReady = stats.gaps === 0 && stats.conflicts === 0;

  return (
    <AppShell
      title="Shift schedule"
      subtitle="Week of 10 August - branch-aware coverage, conflicts and overtime"
      actions={
        <>
          <Btn onClick={() => duplicateDay("Mon", "Tue")}>
            <Copy className="h-4 w-4" /> Copy Mon
          </Btn>
          <Btn onClick={duplicateWeek}>Duplicate week</Btn>
          <Btn variant="primary">{publishReady ? "Publish schedule" : "Resolve gaps"}</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Scheduled shifts" value={stats.scheduled} />
        <Metric label="Coverage gaps" value={stats.gaps} invert delta={stats.gaps ? 100 : -100} />
        <Metric label="Conflicts" value={stats.conflicts} invert />
        <Metric
          label="Projected overtime"
          value={`${stats.overtime}h`}
          invert
          delta={stats.overtime}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHead
            title="Weekly schedule"
            sub="Drag shifts between cells, click a cell to assign, or use copy controls"
            right={<Status>{publishReady ? "Ready" : "Draft"}</Status>}
          />
          <div className="grid gap-3 p-3 md:hidden">
            {roster.map((employee) => (
              <article key={employee.name} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-3">
                  <div className="text-[13px] font-semibold">{employee.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {employee.role} - {employee.branch}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {days.map((day) =>
                    renderShiftButton({
                      day,
                      employeeName: employee.name,
                      keyName: cellKey(employee.name, day),
                      shift: shifts[cellKey(employee.name, day)] ?? "OFF",
                      selected,
                      dragging,
                      moveSource,
                      onClick: handleCellClick,
                      onMoveStart: setMoveSource,
                      onDragStart: setDragging,
                      onDrop: moveShift,
                    }),
                  )}
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr>
                  <TH>Employee</TH>
                  {days.map((day) => (
                    <TH key={day}>{day}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((employee) => (
                  <tr key={employee.name}>
                    <TD className="whitespace-nowrap">
                      <div className="font-semibold">{employee.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {employee.role} - {employee.branch}
                      </div>
                    </TD>
                    {days.map((day) => (
                      <TD key={day}>
                        {renderShiftButton({
                          day,
                          employeeName: employee.name,
                          keyName: cellKey(employee.name, day),
                          shift: shifts[cellKey(employee.name, day)] ?? "OFF",
                          selected,
                          dragging,
                          moveSource,
                          onClick: handleCellClick,
                          onMoveStart: setMoveSource,
                          onDragStart: setDragging,
                          onDrop: moveShift,
                        })}
                      </TD>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="Shift editor"
            sub={`${selectedEmployee} - ${selectedDay}`}
            right={<Status>{selectedShift}</Status>}
          />
          <div className="space-y-4 p-4">
            <div className="grid gap-2">
              {shiftOptions.map((shift) => (
                <button
                  key={shift}
                  onClick={() => updateShift(selected, shift)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-[13px] font-semibold",
                    selectedShift === shift
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border hover:bg-secondary",
                  )}
                >
                  {shift}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => resizeSelected(-1)}>
                <Minus className="h-4 w-4" /> Shorten
              </Btn>
              <Btn onClick={() => resizeSelected(1)}>
                <Plus className="h-4 w-4" /> Extend
              </Btn>
            </div>
            <button
              onClick={() => setMoveSource(moveSource === selected ? null : selected)}
              className={cn(
                "flex w-full items-center justify-between rounded-md border px-3 py-2 text-[13px] font-semibold",
                moveSource === selected
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border hover:bg-secondary",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4" /> Move assignment
              </span>
              <span className="text-[11px] opacity-80">
                {moveSource === selected ? "Pick target" : "Start"}
              </span>
            </button>
            <div className="rounded-lg bg-secondary/60 p-3 text-[12px] text-muted-foreground">
              Drag a shift chip to another cell to move it, or use Move assignment on touch devices.
              All changes update coverage, conflict and overtime metrics immediately.
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function renderShiftButton({
  day,
  employeeName,
  keyName,
  shift,
  selected,
  dragging,
  moveSource,
  onClick,
  onMoveStart,
  onDragStart,
  onDrop,
}: {
  day: string;
  employeeName: string;
  keyName: string;
  shift: ShiftCode;
  selected: string;
  dragging: string | null;
  moveSource: string | null;
  onClick: (key: string) => void;
  onMoveStart: (key: string | null) => void;
  onDragStart: (key: string | null) => void;
  onDrop: (from: string, to: string) => void;
}) {
  const off = shift === "OFF";
  const overtime = !off && shiftHours(shift) > 10;
  return (
    <button
      key={keyName}
      draggable={!off}
      onClick={() => onClick(keyName)}
      onDoubleClick={() => onMoveStart(moveSource === keyName ? null : keyName)}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", keyName);
        onDragStart(keyName);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const from = event.dataTransfer.getData("text/plain") || dragging;
        if (from) onDrop(from, keyName);
        onDragStart(null);
      }}
      onDragEnd={() => onDragStart(null)}
      className={cn(
        "w-full rounded-md px-2 py-1.5 text-left text-[11px] font-semibold transition-colors",
        off
          ? "bg-secondary text-muted-foreground"
          : overtime
            ? "bg-warning-soft text-warning"
            : "bg-accent text-accent-foreground",
        selected === keyName && "ring-2 ring-primary/40",
        moveSource === keyName && "border border-primary",
      )}
      title={`${employeeName} ${day}`}
    >
      <span className="flex items-center gap-1">
        {!off && <GripVertical className="h-3 w-3 shrink-0 opacity-60" />}
        <span className="min-w-0 truncate">
          {day} {shift}
        </span>
      </span>
      {overtime && <div className="text-[10px] font-medium">Overtime</div>}
    </button>
  );
}

function shiftHours(shift?: ShiftCode) {
  if (!shift || shift === "OFF") return 0;
  const [start, end] = shift.split("-");
  return toHours(end) - toHours(start);
}

function toHours(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours + minutes / 60;
}
