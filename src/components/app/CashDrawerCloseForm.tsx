import { useRef, useState } from "react";
import { Btn } from "./ui";
import { cashCount } from "@/payments/cash-count";
import { formatMinor, parseMajorAmount } from "@/payments/money";

export function CashDrawerCloseForm({
  expected,
  currency,
  onClose,
}: {
  expected: number;
  currency: string;
  onClose: (count: string) => Promise<unknown>;
}) {
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  let variance: string | null = null;
  try {
    variance = formatMinor(cashCount(count, expected, currency).varianceMinor, currency);
  } catch {
    /* Incomplete entry. */
  }
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setNotice("");
        try {
          cashCount(count, expected, currency);
          await onClose(count);
          setNotice("Cash drawer closed.");
        } catch (error) {
          setNotice(error instanceof Error ? error.message : "Cash drawer could not be closed.");
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <div>Expected: {formatMinor(parseMajorAmount(expected, currency), currency)}</div>
      <label className="block">
        Physical cash count
        <input
          required
          inputMode="decimal"
          value={count}
          disabled={busy}
          onChange={(event) => setCount(event.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>
      <div>Variance: {variance ?? "Enter a valid count"}</div>
      {notice && <p role="status">{notice}</p>}
      <Btn type="submit" disabled={busy}>
        {busy ? "Closing..." : "Close drawer"}
      </Btn>
    </form>
  );
}
