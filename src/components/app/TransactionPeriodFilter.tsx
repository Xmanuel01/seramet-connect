import { useEffect, useState } from "react";
import { useAppContext } from "@/lib/app-context";
import { businessDateForTimestamp, shiftBusinessDate } from "@/lib/business-date";
import {
  calendarDateStart,
  inDateWindow,
  transactionPeriods,
  transactionWindow,
  type TransactionPeriod,
} from "@/lib/transaction-period";

export function useTransactionPeriod() {
  const { branchId, branchRecords, timeZone } = useAppContext();
  const zone = branchRecords.find((branch) => branch.id === branchId)?.timezone ?? timeZone;
  const [now, setNow] = useState(() => new Date());
  const today = businessDateForTimestamp(now, zone);
  const [period, setPeriod] = useState<TransactionPeriod>("Today");
  const [custom, setCustom] = useState({ from: today, to: today });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      setNow(new Date());
      const day = businessDateForTimestamp(new Date(), zone);
      const midnight = Date.parse(calendarDateStart(shiftBusinessDate(day, 1), zone));
      timer = setTimeout(refresh, Math.min(2_147_483_647, Math.max(1, midnight - Date.now())));
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [zone]);
  const range = transactionWindow(period, today, custom);
  return {
    period,
    setPeriod,
    custom,
    setCustom,
    range,
    matches: (timestamp: string, recordBranchId?: string) =>
      inDateWindow(
        businessDateForTimestamp(
          timestamp,
          branchRecords.find((branch) => branch.id === recordBranchId)?.timezone ?? zone,
        ),
        range,
      ),
  };
}

export function TransactionPeriodFilter({
  filter,
}: {
  filter: ReturnType<typeof useTransactionPeriod>;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        Period
        <select
          className="h-10 rounded-md border border-border bg-background px-2"
          value={filter.period}
          onChange={(event) => filter.setPeriod(event.target.value as TransactionPeriod)}
        >
          {transactionPeriods.map((period) => (
            <option key={period}>{period}</option>
          ))}
        </select>
      </label>
      {filter.period === "Custom Range" && (
        <>
          <label>
            From{" "}
            <input
              aria-label="From date"
              className="h-10 rounded-md border border-border bg-background px-2"
              type="date"
              value={filter.custom.from}
              max={filter.custom.to}
              onChange={(event) => {
                if (event.target.value)
                  filter.setCustom({ ...filter.custom, from: event.target.value });
              }}
            />
          </label>
          <label>
            To{" "}
            <input
              aria-label="To date"
              className="h-10 rounded-md border border-border bg-background px-2"
              type="date"
              value={filter.custom.to}
              min={filter.custom.from}
              onChange={(event) => {
                if (event.target.value)
                  filter.setCustom({ ...filter.custom, to: event.target.value });
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}
