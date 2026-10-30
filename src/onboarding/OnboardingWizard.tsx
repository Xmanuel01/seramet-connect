import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Building2, Check, Loader2, MapPin, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import {
  ONBOARDING_REVIEW_STEP,
  ONBOARDING_STEP_COUNT,
  businessTypePresets,
  onboardingStep,
  paymentMethodPresets,
  serviceModePresets,
  weekDays,
  type BusinessTypePreset,
  type StationPreset,
} from "@/onboarding/onboarding-steps";
import type { useSetupCentre } from "@/onboarding/use-setup-centre";
import { staffRolePresets } from "@/platform/staff-role-presets";

type Centre = ReturnType<typeof useSetupCentre>;
type Hours = Record<string, { open: string; close: string; closed: boolean }>;
type TeamMember = { name: string; role: string; code: string };

const fieldClass =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary";
const labelClass = "grid min-w-0 gap-1.5 text-sm font-semibold text-foreground";
const reason = "Configured during guided restaurant onboarding";
const stationTypes: StationPreset["stationType"][] = [
  "KITCHEN",
  "GRILL",
  "FRYER",
  "BAR",
  "COFFEE",
  "DESSERT",
  "PASS",
  "DISPATCH",
];
const kitchenRoles: Record<string, StationPreset["stationType"][]> = {
  chef: ["KITCHEN", "GRILL", "FRYER", "DESSERT", "PASS"],
  headChef: ["KITCHEN", "GRILL", "FRYER", "DESSERT", "PASS"],
  bartender: ["BAR", "COFFEE"],
};

export function OnboardingWizard({ centre }: { centre: Centre }) {
  const { activeTenantId, branchId, platformState, refreshConfiguration } = useAppContext();
  const state = centre.onboarding!;
  const step = state.currentStep;
  const stepId = onboardingStep(step)?.id ?? "review";
  const saved = (stepNumber: number) => record(state.responses[String(stepNumber)]);
  const initialBranch =
    centre.structure.branches.find((item) => item.id === branchId) ?? centre.structure.branches[0];
  const onboardingBranchId = initialBranch?.id ?? branchId;
  const channels = platformState.orderChannels.filter((item) => item.tenantId === activeTenantId);
  const methods = platformState.paymentMethods.filter((item) => item.tenantId === activeTenantId);
  const branchStations = centre.options.stations.filter(
    (row) => text(row["branch_id"]) === onboardingBranchId && Number(row["active"]) === 1,
  );
  // Older servers and fixtures may omit the list; treat that as no rules yet.
  const taxRules = centre.options.taxRules ?? [];
  const vatRule = taxRules.find((row) => text(row["rule_type"]) === "TAX");
  const serviceRule = taxRules.find((row) => text(row["rule_type"]) === "SERVICE_CHARGE");

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [location, setLocation] = useState({
    countryCode: state.location?.countryCode ?? text(saved(1)?.["countryCode"]),
    administrativeLevel1: state.location?.administrativeLevel1 ?? "",
    administrativeLevel2: state.location?.administrativeLevel2 ?? "",
    city: state.location?.city ?? "",
    addressLine: state.location?.addressLine ?? "",
    postalCode: state.location?.postalCode ?? "",
  });
  const [locationConfirmed, setLocationConfirmed] = useState(
    state.location?.status === "CONFIRMED",
  );
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
  const [businessType, setBusinessType] = useState(text(saved(3)?.["businessType"]));
  const [trackStock, setTrackStock] = useState(saved(3)?.["trackStock"] === true);
  const [standardAccounts, setStandardAccounts] = useState(true);
  const preset: BusinessTypePreset =
    businessTypePresets[businessType] ?? businessTypePresets.OTHER!;
  const [branchName, setBranchName] = useState(initialBranch?.name ?? "");
  const [branchCode, setBranchCode] = useState(initialBranch?.code ?? "");
  const [useBusinessLocation, setUseBusinessLocation] = useState(
    saved(4)?.["useBusinessLocation"] !== false,
  );
  const [branchLocation, setBranchLocation] = useState({
    city: text(saved(4)?.["city"]),
    addressLine: text(saved(4)?.["addressLine"]),
  });
  const [hours, setHours] = useState<Hours>(
    () => savedHours(saved(5)?.["operatingHours"]) ?? presetHours(preset),
  );
  const [serviceModes, setServiceModes] = useState<string[]>(() => {
    // Only the modes shown as checkboxes; anything else would be saved without being visible.
    const known = (codes: string[]) =>
      codes.filter((code) => serviceModePresets.some((mode) => mode.code === code));
    const previous = known(stringArray(saved(6)?.["serviceModes"]));
    if (previous.length) return previous;
    const active = known(channels.filter((item) => item.enabled).map((item) => item.code));
    return active.length ? active : preset.serviceModes;
  });
  const [tax, setTax] = useState(() => taxForm(vatRule, serviceRule, saved(7)));
  const [paymentCodes, setPaymentCodes] = useState<string[]>([]);
  const [stationCodes, setStationCodes] = useState<string[]>([]);
  const [customStations, setCustomStations] = useState<StationPreset[]>([]);
  const [customStation, setCustomStation] = useState({ name: "", stationType: "KITCHEN" });
  const [menuItem, setMenuItem] = useState({ name: "", category: "", price: "", station: "" });
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [member, setMember] = useState({ name: "", role: "cashier", code: "", pin: "", email: "" });

  // Business type pre-fills later steps until the owner saves their own answers there.
  useEffect(() => {
    if (!saved(5)) setHours(presetHours(preset));
    if (!saved(6) && !channels.some((item) => item.enabled)) setServiceModes(preset.serviceModes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessType]);

  useEffect(() => {
    if (!baseCurrency && state.suggestedCurrency) setBaseCurrency(state.suggestedCurrency.code);
  }, [baseCurrency, state.suggestedCurrency]);

  // Steps backed by records start from what already exists each time they are opened.
  useEffect(() => {
    setMessage("");
    if (stepId === "tax") setTax(taxForm(vatRule, serviceRule, saved(7)));
    if (stepId === "payments") {
      const active = methods.filter((item) => item.enabled).map((item) => item.code);
      setPaymentCodes(active.length ? active : ["CASH"]);
    }
    if (stepId === "stations") {
      setStationCodes(branchStations.length ? [] : preset.stations.map((station) => station.code));
      setCustomStations([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  const country = centre.countries.find((item) => item.code === location.countryCode);
  const availableSecondary = centre.currencies.filter((item) => item.code !== baseCurrency);
  const progress = Math.round(
    (state.completedSteps.filter((n) => n < ONBOARDING_REVIEW_STEP).length /
      (ONBOARDING_STEP_COUNT - 1)) *
      100,
  );
  const stationSuggestions = preset.stations.filter(
    (station) => !branchStations.some((row) => text(row["code"]) === station.code),
  );

  const summary = useMemo(
    () => [
      ["Business", centre.profile?.tradingName || "Not set"],
      [
        "Location",
        state.location
          ? `${state.location.city}, ${country?.name ?? state.location.countryCode}`
          : "Not set",
      ],
      ["Currency", baseCurrency || "Not set"],
      ["Business type", businessTypePresets[businessType]?.label ?? "Not set"],
      ["Stock tracking", trackStock ? "From day one" : "Later, in Setup Centre"],
      ["Branch", initialBranch?.name || "Not set"],
      ["Opening hours", hoursSummary(savedHours(saved(5)?.["operatingHours"]) ?? hours)],
      [
        "Service modes",
        channels
          .filter((item) => item.enabled)
          .map((item) => item.displayName)
          .join(", ") || "None",
      ],
      [
        "Tax",
        [
          vatRule ? `VAT ${percent(vatRule["rate_bps"])}%` : "",
          serviceRule ? `service charge ${percent(serviceRule["rate_bps"])}%` : "",
        ]
          .filter(Boolean)
          .join(", ") || "No tax charged",
      ],
      [
        "Payment methods",
        methods
          .filter((item) => item.enabled)
          .map((item) => item.displayName)
          .join(", ") || "None",
      ],
      ["Stations", branchStations.map((row) => text(row["name"])).join(", ") || "None"],
      ["Menu items", String(centre.menuCatalog.length)],
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      baseCurrency,
      branchStations,
      businessType,
      centre.menuCatalog.length,
      centre.profile?.tradingName,
      channels,
      country?.name,
      initialBranch?.name,
      methods,
      serviceRule,
      state.location,
      vatRule,
    ],
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      const response = await prepareStep();
      await centre.saveOnboardingStep({
        step,
        action: step === ONBOARDING_REVIEW_STEP ? "COMPLETE" : "SAVE",
        response,
      });
    });

  const back = () =>
    run(async () => {
      if (step <= 1) return;
      await centre.saveOnboardingStep({ step, action: "BACK", response: {} });
    });

  // Creates the records a step needs, then returns the response the server validates.
  async function prepareStep(): Promise<Record<string, unknown>> {
    switch (stepId) {
      case "location":
        return { ...location, confirmed: locationConfirmed };
      case "currency":
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
      case "businessType":
        if (!businessType) throw new Error("Choose the type of business");
        return { businessType, trackStock };
      case "branch":
        return {
          branchId: onboardingBranchId,
          name: branchName,
          code: branchCode,
          useBusinessLocation,
          ...(useBusinessLocation ? {} : branchLocation),
        };
      case "hours":
        return { operatingHours: hours };
      case "serviceModes":
        for (const code of serviceModes) {
          const existing = channels.find((item) => item.code === code);
          const definition = serviceModePresets.find((item) => item.code === code);
          if (!existing && definition) {
            await centre.send("/api/seramet/configuration/order-channels", {
              displayName: definition.displayName,
              code,
              channelType: definition.channelType,
              useOnlinePrice: definition.channelType === "MARKETPLACE",
              reason,
            });
          } else if (existing && !existing.enabled) {
            await centre.send(
              `/api/seramet/configuration/order-channels/${encodeURIComponent(existing.id)}`,
              { enabled: true, reason },
              "PATCH",
            );
          }
        }
        await refreshConfiguration();
        return { serviceModes };
      case "tax":
        await saveTaxRule("TAX", "VAT", "VAT", tax.chargeVat, tax.vatPercent, tax.vatMode, vatRule);
        await saveTaxRule(
          "SERVICE_CHARGE",
          "SERVICE",
          "Service charge",
          tax.chargeService,
          tax.servicePercent,
          tax.serviceMode,
          serviceRule,
        );
        await centre.refreshOptions();
        return { noTax: !tax.chargeVat && !tax.chargeService };
      case "payments":
        if (!paymentCodes.length) throw new Error("Choose at least one payment method");
        for (const definition of paymentMethodPresets) {
          const existing = methods.find((item) => item.code === definition.code);
          const wanted = paymentCodes.includes(definition.code);
          if (wanted && !existing) {
            await centre.send("/api/seramet/configuration/payment-methods", {
              displayName: definition.displayName,
              code: definition.code,
              category: definition.category,
              reason,
            });
          } else if (existing && existing.enabled !== wanted) {
            await centre.send(
              `/api/seramet/configuration/payment-methods/${encodeURIComponent(existing.id)}`,
              { enabled: wanted, reason },
              "PATCH",
            );
          }
        }
        await refreshConfiguration();
        return {};
      case "stations":
        for (const station of [
          ...stationSuggestions.filter((item) => stationCodes.includes(item.code)),
          ...customStations,
        ]) {
          await centre.send("/api/seramet/setup/stations", {
            branchId: onboardingBranchId,
            ...station,
          });
        }
        await centre.refreshOptions();
        return {};
      case "menu":
        return { later: centre.menuCatalog.length === 0 };
      case "team":
        return {};
      default:
        return { confirmed: true, standardAccounts };
    }
  }

  async function saveTaxRule(
    ruleType: "TAX" | "SERVICE_CHARGE",
    code: string,
    name: string,
    charge: boolean,
    rate: string,
    calculationMode: string,
    existing?: Record<string, unknown>,
  ) {
    if (!charge && !existing) return;
    const rateBps = charge ? percentToBps(rate, name) : Number(existing?.["rate_bps"] ?? 0);
    await centre.send("/api/seramet/setup/tax-service-rules", {
      ...(existing ? { id: text(existing["id"]) } : {}),
      ruleType,
      code: existing ? text(existing["code"]) : code,
      name: existing ? text(existing["name"]) : name,
      rateBps,
      calculationMode,
      effectiveFrom: existing ? text(existing["effective_from"]) : today(),
      active: charge,
    });
  }

  const addMenuItem = () =>
    run(async () => {
      if (!menuItem.name.trim() || !menuItem.category.trim())
        throw new Error("Enter the item name and its category");
      if (!/^\d+(?:\.\d{1,3})?$/.test(menuItem.price.trim()))
        throw new Error("Enter the price as a number, for example 450 or 450.50");
      await centre.createManualMenuItem({
        branchId: onboardingBranchId,
        requestKey: `onboarding-item-${crypto.randomUUID()}`,
        code: codeFrom(menuItem.name, 6),
        name: menuItem.name.trim(),
        categoryCode: codeFrom(menuItem.category, 0),
        basePrice: menuItem.price.trim(),
        currency: baseCurrency,
        ...(menuItem.station ? { stationCode: menuItem.station } : {}),
      });
      setMenuItem({ ...menuItem, name: "", price: "" });
    });

  const addTeamMember = () =>
    run(async () => {
      const role = staffRolePresets[member.role];
      if (!role) throw new Error("Choose a role");
      if (member.name.trim().length < 2) throw new Error("Enter the person's full name");
      if (!/^\d{6}$/.test(member.pin))
        throw new Error("Enter a 6-digit temporary PIN they will replace at first sign-in");
      const roleId = await ensureRole(role.label, role.permissions);
      const employeeCode = member.code.trim() || codeFrom(member.name, 3);
      const created = await centre.send<{ employee: { id: string } }>("/api/seramet/employees", {
        idempotencyKey: `onboarding-employee-${crypto.randomUUID()}`,
        fullName: member.name.trim(),
        employeeCode,
        jobTitle: role.label,
        roleId,
        assignedBranchIds: [onboardingBranchId],
        primaryBranchId: onboardingBranchId,
        pin: member.pin,
        pinConfirmation: member.pin,
        effectiveFrom: new Date().toISOString(),
        temporaryPin: true,
        ...(member.email.trim() ? { email: member.email.trim() } : {}),
      });
      const stationTypesForRole = kitchenRoles[member.role];
      const stationIds = branchStations
        .filter((row) => stationTypesForRole?.includes(text(row["station_type"]) as never))
        .map((row) => text(row["id"]));
      if (stationIds.length) {
        await centre.send(
          `/api/seramet/employees/${encodeURIComponent(created.employee.id)}/stations`,
          { branchId: onboardingBranchId, stationIds, expectedVersion: 0 },
          "PUT",
        );
      }
      await centre.refreshOptions();
      setTeam((current) => [
        ...current,
        { name: member.name.trim(), role: role.label, code: employeeCode },
      ]);
      setMember({ name: "", role: member.role, code: "", pin: "", email: "" });
    });

  async function ensureRole(name: string, permissionCodes: string[]) {
    const existing = centre.options.roles.find(
      (row) => text(row["name"]) === name && Number(row["active"]) === 1,
    );
    if (existing) return text(existing["id"]);
    // New roles get the preset's permissions; existing roles keep whatever the owner set.
    const created = await centre.send<{ role: { id: string } }>(
      "/api/seramet/configuration/roles",
      { name, reason },
    );
    await centre.send(
      `/api/seramet/access/roles/${encodeURIComponent(created.role.id)}/permissions`,
      { permissions: permissionCodes, reason },
      "PUT",
    );
    return created.role.id;
  }

  const definition = onboardingStep(step);
  const continueLabel =
    step === ONBOARDING_REVIEW_STEP
      ? "Finish and open Setup Centre"
      : stepId === "menu" && centre.menuCatalog.length === 0
        ? "Set up menu later"
        : stepId === "team" && team.length === 0
          ? "Skip for now"
          : "Continue";

  return (
    <AppShell
      title="Restaurant onboarding"
      subtitle="A guided start before detailed operational setup"
    >
      <div className="mx-auto w-full max-w-3xl py-2 sm:py-6">
        <div className="mb-4 flex items-center justify-between text-xs font-semibold text-muted-foreground">
          <span>
            Step {step} of {ONBOARDING_STEP_COUNT}
          </span>
          <span>{progress}% complete</span>
        </div>
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <Panel className="overflow-hidden">
          <div className="border-b border-border px-5 py-5 sm:px-7">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-accent text-primary">
              {step <= 2 ? <MapPin className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
            </div>
            <h1 className="text-xl font-bold text-foreground">{definition?.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {stepId === "currency" && country
                ? `The domestic currency is suggested from ${country.name}; foreign tenders are optional.`
                : definition?.description}
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
            <Btn onClick={() => void back()} disabled={busy || step <= 1}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Btn>
            <Btn variant="primary" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
              {busy ? "Saving..." : continueLabel}
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </Btn>
          </div>
        </Panel>
      </div>
    </AppShell>
  );

  function renderStep() {
    switch (stepId) {
      case "location":
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={`${labelClass} sm:col-span-2`}>
              Country
              <select
                className={fieldClass}
                value={location.countryCode}
                onChange={(event) => {
                  setLocation({
                    ...location,
                    countryCode: event.target.value,
                    administrativeLevel1: "",
                  });
                  setLocationConfirmed(false);
                }}
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
              {country?.administrativeLevel1Label ?? "Region / state / province"}
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
            <label className="flex items-start gap-3 rounded-md border border-border px-4 py-3 text-sm font-semibold sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={locationConfirmed}
                onChange={(event) => setLocationConfirmed(event.target.checked)}
              />
              <span>
                This address is correct
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Your country sets the time zone, language and suggested currency.
                </span>
              </span>
            </label>
          </div>
        );
      case "currency":
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
              <div className="text-sm font-semibold">Accepted foreign currencies</div>
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
                          setSecondaryCurrencies((current) => toggle(current, currency.code))
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
      case "businessType":
        return (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(businessTypePresets).map(([key, value]) => (
                <ChoiceButton
                  key={key}
                  selected={businessType === key}
                  label={value.label}
                  detail={value.detail}
                  onClick={() => setBusinessType(key)}
                />
              ))}
            </div>
            <div>
              <div className="text-sm font-semibold">Stock and recipe tracking</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <ChoiceButton
                  selected={!trackStock}
                  label="Start selling first (recommended)"
                  detail="Turn on stock, recipes and opening stock later in Setup Centre."
                  onClick={() => setTrackStock(false)}
                />
                <ChoiceButton
                  selected={trackStock}
                  label="Track stock from day one"
                  detail="Add inventory items, recipes and opening stock before going live."
                  onClick={() => setTrackStock(true)}
                />
              </div>
            </div>
          </div>
        );
      case "branch":
        return (
          <div className="space-y-4">
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
                <span className="text-xs font-normal text-muted-foreground">
                  Short code printed on receipts, for example MAIN.
                </span>
              </label>
            </div>
            <label className="flex items-center gap-3 rounded-md border border-border px-4 py-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={useBusinessLocation}
                onChange={(event) => setUseBusinessLocation(event.target.checked)}
              />
              This branch is at the business address
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
      case "hours":
        return (
          <div className="space-y-2">
            {weekDays.map((day) => {
              const schedule = hours[day]!;
              return (
                <div key={day} className="grid grid-cols-[90px_1fr_1fr_auto] items-center gap-2">
                  <span className="text-sm font-semibold capitalize">{day}</span>
                  <input
                    type="time"
                    aria-label={`${day} opens`}
                    className={fieldClass}
                    value={schedule.open}
                    disabled={schedule.closed}
                    onChange={(event) =>
                      setHours({ ...hours, [day]: { ...schedule, open: event.target.value } })
                    }
                  />
                  <input
                    type="time"
                    aria-label={`${day} closes`}
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
              );
            })}
            <p className="pt-1 text-xs text-muted-foreground">
              A closing time earlier than the opening time means you trade past midnight.
            </p>
          </div>
        );
      case "serviceModes":
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            {serviceModePresets.map((mode) => (
              <CheckCard
                key={mode.code}
                checked={serviceModes.includes(mode.code)}
                label={mode.displayName}
                onChange={() => setServiceModes((current) => toggle(current, mode.code))}
              />
            ))}
            {channels
              .filter((item) => !serviceModePresets.some((mode) => mode.code === item.code))
              .map((item) => (
                <CheckCard
                  key={item.code}
                  checked={serviceModes.includes(item.code)}
                  label={item.displayName}
                  onChange={() => setServiceModes((current) => toggle(current, item.code))}
                />
              ))}
          </div>
        );
      case "tax":
        return (
          <div className="space-y-4">
            <RateRow
              label="We charge VAT / sales tax"
              detail="Use the rate on your tax registration."
              checked={tax.chargeVat}
              rate={tax.vatPercent}
              mode={tax.vatMode}
              onToggle={(chargeVat) => setTax({ ...tax, chargeVat })}
              onRate={(vatPercent) => setTax({ ...tax, vatPercent })}
              onMode={(vatMode) => setTax({ ...tax, vatMode })}
            />
            <RateRow
              label="We add a service charge"
              detail="Applied to menu items marked as service-charge applicable."
              checked={tax.chargeService}
              rate={tax.servicePercent}
              mode={tax.serviceMode}
              onToggle={(chargeService) => setTax({ ...tax, chargeService })}
              onRate={(servicePercent) => setTax({ ...tax, servicePercent })}
              onMode={(serviceMode) => setTax({ ...tax, serviceMode })}
            />
            <p className="text-xs text-muted-foreground">
              Seramet does not assume a rate. Confirm rates with your accountant; you can change
              them later in Setup Centre.
            </p>
          </div>
        );
      case "payments":
        return (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {paymentMethodPresets.map((method) => (
                <CheckCard
                  key={method.code}
                  checked={paymentCodes.includes(method.code)}
                  label={method.displayName}
                  onChange={() => setPaymentCodes((current) => toggle(current, method.code))}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Cashiers record these payments manually. Automatic M-Pesa prompts and card terminals
              are connected later under Integrations.
            </p>
          </div>
        );
      case "stations":
        return (
          <div className="space-y-4">
            {branchStations.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {branchStations.map((row) => (
                  <span
                    key={text(row["id"])}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-sm font-semibold"
                  >
                    <Check className="h-3.5 w-3.5 text-primary" /> {text(row["name"])}
                  </span>
                ))}
              </div>
            )}
            {stationSuggestions.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {stationSuggestions.map((station) => (
                  <CheckCard
                    key={station.code}
                    checked={stationCodes.includes(station.code)}
                    label={`Add ${station.name}`}
                    onChange={() => setStationCodes((current) => toggle(current, station.code))}
                  />
                ))}
              </div>
            )}
            {customStations.map((station) => (
              <div key={station.code} className="text-sm text-muted-foreground">
                Will add <strong className="text-foreground">{station.name}</strong> (
                {station.stationType.toLowerCase()})
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-[1fr_160px_auto]">
              <input
                className={fieldClass}
                placeholder="Another station, e.g. Grill"
                value={customStation.name}
                onChange={(event) =>
                  setCustomStation({ ...customStation, name: event.target.value })
                }
              />
              <select
                className={fieldClass}
                value={customStation.stationType}
                onChange={(event) =>
                  setCustomStation({ ...customStation, stationType: event.target.value })
                }
              >
                {stationTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0) + type.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <Btn
                onClick={() => {
                  const name = customStation.name.trim();
                  if (name.length < 2) return setMessage("Enter the station name");
                  setCustomStations((current) => [
                    ...current,
                    {
                      code: codeFrom(name, 0),
                      name,
                      stationType: customStation.stationType as StationPreset["stationType"],
                    },
                  ]);
                  setCustomStation({ ...customStation, name: "" });
                }}
              >
                <Plus className="h-4 w-4" /> Add
              </Btn>
            </div>
          </div>
        );
      case "menu":
        return (
          <div className="space-y-4">
            {centre.menuCatalog.length > 0 && (
              <div className="rounded-md border border-border">
                {centre.menuCatalog.slice(0, 8).map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between border-b border-border px-4 py-2 text-sm last:border-b-0"
                  >
                    <span className="font-semibold">{item.name}</span>
                    <span className="text-muted-foreground">
                      {item.currency} {(item.selling_price_minor / 100).toFixed(2)}
                    </span>
                  </div>
                ))}
                {centre.menuCatalog.length > 8 && (
                  <div className="px-4 py-2 text-xs text-muted-foreground">
                    and {centre.menuCatalog.length - 8} more
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Item name
                <input
                  className={fieldClass}
                  value={menuItem.name}
                  onChange={(event) => setMenuItem({ ...menuItem, name: event.target.value })}
                  maxLength={160}
                />
              </label>
              <label className={labelClass}>
                Category
                <input
                  className={fieldClass}
                  placeholder="e.g. Mains"
                  value={menuItem.category}
                  onChange={(event) => setMenuItem({ ...menuItem, category: event.target.value })}
                  maxLength={40}
                />
              </label>
              <label className={labelClass}>
                Price ({baseCurrency || "base currency"})
                <input
                  className={fieldClass}
                  inputMode="decimal"
                  value={menuItem.price}
                  onChange={(event) => setMenuItem({ ...menuItem, price: event.target.value })}
                />
              </label>
              <label className={labelClass}>
                Prepared at
                <select
                  className={fieldClass}
                  value={menuItem.station}
                  onChange={(event) => setMenuItem({ ...menuItem, station: event.target.value })}
                >
                  <option value="">No preparation (ready to serve)</option>
                  {branchStations.map((row) => (
                    <option key={text(row["id"])} value={text(row["code"])}>
                      {text(row["name"])}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Btn onClick={() => void addMenuItem()} disabled={busy}>
                <Plus className="h-4 w-4" /> Add item
              </Btn>
              <Link
                to="/menu-import"
                className="text-sm font-semibold text-primary hover:underline"
              >
                Import a full menu file instead
              </Link>
            </div>
          </div>
        );
      case "team":
        return (
          <div className="space-y-4">
            {team.map((person) => (
              <div
                key={person.code}
                className="flex items-center justify-between rounded-md border border-border px-4 py-2 text-sm"
              >
                <span className="font-semibold">{person.name}</span>
                <span className="text-muted-foreground">
                  {person.role} · code {person.code}
                </span>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Full name
                <input
                  className={fieldClass}
                  value={member.name}
                  onChange={(event) => setMember({ ...member, name: event.target.value })}
                />
              </label>
              <label className={labelClass}>
                Role
                <select
                  className={fieldClass}
                  value={member.role}
                  onChange={(event) => setMember({ ...member, role: event.target.value })}
                >
                  {Object.entries(staffRolePresets).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Temporary 6-digit PIN
                <input
                  className={fieldClass}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={member.pin}
                  onChange={(event) =>
                    setMember({ ...member, pin: event.target.value.replace(/\D/g, "") })
                  }
                />
                <span className="text-xs font-normal text-muted-foreground">
                  They replace it the first time they sign in to the POS.
                </span>
              </label>
              <label className={labelClass}>
                Email <span className="font-normal text-muted-foreground">(optional)</span>
                <input
                  className={fieldClass}
                  type="email"
                  value={member.email}
                  onChange={(event) => setMember({ ...member, email: event.target.value })}
                />
              </label>
            </div>
            <Btn onClick={() => void addTeamMember()} disabled={busy}>
              <Plus className="h-4 w-4" /> Add team member
            </Btn>
          </div>
        );
      default:
        return (
          <div className="space-y-5">
            <dl className="divide-y divide-border rounded-md border border-border">
              {summary.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[150px_1fr] gap-3 px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <label className="flex items-start gap-3 rounded-md border border-border px-4 py-3 text-sm font-semibold">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={standardAccounts}
                onChange={(event) => setStandardAccounts(event.target.checked)}
              />
              <span>
                Use Seramet&apos;s standard restaurant chart of accounts
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Needed for bills to post to your books. Ticking this records your approval as the
                  owner; your accountant can change accounts later in Setup Centre. Default kitchen
                  ticket, bill, receipt and invoice layouts are also created.
                </span>
              </span>
            </label>
            <div>
              <div className="text-sm font-semibold">Next up in Setup Centre</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["/seramet-setup", "Activate tills and kitchen screens"],
                    ["/seramet-printers", "Connect receipt and kitchen printers"],
                    ...(trackStock
                      ? ([["/inventory-items", "Add inventory and opening stock"]] as const)
                      : []),
                    ["/menu-import", "Import the rest of your menu"],
                  ] as const
                ).map(([to, label]) => (
                  <Link
                    key={to}
                    to={to}
                    className="rounded-md border border-border bg-card px-4 py-3 text-sm font-semibold hover:bg-secondary"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        );
    }
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

function CheckCard({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-4 py-3 text-sm font-semibold">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function RateRow({
  label,
  detail,
  checked,
  rate,
  mode,
  onToggle,
  onRate,
  onMode,
}: {
  label: string;
  detail: string;
  checked: boolean;
  rate: string;
  mode: string;
  onToggle: (value: boolean) => void;
  onRate: (value: string) => void;
  onMode: (value: string) => void;
}) {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <label className="flex items-start gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>
          {label}
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{detail}</span>
        </span>
      </label>
      {checked && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Rate (%)
            <input
              className={fieldClass}
              inputMode="decimal"
              value={rate}
              onChange={(event) => onRate(event.target.value)}
            />
          </label>
          <label className={labelClass}>
            Prices on the menu
            <select
              className={fieldClass}
              value={mode}
              onChange={(event) => onMode(event.target.value)}
            >
              <option value="INCLUSIVE">Already include it</option>
              <option value="EXCLUSIVE">Have it added at the till</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function taxForm(
  vat: Record<string, unknown> | undefined,
  service: Record<string, unknown> | undefined,
  previous: Record<string, unknown> | undefined,
) {
  return {
    chargeVat: vat ? true : previous?.["noTax"] !== true,
    vatPercent: vat ? percent(vat["rate_bps"]) : "",
    vatMode: vat ? text(vat["calculation_mode"]) : "INCLUSIVE",
    chargeService: Boolean(service),
    servicePercent: service ? percent(service["rate_bps"]) : "",
    serviceMode: service ? text(service["calculation_mode"]) : "EXCLUSIVE",
  };
}

function presetHours(preset: BusinessTypePreset): Hours {
  return Object.fromEntries(
    weekDays.map((day) => [day, { open: preset.open, close: preset.close, closed: false }]),
  );
}

function savedHours(value: unknown): Hours | undefined {
  const hours = record(value);
  if (!hours || !weekDays.every((day) => record(hours[day]))) return undefined;
  return Object.fromEntries(
    weekDays.map((day) => {
      const entry = record(hours[day])!;
      return [
        day,
        {
          open: text(entry["open"]),
          close: text(entry["close"]),
          closed: entry["closed"] === true,
        },
      ];
    }),
  );
}

function hoursSummary(hours: Hours) {
  const open = weekDays.filter((day) => !hours[day]?.closed);
  if (!open.length) return "Closed";
  const first = hours[open[0]!]!;
  const same = open.every(
    (day) => hours[day]!.open === first.open && hours[day]!.close === first.close,
  );
  const days = open.length === 7 ? "Every day" : `${open.length} days a week`;
  return same ? `${days}, ${first.open}–${first.close}` : `${days}, varying hours`;
}

function percentToBps(value: string, label: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error(`Enter the ${label} rate as a percentage, for example 16`);
  const bps = Math.round(Number(normalized) * 100);
  if (bps <= 0 || bps > 10_000) throw new Error(`The ${label} rate must be between 0 and 100%`);
  return bps;
}

function percent(bps: unknown) {
  const value = Number(bps ?? 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Upper-case code from a name, with an optional random suffix to keep codes unique. */
function codeFrom(name: string, suffixLength: number) {
  const base =
    name
      .toUpperCase()
      .normalize("NFKD")
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "ITEM";
  const suffix = suffixLength
    ? `-${crypto.randomUUID().replace(/-/g, "").slice(0, suffixLength).toUpperCase()}`
    : "";
  return `${base.length < 2 ? `${base}X` : base}${suffix}`;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function toggle(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
