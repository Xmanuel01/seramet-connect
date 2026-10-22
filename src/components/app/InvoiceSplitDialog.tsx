import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Btn } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { invoiceDisplayName, invoiceSplitAmounts } from "@/lib/invoice-split";
import { formatMinor, minorDigits, parseMajorAmount, sumMinor } from "@/payments/money";

const blank = () => ({ id: crypto.randomUUID(), label: "", amount: "" });

export function InvoiceSplitDialog({
  invoiceId,
  total,
  currency,
  close,
  confirm,
}: {
  invoiceId: string;
  total: number;
  currency: string;
  close: () => void;
  confirm: (splits: { label: string; amount: number }[]) => Promise<void>;
}) {
  const [rows, setRows] = useState(() => [blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  let allocation: ReturnType<typeof invoiceSplitAmounts> | null = null;
  try {
    allocation = invoiceSplitAmounts(total, currency, rows);
  } catch {
    /* Incomplete draft. */
  }
  let enteredMinor: number | null = null;
  try {
    enteredMinor = sumMinor(
      rows.map((row) => {
        try {
          return Math.max(0, parseMajorAmount(row.amount, currency));
        } catch {
          return 0;
        }
      }),
    );
  } catch {
    /* Out-of-range draft amounts must not interrupt the invoice. */
  }
  const remainingMinor = parseMajorAmount(total, currency) - (enteredMinor ?? 0);
  const update = (id: string, field: "amount" | "label", value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setError("");
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) close();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] max-w-xl overflow-y-auto border-border bg-card"
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Split {invoiceDisplayName(invoiceId)}</DialogTitle>
          <DialogDescription>
            Invoice total: {formatMinor(parseMajorAmount(total, currency), currency)}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (submitting.current) return;
            if (!allocation || allocation.remainingMinor !== 0) {
              setError("The total split amount must match the invoice total exactly.");
              return;
            }
            submitting.current = true;
            setBusy(true);
            setError("");
            try {
              await confirm(allocation.splits);
              close();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Split could not be confirmed. Your amounts were retained.",
              );
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <fieldset disabled={busy} className="space-y-4">
            <div role="radiogroup" aria-label="Split arrangement" className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="split-arrangement"
                  checked={rows.length === 2}
                  onChange={() => {
                    if (rows.slice(2).some((row) => row.label.trim() || row.amount.trim())) {
                      setError(
                        "Remove additional people before switching to two people. Your amounts were retained.",
                      );
                      return;
                    }
                    setRows((current) => current.slice(0, 2));
                    setError("");
                  }}
                />
                Two people
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="split-arrangement"
                  checked={rows.length > 2}
                  onChange={() => {
                    if (rows.length === 2) setRows((current) => [...current, blank()]);
                    setError("");
                  }}
                />
                Multiple people
              </label>
            </div>
            <div className="space-y-3">
              {rows.map((row, index) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] items-end gap-2"
                >
                  <label className="grid gap-1 text-sm">
                    Person {index + 1}
                    <input
                      aria-label={`Person ${index + 1} name`}
                      placeholder="Name (optional)"
                      maxLength={120}
                      value={row.label}
                      onChange={(event) => update(row.id, "label", event.target.value)}
                      className="h-10 min-w-0 rounded-md border border-border bg-background px-2"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Amount ({currency})
                    <input
                      aria-label={`Person ${index + 1} amount`}
                      required
                      type="text"
                      inputMode={minorDigits(currency) ? "decimal" : "numeric"}
                      autoComplete="off"
                      value={row.amount}
                      onChange={(event) => update(row.id, "amount", event.target.value)}
                      className="h-10 min-w-0 rounded-md border border-border bg-background px-2"
                    />
                  </label>
                  <button
                    type="button"
                    title={`Remove person ${index + 1}`}
                    aria-label={`Remove person ${index + 1}`}
                    disabled={rows.length <= 2}
                    onClick={() =>
                      setRows((current) => current.filter((item) => item.id !== row.id))
                    }
                    className="grid h-10 w-10 place-items-center rounded-md border border-border disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <Btn type="button" onClick={() => setRows((current) => [...current, blank()])}>
              <Plus className="h-4 w-4" />
              Add person
            </Btn>
          </fieldset>
          <div aria-live="polite" className="space-y-1 border-y border-border py-3 text-sm">
            <p>
              Allocated:{" "}
              {enteredMinor === null
                ? "Amount exceeds supported range"
                : formatMinor(enteredMinor, currency)}
            </p>
            <p className={remainingMinor === 0 ? "text-success" : "text-warning"}>
              {remainingMinor < 0 ? "Over by" : "Remaining"}:{" "}
              {formatMinor(Math.abs(remainingMinor), currency)}
            </p>
            {allocation && allocation.remainingMinor !== 0 && (
              <p role="alert">The total split amount must match the invoice total exactly.</p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Btn type="button" disabled={busy} onClick={close}>
              Cancel
            </Btn>
            <Btn
              type="submit"
              variant="primary"
              disabled={busy || !allocation || allocation.remainingMinor !== 0}
            >
              {busy ? "Splitting..." : "Confirm split"}
            </Btn>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
