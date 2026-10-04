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
import type { ManualMenuItemCreateInput } from "@/onboarding/manual-menu-item";

type Station = { id: string; code: string; name: string; branch_id: string };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBranchId: string;
  branches: Array<{ id: string; name: string }>;
  currency: string;
  categoryCodes: string[];
  stations: Station[];
  createItem: (input: ManualMenuItemCreateInput) => Promise<unknown>;
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
  createItem,
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
  const [counterOnly, setCounterOnly] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [branchPrice, setBranchPrice] = useState("");
  const [onlinePrice, setOnlinePrice] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("");
  const [recipeCode, setRecipeCode] = useState("");
  const [serviceChargeApplicable, setServiceChargeApplicable] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(-1);

  useEffect(() => {
    setSelectedBranchId(initialBranchId);
    if (open) {
      setCode("");
      setName("");
      setCategoryCode("");
      setPrice("");
      setDescription("");
      setSku("");
      setStationCode("");
      setCounterOnly(false);
      setBranchPrice("");
      setOnlinePrice("");
      setTaxCode("");
      setUnitOfMeasure("");
      setRecipeCode("");
      setServiceChargeApplicable(false);
      setAdvancedOpen(false);
      setDraftRevision(0);
    }
    setRequestKey(crypto.randomUUID());
    setError("");
    setNotice("");
    setPreviewRevision(-1);
  }, [initialBranchId, currency, open]);

  function edit(change: () => void) {
    change();
    setDraftRevision((value) => value + 1);
    setRequestKey(crypto.randomUUID());
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
      if (!stationCode && !counterOnly) {
        throw new Error(
          "Select the kitchen/bar station, or explicitly confirm this is a counter-only item.",
        );
      }
      createManualMenuCsv({
        code,
        name,
        categoryCode,
        basePrice: price,
        currency,
        description,
        sku,
        stationCode,
        branchPrice,
        onlinePrice,
        taxCode,
        unitOfMeasure,
        recipeCode,
        serviceChargeApplicable,
      });
      setPreviewRevision(draftRevision);
      setNotice("Local format checks passed. The server will authorize and validate the save.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Manual item could not be validated");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (previewRevision !== draftRevision || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await createItem({
        branchId: selectedBranchId,
        requestKey,
        code,
        name,
        categoryCode,
        basePrice: price,
        currency,
        description,
        sku,
        stationCode,
        branchPrice,
        onlinePrice,
        taxCode,
        unitOfMeasure,
        recipeCode,
        serviceChargeApplicable,
      });
      onCommitted();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Item could not be saved");
      setPreviewRevision(-1);
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
                  setCounterOnly(false);
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
              onChange={(event) =>
                edit(() => {
                  setStationCode(event.target.value);
                  if (event.target.value) setCounterOnly(false);
                })
              }
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
          {!stationCode && (
            <label className="flex items-start gap-2 rounded-md border border-warning/30 p-3 text-[12px]">
              <input
                type="checkbox"
                checked={counterOnly}
                onChange={(event) => edit(() => setCounterOnly(event.target.checked))}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Counter-only item: I confirm no kitchen or bar KOT is required. Items needing
                preparation must be linked to a station before saving.
              </span>
            </label>
          )}
          {selectedBranchId && availableStations.length === 0 && (
            <p className="rounded-md border border-warning/30 p-3 text-[12px] text-warning">
              No kitchen/bar station is configured for this branch. Create it in Setup before
              activating an item that needs kitchen routing.
            </p>
          )}
          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            className="rounded-md border border-border bg-secondary/20 p-3"
          >
            <summary className="cursor-pointer text-[13px] font-semibold">
              More item details (optional)
            </summary>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Only enter values already configured for your business. Unrecognized tax, unit or
              recipe codes must be resolved before they can be used.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-[12px] font-semibold">
                Branch-specific selling price
                <input
                  inputMode="decimal"
                  value={branchPrice}
                  placeholder="Leave empty to use base price"
                  onChange={(event) => edit(() => setBranchPrice(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1 text-[12px] font-semibold">
                Online selling price
                <input
                  inputMode="decimal"
                  value={onlinePrice}
                  placeholder="Optional"
                  onChange={(event) => edit(() => setOnlinePrice(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1 text-[12px] font-semibold">
                Tax rule code
                <input
                  value={taxCode}
                  maxLength={80}
                  placeholder="Existing configured rule"
                  onChange={(event) => edit(() => setTaxCode(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1 text-[12px] font-semibold">
                Unit of measure
                <input
                  value={unitOfMeasure}
                  maxLength={80}
                  placeholder="e.g. PCS, if configured"
                  onChange={(event) => edit(() => setUnitOfMeasure(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="grid gap-1 text-[12px] font-semibold sm:col-span-2">
                Linked recipe code
                <input
                  value={recipeCode}
                  maxLength={120}
                  placeholder="Leave empty until your recipe exists"
                  onChange={(event) => edit(() => setRecipeCode(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] font-semibold sm:col-span-2">
                <input
                  type="checkbox"
                  checked={serviceChargeApplicable}
                  onChange={(event) => edit(() => setServiceChargeApplicable(event.target.checked))}
                  className="h-4 w-4 accent-primary"
                />
                Apply configured service charge
              </label>
            </div>
          </details>
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
          {previewRevision === draftRevision && previewRevision >= 0 && (
            <div className="rounded-md border border-border bg-secondary/40 p-3 text-[12px]">
              <div className="flex items-center justify-between">
                <strong>Ready for server validation</strong>
                <SetupStatus value="READY" />
              </div>
              <p>
                The authoritative server will enforce branch, station, category and duplicate rules.
              </p>
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
            {busy
              ? "Validating..."
              : previewRevision === draftRevision && previewRevision >= 0
                ? "Revalidate"
                : "Validate item"}
          </Btn>
          <Btn
            variant="primary"
            disabled={previewRevision !== draftRevision || busy}
            onClick={() => void save()}
          >
            {busy ? "Saving..." : "Add item"}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
