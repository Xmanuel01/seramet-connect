import { ArrowLeft, ArrowRight, Building2, Check, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import type { useSetupCentre } from "@/onboarding/use-setup-centre";

type Centre = ReturnType<typeof useSetupCentre>;

const fieldClass =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary";
const labelClass = "grid min-w-0 gap-1.5 text-sm font-semibold text-foreground";

const stepTitles: Record<number, string> = {
  5: "Where is your business located?",
  6: "Confirm your location",
  7: "Your currency",
  8: "What kind of business is this?",
  9: "Your first branch",
  10: "Branch location",
  11: "Opening hours",
  12: "Service modes",
  13: "Tax and service charge",
  14: "Payment methods",
  15: "Invite your team",
  16: "Menu setup",
  17: "Inventory setup",
  18: "Kitchen and stations",
  19: "Hardware",
  20: "Review your restaurant",
};

export function OnboardingWizard({ centre }: { centre: Centre }) {
  const { activeTenantId, branchId, platformState } = useAppContext();
  const state = centre.onboarding!;
  const step = state.currentStep;
  const country = centre.countries.find((item) => item.code === state.location?.countryCode);
  const initialBranch =
    centre.structure.branches.find((item) => item.id === branchId) ?? centre.structure.branches[0];
  const paymentMethods = platformState.paymentMethods.filter(
    (item) => item.tenantId === activeTenantId && item.enabled,
  );
  const orderChannels = platformState.orderChannels.filter(
    (item) => item.tenantId === activeTenantId && item.enabled,
  );
  const prior = state.responses;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [location, setLocation] = useState({
    countryCode: state.location?.countryCode ?? "",
    administrativeLevel1: state.location?.administrativeLevel1 ?? "",
    administrativeLevel2: state.location?.administrativeLevel2 ?? "",
    city: state.location?.city ?? "",
    addressLine: state.location?.addressLine ?? "",
    postalCode: state.location?.postalCode ?? "",
  });
  const [baseCurrency, setBaseCurrency] = useState(
    state.acceptedCurrencies.find((item) => item.isBase)?.code ??
      state.suggestedCurrency?.code ??
      "",
  );
  const [secondaryCurrencies, setSecondaryCurrencies] = useState<string[]>(
    state.acceptedCurrencies
      .filter((item) => !item.isBase && item.status === "ACTIVE")
      .map((item) => item.code),
  );
  const [businessType, setBusinessType] = useState(responseText(prior, 8, "businessType"));
  const [branchName, setBranchName] = useState(initialBranch?.name ?? "");
  const [branchCode, setBranchCode] = useState(initialBranch?.code ?? "");
  const [useBusinessLocation, setUseBusinessLocation] = useState(true);
  const [branchLocation, setBranchLocation] = useState({ city: "", addressLine: "" });
  const [hours, setHours] = useState(() => defaultHours());
  const [serviceModes, setServiceModes] = useState<string[]>([]);
  const [serviceModeInput, setServiceModeInput] = useState("");
  const [choice, setChoice] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!baseCurrency && state.suggestedCurrency) setBaseCurrency(state.suggestedCurrency.code);
  }, [baseCurrency, state.suggestedCurrency]);

  useEffect(() => {
    if (!serviceModes.length && orderChannels.length) {
      setServiceModes(orderChannels.map((item) => item.code));
    }
  }, [orderChannels, serviceModes.length]);

  const selectedCountry = centre.countries.find((item) => item.code === location.countryCode);
  const availableSecondary = centre.currencies.filter((item) => item.code !== baseCurrency);
  const progress = Math.round(((step - 1) / 20) * 100);
  const summary = useMemo(
    () => [
      ["Business", centre.profile?.tradingName || "Not set"],
      [
        "Location",
        state.location
          ? `${state.location.city}, ${country?.name ?? state.location.countryCode}`
          : "Not set",
      ],
      ["Base currency", baseCurrency || state.suggestedCurrency?.code || "Not set"],
      ["Secondary currencies", secondaryCurrencies.join(", ") || "None"],
      ["Branch", initialBranch?.name || branchName || "Not set"],
      [
        "Service modes",
        serviceModes.length ? `${serviceModes.length} selected` : "Review in Setup Centre",
      ],
      ["Operational readiness", "Validated separately in Setup Centre"],
    ],
    [
      baseCurrency,
      branchName,
      centre.profile?.tradingName,
      country?.name,
      initialBranch?.name,
      secondaryCurrencies,
      serviceModes.length,
      state.location,
      state.suggestedCurrency?.code,
    ],
  );

  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      const action = step === 20 ? "COMPLETE" : "SAVE";
      await centre.command("/api/seramet/setup/onboarding/step", {
        step,
        action,
        response: responseForStep(),
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Onboarding step could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const back = async () => {
    if (step <= 5) return;
    setBusy(true);
    setMessage("");
    try {
      await centre.command("/api/seramet/setup/onboarding/step", {
        step,
        action: "BACK",
        response: {},
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not return to the previous step");
    } finally {
      setBusy(false);
    }
  };

  const responseForStep = (): Record<string, unknown> => {
    if (step === 5) return location;
    if (step === 6) return { confirmed: true };
    if (step === 7)
      return {
        baseCurrency,
        secondaryCurrencies,
        currencyConfigurations: secondaryCurrencies.map((currencyCode) => ({
          currencyCode,
          paymentEligible: true,
          cashEligible: true,
          digitalPaymentEligible: false,
          exchangeRatePolicy: "MANUAL",
          rateFreshnessMinutes: 1_440,
          roundingPolicy: "HALF_UP",
          changePolicy: "TENDER_CURRENCY",
          branchIds: [],
          paymentMethodIds: [],
        })),
      };
    if (step === 8) return { businessType };
    if (step === 9)
      return { branchId: initialBranch?.id ?? branchId, name: branchName, code: branchCode };
    if (step === 10)
      return { branchId: initialBranch?.id ?? branchId, useBusinessLocation, ...branchLocation };
    if (step === 11) return { operatingHours: hours };
    if (step === 12) {
      const configured = serviceModes.length
        ? serviceModes
        : serviceModeInput
            .split(",")
            .map((value) =>
              value
                .trim()
                .toUpperCase()
                .replace(/[^A-Z0-9_-]/g, "_"),
            )
            .filter(Boolean);
      return { serviceModes: configured };
    }
    if (step === 20) return { confirmed: true };
    return { choice: choice[step] ?? "DO_LATER" };
  };

  return (
    <AppShell
      title="Restaurant onboarding"
      subtitle="A guided start before detailed operational setup"
    >
      <div className="mx-auto w-full max-w-3xl py-2 sm:py-6">
        <div className="mb-4 flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>Step {step} of 20</span>
          <span>{progress}%</span>
        </div>
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <Panel className="overflow-hidden">
          <div className="border-b border-border px-5 py-5 sm:px-7">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-accent text-primary">
              {step <= 7 ? <MapPin className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
            </div>
            <h1 className="text-xl font-bold text-foreground">{stepTitles[step]}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {stepDescription(step, selectedCountry?.name)}
            </p>
          </div>
          <div className="p-5 sm:p-7">{renderStep()}</div>
          {message && (
            <div
              role="alert"
              className="mx-5 mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger sm:mx-7"
            >
              {message}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border px-5 py-4 sm:px-7">
            <Btn onClick={back} disabled={busy || step <= 5}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Btn>
            <Btn variant="primary" onClick={() => void submit()} disabled={busy}>
              {step === 20 ? "Continue to Setup Centre" : "Continue"}
              <ArrowRight className="h-4 w-4" />
            </Btn>
          </div>
        </Panel>
      </div>
    </AppShell>
  );

  function renderStep() {
    if (step === 5)
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>
            Country
            <select
              className={fieldClass}
              value={location.countryCode}
              onChange={(event) =>
                setLocation({
                  ...location,
                  countryCode: event.target.value,
                  administrativeLevel1: "",
                })
              }
              required
            >
              <option value="">Select country</option>
              {centre.countries.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} ({item.callingCode})
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {selectedCountry?.administrativeLevel1Label ?? "Region / state / province"}
            <input
              className={fieldClass}
              value={location.administrativeLevel1}
              onChange={(event) =>
                setLocation({ ...location, administrativeLevel1: event.target.value })
              }
              maxLength={120}
            />
          </label>
          <label className={labelClass}>
            City / town
            <input
              className={fieldClass}
              value={location.city}
              onChange={(event) => setLocation({ ...location, city: event.target.value })}
              maxLength={120}
              required
            />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            Street / building
            <input
              className={fieldClass}
              value={location.addressLine}
              onChange={(event) => setLocation({ ...location, addressLine: event.target.value })}
              maxLength={300}
              required
            />
          </label>
          <label className={labelClass}>
            Postal code <span className="font-normal text-muted-foreground">(optional)</span>
            <input
              className={fieldClass}
              value={location.postalCode}
              onChange={(event) => setLocation({ ...location, postalCode: event.target.value })}
              maxLength={32}
            />
          </label>
        </div>
      );
    if (step === 6)
      return (
        <dl className="divide-y divide-border rounded-md border border-border">
          {[
            ["Country", country?.name ?? state.location?.countryCode],
            [
              country?.administrativeLevel1Label ?? "Region",
              state.location?.administrativeLevel1 || "Not provided",
            ],
            ["City", state.location?.city],
            ["Address", state.location?.addressLine],
          ].map(([label, value]) => (
            <div key={label} className="grid grid-cols-[130px_1fr] gap-3 px-4 py-3 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      );
    if (step === 7)
      return (
        <div className="space-y-5">
          {state.suggestedCurrency && (
            <div className="rounded-md border border-primary/30 bg-accent px-4 py-3 text-sm">
              Based on the confirmed location, Seramet suggests{" "}
              <strong>
                {state.suggestedCurrency.code} - {state.suggestedCurrency.name}
              </strong>
              .
            </div>
          )}
          <label className={labelClass}>
            Primary / base currency
            <select
              className={fieldClass}
              value={baseCurrency}
              onChange={(event) => setBaseCurrency(event.target.value)}
              disabled={!state.canChangeBaseCurrency}
              required
            >
              <option value="">Select currency</option>
              {centre.currencies.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} - {item.name}
                </option>
              ))}
            </select>
          </label>
          {!state.canChangeBaseCurrency && (
            <p className="text-xs text-warning">{state.baseCurrencyLockReason}</p>
          )}
          <div>
            <div className="text-sm font-semibold">Accepted secondary currencies</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. A current authorized rate is still required before foreign tender can be
              accepted.
            </p>
            <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {availableSecondary.map((currency) => {
                const checked = secondaryCurrencies.includes(currency.code);
                return (
                  <label
                    key={currency.code}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSecondaryCurrencies((current) =>
                          checked
                            ? current.filter((code) => code !== currency.code)
                            : [...current, currency.code],
                        )
                      }
                    />
                    <span>
                      <strong>{currency.code}</strong> - {currency.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      );
    if (step === 8)
      return (
        <label className={labelClass}>
          Business type
          <input
            className={fieldClass}
            value={businessType}
            onChange={(event) => setBusinessType(event.target.value)}
            maxLength={80}
            placeholder="Enter the type used by your business"
            required
          />
        </label>
      );
    if (step === 9)
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Branch name
            <input
              className={fieldClass}
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              required
            />
          </label>
          <label className={labelClass}>
            Branch code
            <input
              className={fieldClass}
              value={branchCode}
              onChange={(event) =>
                setBranchCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))
              }
              required
            />
          </label>
        </div>
      );
    if (step === 10)
      return (
        <div className="space-y-4">
          <label className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={useBusinessLocation}
              onChange={(event) => setUseBusinessLocation(event.target.checked)}
            />
            Use the confirmed business location
          </label>
          {!useBusinessLocation && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                City
                <input
                  className={fieldClass}
                  value={branchLocation.city}
                  onChange={(event) =>
                    setBranchLocation({ ...branchLocation, city: event.target.value })
                  }
                />
              </label>
              <label className={labelClass}>
                Address
                <input
                  className={fieldClass}
                  value={branchLocation.addressLine}
                  onChange={(event) =>
                    setBranchLocation({ ...branchLocation, addressLine: event.target.value })
                  }
                />
              </label>
            </div>
          )}
        </div>
      );
    if (step === 11)
      return (
        <div className="space-y-2">
          {Object.entries(hours).map(([day, schedule]) => (
            <div key={day} className="grid grid-cols-[90px_1fr_1fr_auto] items-center gap-2">
              <span className="text-sm font-semibold capitalize">{day}</span>
              <input
                type="time"
                className={fieldClass}
                value={schedule.open}
                disabled={schedule.closed}
                onChange={(event) =>
                  setHours({ ...hours, [day]: { ...schedule, open: event.target.value } })
                }
              />
              <input
                type="time"
                className={fieldClass}
                value={schedule.close}
                disabled={schedule.closed}
                onChange={(event) =>
                  setHours({ ...hours, [day]: { ...schedule, close: event.target.value } })
                }
              />
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={schedule.closed}
                  onChange={(event) =>
                    setHours({ ...hours, [day]: { ...schedule, closed: event.target.checked } })
                  }
                />
                Closed
              </label>
            </div>
          ))}
        </div>
      );
    if (step === 12)
      return orderChannels.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {orderChannels.map((channel) => (
            <label
              key={channel.id}
              className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-sm font-semibold"
            >
              <input
                type="checkbox"
                checked={serviceModes.includes(channel.code)}
                onChange={() =>
                  setServiceModes((current) =>
                    current.includes(channel.code)
                      ? current.filter((code) => code !== channel.code)
                      : [...current, channel.code],
                  )
                }
              />
              {channel.displayName}
            </label>
          ))}
        </div>
      ) : (
        <label className={labelClass}>
          Service mode codes
          <input
            className={fieldClass}
            value={serviceModeInput}
            onChange={(event) => setServiceModeInput(event.target.value)}
            placeholder="Enter the service modes this branch will use"
            required
          />
          <span className="text-xs font-normal text-muted-foreground">
            Separate multiple configured codes with commas. The Setup Centre will validate the
            related operational requirements.
          </span>
        </label>
      );
    if (step === 20)
      return (
        <dl className="divide-y divide-border rounded-md border border-border">
          {summary.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[150px_1fr] gap-3 px-4 py-3 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      );
    const selected = choice[step] ?? "DO_LATER";
    const configuredCount = step === 14 ? paymentMethods.length : undefined;
    return (
      <div className="space-y-3">
        <ChoiceButton
          selected={selected === "CONFIGURE_NOW"}
          label="Configure in Setup Centre"
          detail={
            configuredCount === undefined
              ? "Continue with detailed configuration after onboarding."
              : `${configuredCount} payment method configuration(s) currently available.`
          }
          onClick={() => setChoice({ ...choice, [step]: "CONFIGURE_NOW" })}
        />
        <ChoiceButton
          selected={selected === "DO_LATER"}
          label="Do this later"
          detail="This will remain visible in production readiness and will not create sample data."
          onClick={() => setChoice({ ...choice, [step]: "DO_LATER" })}
        />
      </div>
    );
  }
}

function ChoiceButton({
  selected,
  label,
  detail,
  onClick,
}: {
  selected: boolean;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-md border px-4 py-3 text-left ${selected ? "border-primary bg-accent" : "border-border bg-card hover:bg-secondary"}`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function stepDescription(step: number, country?: string) {
  if (step === 5) return "Select the country by name, then enter the address you can confirm.";
  if (step === 6) return "Location suggestions become authoritative only after your confirmation.";
  if (step === 7)
    return country
      ? `The domestic currency is suggested from ${country}; secondary tenders remain optional.`
      : "Choose one accounting currency and optional secondary tender currencies.";
  if (step === 20) return "Onboarding completion is separate from production go-live readiness.";
  return "Complete one decision now. Detailed controls remain in the Setup Centre.";
}

function responseText(responses: Record<string, unknown>, step: number, key: string) {
  const response = responses[String(step)];
  return response && typeof response === "object" && !Array.isArray(response)
    ? String((response as Record<string, unknown>)[key] ?? "")
    : "";
}

function defaultHours() {
  return Object.fromEntries(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [
      day,
      { open: "08:00", close: "22:00", closed: false },
    ]),
  ) as Record<string, { open: string; close: string; closed: boolean }>;
}
