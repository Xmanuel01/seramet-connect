import { useState } from "react";
import { Plus, Trash2, Truck } from "lucide-react";
import { Btn } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OrderChannelDefinition } from "@/platform/types";
import { deliverySettings, deliverySettingsSchema, type DeliverySettings } from "./delivery-charge";
import { majorFromMinor, parseMajorAmount as minorFromMajor } from "@/payments/money";

export function DeliverySettingsDialog({
  channel,
  currency,
  branches,
  disabled,
  onSave,
}: {
  channel: OrderChannelDefinition;
  currency: string;
  branches: { id: string; name: string }[];
  disabled: boolean;
  onSave: (settings: DeliverySettings) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<DeliverySettings>({
    fulfilment: "NONE",
    beneficiary: "BUSINESS",
    allowManual: false,
    cashHandledBy: "COUNTER",
    scheduledTravelMinutes: 15,
    scheduledPrepMinutes: 25,
    rates: [],
  });
  const inputClass = "h-10 min-w-0 rounded-md border border-border bg-card px-3 text-sm";
  return (
    <>
      <Btn
        disabled={disabled}
        onClick={() => {
          setDraft(
            structuredClone(
              deliverySettings(channel) ?? {
                fulfilment: "NONE",
                beneficiary: "BUSINESS",
                allowManual: false,
                cashHandledBy: "COUNTER",
                scheduledTravelMinutes: 15,
                scheduledPrepMinutes: 25,
                rates: [],
              },
            ),
          );
          setError("");
          setOpen(true);
        }}
      >
        <Truck size={16} />
        Delivery
      </Btn>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{channel.displayName} delivery</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving) return;
              setSaving(true);
              setError("");
              try {
                const settings = deliverySettingsSchema.parse(draft);
                if (await onSave(settings)) setOpen(false);
                else setError("Delivery settings were not saved. Try again.");
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Delivery settings were not saved",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            <fieldset disabled={saving} className="grid min-w-0 gap-4">
              <label className="grid gap-1 text-sm">
                Fulfilment
                <select
                  className={inputClass}
                  value={draft.fulfilment}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      fulfilment: event.target.value as DeliverySettings["fulfilment"],
                    })
                  }
                >
                  <option value="NONE">No delivery</option>
                  <option value="RESTAURANT">Restaurant riders</option>
                  <option value="PROVIDER">Marketplace riders</option>
                  <option value="PICKUP">Customer pickup</option>
                </select>
              </label>
              {(draft.fulfilment === "RESTAURANT" || draft.fulfilment === "PROVIDER") && (
                <label className="grid gap-1 text-sm">
                  Money paid on delivery is received by
                  <select
                    className={inputClass}
                    value={draft.cashHandledBy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        cashHandledBy: event.target.value as DeliverySettings["cashHandledBy"],
                      })
                    }
                  >
                    <option value="COUNTER">The cashier (riders only deliver)</option>
                    <option value="RIDER">The restaurant rider, who hands it in later</option>
                  </select>
                  <span className="text-xs text-muted-foreground">
                    {draft.cashHandledBy === "RIDER"
                      ? "Each amount is held against the rider until it is handed in on the Riders page."
                      : "The invoice is cleared on Invoices with whatever was paid: cash, M-Pesa, card or bank."}
                  </span>
                </label>
              )}
              {draft.fulfilment === "RESTAURANT" && (
                <>
                  <label className="grid gap-1 text-sm">
                    Delivery fee belongs to
                    <select
                      className={inputClass}
                      value={draft.beneficiary}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          beneficiary: event.target.value as DeliverySettings["beneficiary"],
                        })
                      }
                    >
                      <option value="BUSINESS">Business</option>
                      <option value="RIDER">Rider (100%)</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.allowManual}
                      onChange={(event) =>
                        setDraft({ ...draft, allowManual: event.target.checked })
                      }
                    />
                    Allow authorized custom amounts
                  </label>
                  <div className="divide-y divide-border">
                    {draft.rates.map((rate, index) => (
                      <div key={rate.id} className="grid min-w-0 gap-2 py-3">
                        <div className="grid grid-cols-[minmax(0,1fr)_minmax(80px,120px)_40px] gap-2">
                          <input
                            aria-label="Rate name"
                            required
                            maxLength={120}
                            className={inputClass}
                            value={rate.label}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                rates: draft.rates.map((row, i) =>
                                  i === index ? { ...row, label: event.target.value } : row,
                                ),
                              })
                            }
                          />
                          <input
                            aria-label={`Rate amount (${currency})`}
                            type="number"
                            min="0"
                            step="0.01"
                            required
                            className={inputClass}
                            value={majorFromMinor(rate.amountMinor, currency)}
                            onChange={(event) => {
                              const amount = Number(event.target.value);
                              if (Number.isFinite(amount) && amount >= 0)
                                setDraft({
                                  ...draft,
                                  rates: draft.rates.map((row, i) =>
                                    i === index
                                      ? { ...row, amountMinor: minorFromMajor(amount, currency) }
                                      : row,
                                  ),
                                });
                            }}
                          />
                          <button
                            type="button"
                            title="Remove rate"
                            aria-label="Remove rate"
                            className="flex h-10 w-10 items-center justify-center"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                rates: draft.rates.filter((row) => row.id !== rate.id),
                              })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <label className="grid gap-1 text-xs">
                          Branch
                          <select
                            className={inputClass}
                            value={rate.branchIds[0] ?? ""}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                rates: draft.rates.map((row, i) =>
                                  i === index
                                    ? {
                                        ...row,
                                        branchIds: event.target.value ? [event.target.value] : [],
                                      }
                                    : row,
                                ),
                              })
                            }
                          >
                            <option value="">All branches</option>
                            {branches.map((branch) => (
                              <option key={branch.id} value={branch.id}>
                                {branch.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>
                  <Btn
                    type="button"
                    disabled={draft.rates.length >= 100}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        rates: [
                          ...draft.rates,
                          { id: crypto.randomUUID(), label: "", amountMinor: 0, branchIds: [] },
                        ],
                      })
                    }
                  >
                    <Plus size={16} />
                    Add rate
                  </Btn>
                </>
              )}
              <div className="grid gap-3 rounded-md border border-border p-3">
                <p className="text-sm font-semibold">Scheduled orders</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {draft.fulfilment !== "PICKUP" && (
                    <label className="grid gap-1 text-sm">
                      Rider's trip to the customer (minutes)
                      <input
                        type="number"
                        min={0}
                        max={240}
                        inputMode="numeric"
                        className={inputClass}
                        value={draft.scheduledTravelMinutes}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            scheduledTravelMinutes: Number(event.target.value || 0),
                          })
                        }
                      />
                    </label>
                  )}
                  <label className="grid gap-1 text-sm">
                    Kitchen prep for orders typed in (minutes)
                    <input
                      type="number"
                      min={1}
                      max={480}
                      inputMode="numeric"
                      className={inputClass}
                      value={draft.scheduledPrepMinutes}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          scheduledPrepMinutes: Number(event.target.value || 0),
                        })
                      }
                    />
                  </label>
                </div>
                <span className="text-xs text-muted-foreground">
                  The kitchen gets a scheduled order this long before it is due. When the app gives
                  a pickup time, that is used instead of the trip.
                </span>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Btn type="submit">{saving ? "Saving..." : "Save delivery settings"}</Btn>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
