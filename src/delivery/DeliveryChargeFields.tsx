import type { DeliveryCharge, DeliverySettings } from "./delivery-charge";
import { useRef, type Ref } from "react";
import { X } from "lucide-react";
import { majorFromMinor, parseMajorAmount as minorFromMajor, minorDigits } from "@/payments/money";

export function DeliveryChargeFields({
  settings,
  branchId,
  currency,
  value,
  onChange,
  disabled,
  canOverride,
  inputRef,
}: {
  settings: DeliverySettings;
  branchId: string;
  currency: string;
  value: DeliveryCharge | undefined;
  onChange: (value: DeliveryCharge | undefined) => void;
  disabled: boolean;
  canOverride: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const amountInput = useRef<HTMLInputElement | null>(null);
  const setInputRef = (element: HTMLInputElement | null) => {
    amountInput.current = element;
    if (typeof inputRef === "function") inputRef(element);
    else if (inputRef) inputRef.current = element;
  };
  if (settings.fulfilment !== "RESTAURANT")
    return value ? (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border p-3 text-xs">
        <span>
          Saved delivery charge: {currency}{" "}
          {majorFromMinor(value.amountMinor, currency).toFixed(minorDigits(currency))}
        </span>
        <button
          type="button"
          disabled={disabled || value.source === "PROVIDER"}
          aria-label="Remove delivery charge"
          title="Remove delivery charge"
          onClick={() => onChange(undefined)}
          className="rounded p-2 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    ) : null;
  const rates = settings.rates.filter(
    (rate) => !rate.branchIds.length || rate.branchIds.includes(branchId),
  );
  const inputClass = "h-10 min-w-0 rounded-md border border-border bg-card px-3 font-normal";
  if (settings.allowOrderAmount || value?.source === "PROVIDER")
    return (
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">
          Delivery amount ({currency})
          <input
            ref={setInputRef}
            aria-label={`Delivery amount (${currency})`}
            type="number"
            min="0"
            step={10 ** -minorDigits(currency)}
            disabled={disabled || value?.source === "PROVIDER"}
            className={inputClass}
            value={value ? majorFromMinor(value.amountMinor, currency) : ""}
            placeholder="0"
            onChange={(event) => {
              if (!event.target.value) {
                event.target.setCustomValidity("");
                onChange(undefined);
                return;
              }
              try {
                const amountMinor = minorFromMajor(event.target.value, currency);
                if (amountMinor >= 0)
                  onChange({ source: "ORDER", amountMinor, beneficiary: settings.beneficiary });
                event.target.setCustomValidity(
                  amountMinor < 0 ? "Delivery amount cannot be negative" : "",
                );
              } catch {
                event.target.setCustomValidity(`Enter a valid ${currency} amount`);
              }
            }}
          />
        </label>
        {rates.length > 0 && value?.source !== "PROVIDER" && (
          <label className="grid gap-1 text-xs font-semibold">
            Delivery rate
            <select
              className={inputClass}
              disabled={disabled}
              value={value?.rateId ?? ""}
              onChange={(event) => {
                amountInput.current?.setCustomValidity("");
                const rate = rates.find((entry) => entry.id === event.target.value);
                onChange(
                  rate
                    ? {
                        source: "RATE",
                        rateId: rate.id,
                        amountMinor: rate.amountMinor,
                        beneficiary: settings.beneficiary,
                      }
                    : undefined,
                );
              }}
            >
              <option value="">Custom amount</option>
              {rates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  {rate.label} - {currency}{" "}
                  {majorFromMinor(rate.amountMinor, currency).toFixed(minorDigits(currency))}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    );
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold">
        Delivery charge
        <select
          className={inputClass}
          disabled={disabled}
          value={value?.source === "MANUAL" ? "manual" : (value?.rateId ?? "")}
          onChange={(event) => {
            const rate = rates.find((entry) => entry.id === event.target.value);
            onChange(
              rate
                ? {
                    source: "RATE",
                    rateId: rate.id,
                    amountMinor: rate.amountMinor,
                    beneficiary: settings.beneficiary,
                  }
                : event.target.value === "manual"
                  ? {
                      source: "MANUAL",
                      amountMinor: 0,
                      beneficiary: settings.beneficiary,
                      reason: "",
                    }
                  : undefined,
            );
          }}
        >
          <option value="">No delivery charge</option>
          {rates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rate.label} - {currency} {majorFromMinor(rate.amountMinor, currency).toFixed(2)}
            </option>
          ))}
          {settings.allowManual && canOverride && <option value="manual">Custom amount</option>}
        </select>
      </label>
      {value?.source === "MANUAL" && (
        <>
          <label className="grid gap-1 text-xs font-semibold">
            Delivery amount ({currency})
            <input
              ref={setInputRef}
              type="number"
              min="0"
              step={10 ** -minorDigits(currency)}
              disabled={disabled}
              className={inputClass}
              value={majorFromMinor(value.amountMinor, currency)}
              onChange={(event) => {
                try {
                  const amount = minorFromMajor(event.target.value || "0", currency);
                  if (amount < 0) throw new Error("Negative delivery amount");
                  event.target.setCustomValidity("");
                  onChange({ ...value, amountMinor: amount });
                } catch {
                  event.target.setCustomValidity(`Enter a valid ${currency} amount`);
                }
              }}
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold sm:col-span-2">
            Override reason
            <input
              maxLength={500}
              disabled={disabled}
              className={inputClass}
              value={value.reason ?? ""}
              onChange={(event) => onChange({ ...value, reason: event.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
