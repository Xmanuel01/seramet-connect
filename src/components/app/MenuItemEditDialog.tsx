import { useEffect, useState, type FormEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Btn } from "@/components/app/ui";
import type { MenuItemUpdateInput } from "@/onboarding/manual-menu-item";
import type { SetupMenuCatalogItem } from "@/onboarding/use-setup-centre";
import { majorFromMinor } from "@/payments/money";

type Option = { id: string; label: string };
type Props = {
  /** The item being edited; null keeps the dialog closed. */
  item: SetupMenuCatalogItem | null;
  onClose: () => void;
  /** Branch whose price, availability and station are edited; empty when viewing all branches. */
  branchId: string;
  branchName: string;
  categoryCodes: string[];
  stations: Option[];
  taxRules: Option[];
  canEdit: boolean;
  saveItem: (itemId: string, input: MenuItemUpdateInput) => Promise<unknown>;
  uploadImage: (file: File) => Promise<string>;
  onSaved: (name: string) => void;
};

type Draft = {
  name: string;
  categoryCode: string;
  description: string;
  basePrice: string;
  onlinePrice: string;
  branchPrice: string;
  sku: string;
  taxRuleId: string;
  unitOfMeasure: string;
  recipeReference: string;
  serviceChargeApplicable: boolean;
  sellable: boolean;
  available: boolean;
  stationId: string;
};

function amount(minor: number | null, currency: string) {
  return minor === null || minor === undefined ? "" : String(majorFromMinor(minor, currency));
}

function draftFrom(item: SetupMenuCatalogItem): Draft {
  return {
    name: item.name,
    categoryCode: item.category_code,
    description: item.description ?? "",
    basePrice: amount(item.selling_price_minor, item.currency),
    onlinePrice: amount(item.online_price_minor, item.currency),
    branchPrice: amount(item.branch_price_minor, item.currency),
    sku: item.sku ?? "",
    taxRuleId: item.tax_rule_id ?? "",
    unitOfMeasure: item.unit_of_measure ?? "",
    recipeReference: item.recipe_reference ?? "",
    serviceChargeApplicable: item.service_charge_applicable === 1,
    sellable: item.sellable !== 0,
    available: item.available !== 0,
    stationId: item.station_id ?? "",
  };
}

/** Edits every setting of one menu item, including its photo, in a single popup. */
export function MenuItemEditDialog({
  item,
  onClose,
  branchId,
  branchName,
  categoryCodes,
  stations,
  taxRules,
  canEdit,
  saveItem,
  uploadImage,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // undefined: keep the current photo; null: remove it; a File: replace it on save.
  const [photo, setPhoto] = useState<File | null | undefined>(undefined);
  const [photoPreview, setPhotoPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(item ? draftFrom(item) : null);
    setPhoto(undefined);
    setError("");
  }, [item]);

  useEffect(() => {
    if (!(photo instanceof File)) {
      setPhotoPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (!item || !draft) return null;
  const currency = item.currency;
  const shownImage = photo === null ? "" : photoPreview || item.image_url || "";
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item || !draft || busy) return;
    setBusy(true);
    setError("");
    try {
      const imageObjectId =
        photo instanceof File ? await uploadImage(photo) : photo === null ? null : undefined;
      await saveItem(item.id, {
        name: draft.name,
        categoryCode: draft.categoryCode,
        description: draft.description,
        basePrice: draft.basePrice,
        onlinePrice: draft.onlinePrice,
        sku: draft.sku,
        taxRuleId: draft.taxRuleId,
        unitOfMeasure: draft.unitOfMeasure,
        recipeReference: draft.recipeReference,
        serviceChargeApplicable: draft.serviceChargeApplicable,
        sellable: draft.sellable,
        ...(imageObjectId !== undefined ? { imageObjectId } : {}),
        ...(branchId
          ? {
              branch: {
                branchId,
                price: draft.branchPrice,
                available: draft.available,
                stationId: draft.stationId,
              },
            }
          : {}),
      });
      onSaved(draft.name);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The item couldn't be saved");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground disabled:opacity-60";
  const labelClass = "grid gap-1 text-[12px] font-semibold";
  const moneyPattern = "\\d+(\\.\\d{1,3})?";
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>
            Item code {item.code}. Prices are in {currency}.
          </DialogDescription>
        </DialogHeader>
        <form
          id="menu-item-edit-form"
          onSubmit={(event) => void save(event)}
          className="grid gap-4"
        >
          <fieldset disabled={!canEdit || busy} className="grid gap-4">
            <div className="flex items-center gap-4">
              <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary/40">
                {shownImage ? (
                  <img src={shownImage} alt={item.name} className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="grid gap-2 text-[12px]">
                <span className="font-semibold">Photo</span>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 font-medium hover:bg-secondary">
                    <ImagePlus className="h-4 w-4" />
                    {shownImage ? "Change photo" : "Upload photo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) setPhoto(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {shownImage && (
                    <Btn onClick={() => setPhoto(null)}>
                      <Trash2 className="h-4 w-4" />
                      Remove
                    </Btn>
                  )}
                </div>
                <span className="text-muted-foreground">
                  Shown on the POS and the online menu. JPG, PNG or WebP.
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`${labelClass} sm:col-span-2`}>
                Name *
                <input
                  required
                  maxLength={160}
                  value={draft.name}
                  onChange={(event) => set("name", event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Category *
                <input
                  required
                  maxLength={40}
                  list="menu-item-edit-categories"
                  value={draft.categoryCode}
                  onChange={(event) => set("categoryCode", event.target.value.toUpperCase())}
                  className={inputClass}
                />
                <datalist id="menu-item-edit-categories">
                  {categoryCodes.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
              </label>
              <label className={labelClass}>
                SKU
                <input
                  maxLength={80}
                  value={draft.sku}
                  placeholder={item.code}
                  onChange={(event) => set("sku", event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                Description
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={draft.description}
                  onChange={(event) => set("description", event.target.value)}
                  className="rounded-md border border-border bg-background p-3 text-[13px] disabled:opacity-60"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className={labelClass}>
                Price *
                <input
                  required
                  inputMode="decimal"
                  pattern={moneyPattern}
                  value={draft.basePrice}
                  onChange={(event) => set("basePrice", event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                Online price
                <input
                  inputMode="decimal"
                  pattern={moneyPattern}
                  value={draft.onlinePrice}
                  placeholder="Same as price"
                  onChange={(event) => set("onlinePrice", event.target.value)}
                  className={inputClass}
                />
              </label>
              {branchId && (
                <label className={labelClass}>
                  Price at {branchName}
                  <input
                    inputMode="decimal"
                    pattern={moneyPattern}
                    value={draft.branchPrice}
                    placeholder="Same as price"
                    onChange={(event) => set("branchPrice", event.target.value)}
                    className={inputClass}
                  />
                </label>
              )}
            </div>

            {branchId ? (
              <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <label className={labelClass}>
                  Kitchen or bar station at {branchName}
                  <select
                    value={draft.stationId}
                    onChange={(event) => set("stationId", event.target.value)}
                    className={inputClass}
                  >
                    <option value="">None (served from the counter)</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-[12px] font-semibold">
                  <input
                    type="checkbox"
                    checked={draft.available}
                    onChange={(event) => set("available", event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Available at {branchName}
                </label>
              </div>
            ) : (
              <p className="rounded-md border border-border bg-secondary/30 p-3 text-[12px] text-muted-foreground">
                Choose a branch at the top to change that branch's price, station and availability.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Tax
                <select
                  value={draft.taxRuleId}
                  onChange={(event) => set("taxRuleId", event.target.value)}
                  className={inputClass}
                >
                  <option value="">No tax rule</option>
                  {taxRules.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Unit
                <input
                  maxLength={40}
                  value={draft.unitOfMeasure}
                  placeholder="e.g. PCS"
                  onChange={(event) => set("unitOfMeasure", event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                Linked recipe
                <input
                  maxLength={120}
                  value={draft.recipeReference}
                  placeholder="Recipe reference, if the item has one"
                  onChange={(event) => set("recipeReference", event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] font-semibold">
                <input
                  type="checkbox"
                  checked={draft.serviceChargeApplicable}
                  onChange={(event) => set("serviceChargeApplicable", event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Add service charge
              </label>
              <label className="flex items-center gap-2 text-[12px] font-semibold">
                <input
                  type="checkbox"
                  checked={draft.sellable}
                  onChange={(event) => set("sellable", event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                On sale (shown on menus)
              </label>
            </div>
          </fieldset>
          {!canEdit && (
            <p className="text-[12px] text-muted-foreground">
              You can view this item. Editing needs menu setup permission.
            </p>
          )}
          {error && (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2">
          <Btn disabled={busy} onClick={onClose}>
            {canEdit ? "Cancel" : "Close"}
          </Btn>
          {canEdit && (
            <Btn variant="primary" type="submit" form="menu-item-edit-form" disabled={busy}>
              {busy ? "Saving..." : "Save changes"}
            </Btn>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
