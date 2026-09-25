import { useEffect, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Btn } from "@/components/app/ui";
import { SetupStatus } from "@/onboarding/ui";
import { createManualMenuCsv } from "@/onboarding/manual-menu-item";
import type { ImportPreview } from "@/onboarding/types";

type Station = { id: string; code: string; name: string; branch_id: string };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBranchId: string;
  branches: Array<{ id: string; name: string }>;
  currency: string;
  categoryCodes: string[];
  stations: Station[];
  previewImport: (file: File, targetBranchId: string) => Promise<ImportPreview>;
  commitImport: (preview: ImportPreview) => Promise<{
    result: {
      queued: boolean;
      jobId?: string;
      verification?: ImportPreview["verification"];
    };
  }>;
  onCommitted: () => void;
};

export function ManualMenuItemDialog({
  open,
  onOpenChange,
  initialBranchId,
  branches,
  currency,
  categoryCodes,
  stations,
  previewImport,
  commitImport,
  onCommitted,
}: Props) {
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
  const availableStations = stations.filter((station) => station.branch_id === selectedBranchId);
  const branchName = branches.find((branch) => branch.id === selectedBranchId)?.name ?? "";
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(-1);

  useEffect(() => {
    setSelectedBranchId(initialBranchId);
    setPreview(null);
    setError("");
    setNotice("");
    setPreviewRevision(-1);
  }, [initialBranchId, currency, open]);

  function edit(change: () => void) {
    change();
    setDraftRevision((value) => value + 1);
    setPreview(null);
    setError("");
    setNotice("");
  }

  async function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!selectedBranchId) throw new Error("Choose a branch before adding a sellable item.");
      const csv = createManualMenuCsv({
        code,
        name,
        categoryCode,
        basePrice: price,
        currency,
        description,
        sku,
        stationCode,
      });
      const file = new File([csv], "seramet-manual-" + code.trim() + ".csv", {
        type: "text/csv",
        lastModified: Date.now(),
      });
      const checked = await previewImport(file, selectedBranchId);
      setPreview(checked);
      setPreviewRevision(draftRevision);
      if (!checked.canCommit) {
        setError(
          checked.rows.flatMap((row) => row.errors.map((issue) => issue.message)).join("; ") ||
            "The server did not approve this item. Review its configuration.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Manual item could not be validated");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview || !preview.canCommit || previewRevision !== draftRevision || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await commitImport(preview);
      if (result.result.queued) {
        setPreview({ ...preview, canCommit: false, status: "COMMITTING" });
        setNotice(
          "Item import queued as " +
            (result.result.jobId ?? "a durable worker job") +
            ". Refresh the catalogue after verification; this is not yet a saved item.",
        );
      } else if (result.result.verification?.status === "VERIFIED") {
        onCommitted();
        onOpenChange(false);
      } else {
        setPreview({ ...preview, canCommit: false });
        setError("Server commit was not verified. Refresh the catalogue before retrying.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Item could not be saved");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground";
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add menu item</DialogTitle>
          <DialogDescription>
            Add an item to {branchName || "the selected branch"}. Validate it on the server before
            making it available at the POS; kitchen routing must use a configured station.
          </DialogDescription>
        </DialogHeader>
        <form
          id="manual-menu-item-form"
          onSubmit={(event) => void validate(event)}
          className="grid gap-3"
        >
          <label className="grid gap-1 text-[12px] font-semibold">
            Activate at branch *
            <select
              required
              value={selectedBranchId}
              onChange={(event) =>
                edit(() => {
                  setSelectedBranchId(event.target.value);
                  setStationCode("");
                })
              }
              className="h-10 rounded-md border border-border bg-background px-3 text-[13px]"
            >
              <option value="">Select a branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Item code *
              <input
                required
                value={code}
                maxLength={40}
                placeholder="PILAU-001"
                onChange={(event) => edit(() => setCode(event.target.value))}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Category code *
              <input
                required
                list="seramet-menu-categories"
                value={categoryCode}
                maxLength={40}
                placeholder="MAIN"
                onChange={(event) => edit(() => setCategoryCode(event.target.value))}
                className={inputClass}
              />
              <datalist id="seramet-menu-categories">
                {categoryCodes.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="grid gap-1 text-[12px] font-semibold">
            Display name *
            <input
              required
              value={name}
              maxLength={160}
              placeholder="Beef Pilau"
              onChange={(event) => edit(() => setName(event.target.value))}
              className={inputClass}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Selling price ({currency || "unconfigured"}) *
              <input
                required
                type="text"
                inputMode="decimal"
                value={price}
                placeholder="450.00"
                onChange={(event) => edit(() => setPrice(event.target.value))}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              SKU (optional)
              <input
                value={sku}
                maxLength={80}
                placeholder="Defaults to item code"
                onChange={(event) => edit(() => setSku(event.target.value))}
                className={inputClass}
              />
            </label>
          </div>
          <label className="grid gap-1 text-[12px] font-semibold">
            Production station
            <select
              value={stationCode}
              onChange={(event) => edit(() => setStationCode(event.target.value))}
              className={inputClass}
            >
              <option value="">No station assigned</option>
              {availableStations.map((station) => (
                <option key={station.id} value={station.code}>
                  {station.name} ({station.code})
                </option>
              ))}
            </select>
          </label>
          {selectedBranchId && availableStations.length === 0 && (
            <p className="rounded-md border border-warning/30 p-3 text-[12px] text-warning">
              No kitchen/bar station is configured for this branch. Create it in Setup before
              activating an item that needs kitchen routing.
            </p>
          )}
          <label className="grid gap-1 text-[12px] font-semibold">
            Description (optional)
            <textarea
              rows={2}
              value={description}
              maxLength={500}
              onChange={(event) => edit(() => setDescription(event.target.value))}
              className="rounded-md border border-border bg-background p-3 text-[13px]"
            />
          </label>
          {preview && (
            <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px]">
              <div className="flex items-center justify-between">
                <strong>Server validation</strong>
                <SetupStatus value={preview.canCommit ? "READY" : "BLOCKED"} />
              </div>
              <p>
                {preview.validCount} valid · {preview.warningCount} warnings · {preview.errorCount}{" "}
                errors
              </p>
              {preview.rows
                .flatMap((row) => row.warnings)
                .map((issue, index) => (
                  <p className="mt-1 text-warning" key={issue.code + index}>
                    {issue.message}
                  </p>
                ))}
            </div>
          )}
          {notice && (
            <p role="status" className="text-[12px] text-warning">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Btn disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <Btn
            type="submit"
            form="manual-menu-item-form"
            disabled={busy || !currency || !selectedBranchId}
          >
            {busy ? "Validating..." : preview ? "Revalidate" : "Validate item"}
          </Btn>
          <Btn
            variant="primary"
            disabled={!preview?.canCommit || previewRevision !== draftRevision || busy}
            onClick={() => void save()}
          >
            {busy ? "Saving..." : "Add item"}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
