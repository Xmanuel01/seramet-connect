import type { DeliveryCharge, DeliverySettings } from "./delivery-charge";
import { majorFromMinor, parseMajorAmount as minorFromMajor } from "@/payments/money";

export function DeliveryChargeFields({ settings, branchId, currency, value, onChange, disabled, canOverride }: {
  settings: DeliverySettings;
  branchId: string;
  currency: string;
  value: DeliveryCharge | undefined;
  onChange: (value: DeliveryCharge | undefined) => void;
  disabled: boolean;
  canOverride: boolean;
}) {
  if (settings.fulfilment !== "RESTAURANT") return null;
  const rates = settings.rates.filter((rate) => !rate.branchIds.length || rate.branchIds.includes(branchId));
  const inputClass = "h-10 min-w-0 rounded-md border border-border bg-card px-3 font-normal";
  return <div className="mb-3 grid gap-2 sm:grid-cols-2">
    <label className="grid gap-1 text-xs font-semibold">Delivery charge
      <select className={inputClass} disabled={disabled} value={value?.source === "MANUAL" ? "manual" : value?.rateId ?? ""} onChange={(event) => {
        const rate = rates.find((entry) => entry.id === event.target.value);
        onChange(rate ? { source: "RATE", rateId: rate.id, amountMinor: rate.amountMinor, beneficiary: settings.beneficiary } : event.target.value === "manual" ? { source: "MANUAL", amountMinor: 0, beneficiary: settings.beneficiary, reason: "" } : undefined);
      }}>
        <option value="">No delivery charge</option>
        {rates.map((rate) => <option key={rate.id} value={rate.id}>{rate.label} - {currency} {majorFromMinor(rate.amountMinor, currency).toFixed(2)}</option>)}
        {settings.allowManual && canOverride && <option value="manual">Custom amount</option>}
      </select>
    </label>
    {value?.source === "MANUAL" && <>
      <label className="grid gap-1 text-xs font-semibold">Delivery amount ({currency})
        <input type="number" min="0" step="0.01" disabled={disabled} className={inputClass} value={majorFromMinor(value.amountMinor, currency)} onChange={(event) => {
          const amount = Number(event.target.value);
          if (Number.isFinite(amount) && amount >= 0) onChange({ ...value, amountMinor: minorFromMajor(amount, currency) });
        }} />
      </label>
      <label className="grid gap-1 text-xs font-semibold sm:col-span-2">Override reason
        <input maxLength={500} disabled={disabled} className={inputClass} value={value.reason ?? ""} onChange={(event) => onChange({ ...value, reason: event.target.value })} />
      </label>
    </>}
  </div>;
}
