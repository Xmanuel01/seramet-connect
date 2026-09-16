import type { ServerActor } from "@/lib/seramet-auth";
import type { PermissionCode } from "@/platform/types";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { PaymentMethodCategory } from "@/platform/types";
import { parseMajorAmount } from "@/payments/money";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import type {
  AcceptedCurrency,
  BusinessLocation,
  CountryReference,
  CurrencyReference,
  FxPaymentQuote,
  ManualFxRateInput,
  OnboardingStepInput,
  OnboardingWizardState,
} from "@/onboarding/location-currency-types";

type DbRow = Record<string, unknown>;

const requiredOnboardingSteps = [5, 6, 7, 8, 9, 10, 11, 12] as const;

export class LocationCurrencyService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async listReferences() {
    this.require(permissions.setupView);
    const [countries, currencies] = await Promise.all([
      this.db
        .prepare(
          `SELECT code,name,administrative_level_1_label,default_currency_code,calling_code,
                  default_timezone,default_locale
           FROM country_reference WHERE active=1 ORDER BY name`,
        )
        .all<DbRow>(),
      this.db
        .prepare(
          "SELECT code,name,symbol,minor_digits FROM currency_reference WHERE active=1 ORDER BY name",
        )
        .all<DbRow>(),
    ]);
    return {
      countries: (countries.results ?? []).map(mapCountry),
      currencies: (currencies.results ?? []).map(mapCurrency),
    };
  }

  async getOnboardingState(): Promise<OnboardingWizardState> {
    this.require(permissions.setupView);
    const progress = await this.db
      .prepare(
        `SELECT current_step,status,completed_steps_json,responses_json,version
         FROM onboarding_wizard_progress WHERE tenant_id=?`,
      )
      .bind(this.actor.tenantId)
      .first<DbRow>();
    if (!progress) throw notFound("Onboarding progress was not initialized");
    const location = await this.db
      .prepare(
        `SELECT country_code,administrative_level_1,administrative_level_2,city,address_line,
                postal_code,latitude_microdegrees,longitude_microdegrees,status
         FROM tenant_business_locations WHERE tenant_id=?`,
      )
      .bind(this.actor.tenantId)
      .first<DbRow>();
    const suggestedCurrency = location
      ? await this.db
          .prepare(
            `SELECT c.code,c.name,c.symbol,c.minor_digits
             FROM country_reference r JOIN currency_reference c ON c.code=r.default_currency_code
             WHERE r.code=? AND r.active=1 AND c.active=1`,
          )
          .bind(text(location["country_code"]))
          .first<DbRow>()
      : null;
    const canChangeBaseCurrency = !(await this.hasFinancialActivity());
    return {
      currentStep: integer(progress["current_step"]),
      status: text(progress["status"]) as OnboardingWizardState["status"],
      completedSteps: parseNumberArray(text(progress["completed_steps_json"])),
      responses: parseObject(text(progress["responses_json"])),
      version: integer(progress["version"]),
      location: location ? mapLocation(location) : null,
      suggestedCurrency: suggestedCurrency ? mapCurrency(suggestedCurrency) : null,
      acceptedCurrencies: await this.listAcceptedCurrencies(),
      canChangeBaseCurrency,
      baseCurrencyLockReason: canChangeBaseCurrency
        ? null
        : "Base currency is locked because authoritative financial activity exists.",
    };
  }

  async saveOnboardingStep(input: OnboardingStepInput) {
    this.require(permissions.setupManage);
    const current = await this.db
      .prepare(
        `SELECT current_step,status,completed_steps_json,responses_json,version
         FROM onboarding_wizard_progress WHERE tenant_id=?`,
      )
      .bind(this.actor.tenantId)
      .first<DbRow>();
    if (!current) throw notFound("Onboarding progress was not initialized");
    if (text(current["status"]) === "COMPLETED" && input.action !== "BACK") {
      throw invalidTransition("Completed onboarding can only be reopened through Back");
    }

    const completed = new Set(parseNumberArray(text(current["completed_steps_json"])));
    const responses = parseObject(text(current["responses_json"]));
    const statements: D1PreparedStatement[] = [];
    let currentStep = integer(current["current_step"]);
    let status: OnboardingWizardState["status"] = "IN_PROGRESS";
    let eventAction: "SAVED" | "CONFIRMED" | "INVALIDATED" | "COMPLETED" = "SAVED";

    if (input.action === "BACK") {
      currentStep = Math.max(5, input.step - 1);
      status = "IN_PROGRESS";
      eventAction = "INVALIDATED";
    } else {
      if (input.step > currentStep + 1) throw validation("Onboarding steps cannot be skipped");
      statements.push(...(await this.stepStatements(input.step, input.response)));
      responses[String(input.step)] = input.response;
      completed.add(input.step);
      currentStep = Math.min(20, input.step + 1);
      if (input.step === 6 || input.step === 7) eventAction = "CONFIRMED";
    }

    if (input.action === "COMPLETE") {
      if (input.step !== 20) throw validation("Only the review step can complete onboarding");
      const missing = requiredOnboardingSteps.filter((step) => !completed.has(step));
      if (missing.length) {
        throw validation(`Complete required onboarding steps first: ${missing.join(", ")}`);
      }
      status = "COMPLETED";
      currentStep = 20;
      eventAction = "COMPLETED";
    }

    const stamp = new Date().toISOString();
    statements.push(
      this.db
        .prepare(
          `UPDATE onboarding_wizard_progress SET current_step=?,status=?,completed_steps_json=?,
             responses_json=?,version=version+1,updated_by=?,updated_at=?,completed_at=?
           WHERE tenant_id=? AND version=?`,
        )
        .bind(
          currentStep,
          status,
          JSON.stringify([...completed].sort((a, b) => a - b)),
          JSON.stringify(responses),
          this.actor.id,
          stamp,
          status === "COMPLETED" ? stamp : null,
          this.actor.tenantId,
          integer(current["version"]),
        ),
      this.db
        .prepare(
          `INSERT INTO onboarding_wizard_events
            (tenant_id,id,step,action,response_json,actor_id,correlation_id,created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          input.step,
          eventAction,
          JSON.stringify(redactStepResponse(input.step, input.response)),
          this.actor.id,
          crypto.randomUUID(),
          stamp,
        ),
      this.audit(
        eventAction === "COMPLETED" ? "ONBOARDING_COMPLETED" : "ONBOARDING_STEP_SAVED",
        "ONBOARDING_WIZARD",
        String(input.step),
        { step: input.step, action: input.action },
      ),
    );
    const results = await this.db.batch(statements);
    const progressResult = results.at(-3);
    if (!progressResult?.meta?.changes) {
      throw new ServerOperationError(
        "CONFLICT",
        409,
        "Onboarding changed in another session; reload and try again",
      );
    }
    return this.getOnboardingState();
  }

  async listAcceptedCurrencies(): Promise<AcceptedCurrency[]> {
    this.require(permissions.setupView);
    const rows = await this.db
      .prepare(
        `SELECT a.currency_code,a.is_base,a.status,a.payment_eligible,a.cash_eligible,
                a.digital_payment_eligible,a.exchange_rate_policy,a.rate_freshness_minutes,
                a.rounding_policy,a.change_policy,a.branch_ids_json,a.payment_method_ids_json,
                c.name,c.symbol,c.minor_digits
         FROM tenant_accepted_currencies a JOIN currency_reference c ON c.code=a.currency_code
         WHERE a.tenant_id=? ORDER BY a.is_base DESC,c.name`,
      )
      .bind(this.actor.tenantId)
      .all<DbRow>();
    return (rows.results ?? []).map((row) => ({
      code: text(row["currency_code"]),
      name: text(row["name"]),
      symbol: text(row["symbol"]),
      minorDigits: integer(row["minor_digits"]),
      isBase: Boolean(row["is_base"]),
      status: text(row["status"]) as AcceptedCurrency["status"],
      paymentEligible: Boolean(row["payment_eligible"]),
      cashEligible: Boolean(row["cash_eligible"]),
      digitalPaymentEligible: Boolean(row["digital_payment_eligible"]),
      exchangeRatePolicy: text(
        row["exchange_rate_policy"],
      ) as AcceptedCurrency["exchangeRatePolicy"],
      rateFreshnessMinutes: integer(row["rate_freshness_minutes"]),
      roundingPolicy: text(row["rounding_policy"]) as AcceptedCurrency["roundingPolicy"],
      changePolicy: text(row["change_policy"]) as AcceptedCurrency["changePolicy"],
      branchIds: parseStringArray(text(row["branch_ids_json"])),
      paymentMethodIds: parseStringArray(text(row["payment_method_ids_json"])),
    }));
  }

  async listPaymentCurrencies() {
    this.require(permissions.paymentsCollect);
    const currencies = await this.listAcceptedCurrenciesUnchecked();
    return currencies.filter(
      (currency) => currency.status === "ACTIVE" && currency.paymentEligible,
    );
  }

  private async listAcceptedCurrenciesUnchecked(): Promise<AcceptedCurrency[]> {
    const rows = await this.db
      .prepare(
        `SELECT a.currency_code,a.is_base,a.status,a.payment_eligible,a.cash_eligible,
                a.digital_payment_eligible,a.exchange_rate_policy,a.rate_freshness_minutes,
                a.rounding_policy,a.change_policy,a.branch_ids_json,a.payment_method_ids_json,
                c.name,c.symbol,c.minor_digits
         FROM tenant_accepted_currencies a JOIN currency_reference c ON c.code=a.currency_code
         WHERE a.tenant_id=? ORDER BY a.is_base DESC,c.name`,
      )
      .bind(this.actor.tenantId)
      .all<DbRow>();
    return (rows.results ?? []).map(mapAcceptedCurrency);
  }

  async saveManualRate(input: ManualFxRateInput) {
    this.require(permissions.paymentsFxManage);
    if (input.baseCurrency === input.tenderCurrency) {
      throw validation("Base and tender currency must differ");
    }
    if (Date.parse(input.effectiveUntil) <= Date.parse(input.effectiveFrom)) {
      throw validation("FX rate end time must be after its start time");
    }
    await this.assertBaseAndAcceptedCurrency(input.baseCurrency, input.tenderCurrency, false);
    const sourceId = "fx-source-manual";
    const rateId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO fx_rate_sources
            (tenant_id,id,source_type,provider_key,display_name,status,configuration_json,
             created_by,created_at,updated_by,updated_at)
           VALUES (?,?,'MANUAL',NULL,'Authorized manual rate','ACTIVE','{}',?,?,?,?)
           ON CONFLICT(tenant_id,id) DO NOTHING`,
        )
        .bind(this.actor.tenantId, sourceId, this.actor.id, stamp, this.actor.id, stamp),
      this.db
        .prepare(
          `INSERT INTO fx_rates
            (tenant_id,id,base_currency,tender_currency,rate_numerator,rate_denominator,rate_scale,
             quality,source_id,effective_from,effective_until,reason,approved_by,created_by,created_at,
             idempotency_key)
           VALUES (?,?,?,?,?,?,1,'MANUAL',?,?,?,?,NULL,?,?,?)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          rateId,
          input.baseCurrency,
          input.tenderCurrency,
          input.rateNumerator,
          input.rateDenominator,
          sourceId,
          input.effectiveFrom,
          input.effectiveUntil,
          input.reason.trim(),
          this.actor.id,
          stamp,
          input.idempotencyKey,
        ),
      this.audit("FX_RATE_CONFIGURED", "FX_RATE", rateId, {
        baseCurrency: input.baseCurrency,
        tenderCurrency: input.tenderCurrency,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
      }),
    ]);
    return { id: rateId, sourceId, quality: "MANUAL" as const };
  }

  async createFxQuote(input: {
    branchId: string;
    invoiceId: string;
    paymentMethodId: string;
    baseAmountMinor: number;
    tenderCurrency: string;
    idempotencyKey: string;
  }): Promise<FxPaymentQuote> {
    this.require(permissions.paymentsCollect);
    this.assertBranch(input.branchId);
    if (!Number.isSafeInteger(input.baseAmountMinor) || input.baseAmountMinor <= 0) {
      throw validation("Base amount must be a positive integer in minor units");
    }
    const configuredMethod = getConfigurationRepository()
      .listPaymentMethods(this.actor.tenantId, false)
      .find((method) => method.id === input.paymentMethodId && method.enabled);
    if (!configuredMethod) throw validation("Payment method is unavailable");
    if (configuredMethod.category !== "CASH") {
      throw validation(
        "Secondary-currency digital payment requires a provider adapter with an implemented currency capability",
      );
    }
    const configuredBranches = Array.isArray(configuredMethod.metadata["branchIds"])
      ? configuredMethod.metadata["branchIds"].filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (configuredBranches.length && !configuredBranches.includes(input.branchId)) {
      throw validation("Payment method is not enabled for this branch");
    }
    let invoice = await this.db
      .prepare(
        `SELECT currency,total_minor,paid_minor FROM invoices
         WHERE tenant_id=? AND id=? AND branch_id=? AND status<>'CANCELLED'`,
      )
      .bind(this.actor.tenantId, input.invoiceId, input.branchId)
      .first<DbRow>();
    if (!invoice) {
      const authoritative = await this.db
        .prepare(
          `SELECT payload_json FROM authoritative_records
           WHERE tenant_id=? AND entity_type='state:bills' AND entity_id=? AND branch_id=?`,
        )
        .bind(this.actor.tenantId, input.invoiceId, input.branchId)
        .first<DbRow>();
      const bill = authoritative ? parseObject(text(authoritative["payload_json"])) : null;
      if (bill && !["VOID", "MERGED"].includes(text(bill["status"]))) {
        const tenant = await this.db
          .prepare("SELECT default_currency FROM tenants WHERE id=?")
          .bind(this.actor.tenantId)
          .first<DbRow>();
        const baseCurrency = text(tenant?.["default_currency"]);
        invoice = {
          currency: baseCurrency,
          total_minor: decimalMajorToMinor(bill["total"], await this.currency(baseCurrency)),
          paid_minor: decimalMajorToMinor(bill["paid"], await this.currency(baseCurrency)),
        };
      }
    }
    if (!invoice) throw notFound("Invoice was not found");
    const baseCurrency = text(invoice["currency"]);
    const due = integer(invoice["total_minor"]) - integer(invoice["paid_minor"]);
    if (input.baseAmountMinor > due) throw validation("FX quote exceeds the invoice balance");
    await this.assertBaseAndAcceptedCurrency(
      baseCurrency,
      input.tenderCurrency,
      configuredMethod.category,
      input.branchId,
      input.paymentMethodId,
      configuredMethod.metadata,
    );

    const replay = await this.db
      .prepare("SELECT * FROM fx_payment_quotes WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<DbRow>();
    if (replay) return mapQuote(replay);

    const stamp = new Date().toISOString();
    const rate = await this.db
      .prepare(
        `SELECT r.*,s.status AS source_status FROM fx_rates r JOIN fx_rate_sources s
           ON s.tenant_id=r.tenant_id AND s.id=r.source_id
         WHERE r.tenant_id=? AND r.base_currency=? AND r.tender_currency=?
           AND r.effective_from<=? AND r.effective_until>? AND s.status='ACTIVE'
         ORDER BY r.effective_from DESC,r.created_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, baseCurrency, input.tenderCurrency, stamp, stamp)
      .first<DbRow>();
    if (!rate) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "No current authoritative FX rate is available for this currency",
      );
    }
    const [baseMeta, tenderMeta] = await Promise.all([
      this.currency(baseCurrency),
      this.currency(input.tenderCurrency),
    ]);
    const rateNumerator = integer(rate["rate_numerator"]);
    const rateDenominator = integer(rate["rate_denominator"]);
    const tenderAmountMinor = convertBaseToTenderMinor({
      baseAmountMinor: input.baseAmountMinor,
      baseMinorDigits: baseMeta.minorDigits,
      tenderMinorDigits: tenderMeta.minorDigits,
      rateNumerator,
      rateDenominator,
    });
    const convertedBaseAmountMinor = convertTenderToBaseMinor({
      tenderAmountMinor,
      baseMinorDigits: baseMeta.minorDigits,
      tenderMinorDigits: tenderMeta.minorDigits,
      rateNumerator,
      rateDenominator,
    });
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO fx_payment_quotes
            (tenant_id,id,branch_id,invoice_id,payment_method_id,base_currency,tender_currency,base_amount_minor,
             tender_amount_minor,rate_numerator,rate_denominator,base_minor_digits,
             tender_minor_digits,converted_base_amount_minor,rounding_adjustment_minor,rate_id,
             rate_source_id,rate_timestamp,status,expires_at,idempotency_key,created_by,created_at,
             consumed_by_transaction_id,consumed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?,NULL,NULL)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.invoiceId,
          input.paymentMethodId,
          baseCurrency,
          input.tenderCurrency,
          input.baseAmountMinor,
          tenderAmountMinor,
          rateNumerator,
          rateDenominator,
          baseMeta.minorDigits,
          tenderMeta.minorDigits,
          convertedBaseAmountMinor,
          convertedBaseAmountMinor - input.baseAmountMinor,
          text(rate["id"]),
          text(rate["source_id"]),
          text(rate["created_at"]),
          expiresAt,
          input.idempotencyKey,
          this.actor.id,
          stamp,
        ),
      this.audit("FX_PAYMENT_QUOTED", "FX_PAYMENT_QUOTE", id, {
        invoiceId: input.invoiceId,
        baseCurrency,
        tenderCurrency: input.tenderCurrency,
      }),
    ]);
    const created = await this.db
      .prepare("SELECT * FROM fx_payment_quotes WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<DbRow>();
    if (!created)
      throw new ServerOperationError("DATABASE_UNAVAILABLE", 503, "FX quote was not persisted");
    return mapQuote(created);
  }

  private async stepStatements(step: number, response: Record<string, unknown>) {
    if (step === 5) return this.locationDraftStatements(response);
    if (step === 6) return this.locationConfirmationStatements(response);
    if (step === 7) return this.currencyStatements(response);
    if (step === 9) return this.branchStatements(response);
    if (step === 10) return this.branchLocationStatements(response);
    if (step === 11)
      return this.branchPolicyStatements("operating_hours_json", response["operatingHours"]);
    if (step === 12)
      return this.branchPolicyStatements("service_modes_json", response["serviceModes"]);
    validateGenericStep(step, response);
    return [];
  }

  private async locationDraftStatements(response: Record<string, unknown>) {
    const countryCode = requiredCode(response["countryCode"], 2, "Country");
    const country = await this.db
      .prepare("SELECT code FROM country_reference WHERE code=? AND active=1")
      .bind(countryCode)
      .first();
    if (!country) throw validation("Select a supported country from the list");
    const city = requiredText(response["city"], "City / town", 120);
    const addressLine = requiredText(response["addressLine"], "Street / building", 300);
    const latitude = optionalCoordinate(response["latitudeMicrodegrees"], -90_000_000, 90_000_000);
    const longitude = optionalCoordinate(
      response["longitudeMicrodegrees"],
      -180_000_000,
      180_000_000,
    );
    const stamp = new Date().toISOString();
    return [
      this.db
        .prepare(
          `INSERT INTO tenant_business_locations
            (tenant_id,country_code,administrative_level_1,administrative_level_2,city,address_line,
             postal_code,latitude_microdegrees,longitude_microdegrees,status,confirmed_by,confirmed_at,
             created_by,created_at,updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,'DRAFT',NULL,NULL,?,?,?,?)
           ON CONFLICT(tenant_id) DO UPDATE SET country_code=excluded.country_code,
             administrative_level_1=excluded.administrative_level_1,
             administrative_level_2=excluded.administrative_level_2,city=excluded.city,
             address_line=excluded.address_line,postal_code=excluded.postal_code,
             latitude_microdegrees=excluded.latitude_microdegrees,
             longitude_microdegrees=excluded.longitude_microdegrees,status='DRAFT',
             confirmed_by=NULL,confirmed_at=NULL,updated_by=excluded.updated_by,
             updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          countryCode,
          optionalText(response["administrativeLevel1"], 120),
          optionalText(response["administrativeLevel2"], 120),
          city,
          addressLine,
          optionalText(response["postalCode"], 32),
          latitude,
          longitude,
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
    ];
  }

  private async locationConfirmationStatements(response: Record<string, unknown>) {
    if (response["confirmed"] !== true)
      throw validation("Confirm the business location to continue");
    const location = await this.db
      .prepare(
        "SELECT country_code FROM tenant_business_locations WHERE tenant_id=? AND status='DRAFT'",
      )
      .bind(this.actor.tenantId)
      .first<DbRow>();
    if (!location) throw validation("Save the business location before confirming it");
    const country = await this.db
      .prepare(
        "SELECT default_timezone,default_locale FROM country_reference WHERE code=? AND active=1",
      )
      .bind(text(location["country_code"]))
      .first<DbRow>();
    if (!country) throw validation("The selected country is unavailable");
    const tenant = await this.db
      .prepare("SELECT payload_json FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<DbRow>();
    const payload = parseObject(text(tenant?.["payload_json"]));
    payload["countryCode"] = text(location["country_code"]);
    const stamp = new Date().toISOString();
    return [
      this.db
        .prepare(
          `UPDATE tenant_business_locations SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,
             updated_by=?,updated_at=? WHERE tenant_id=? AND status='DRAFT'`,
        )
        .bind(this.actor.id, stamp, this.actor.id, stamp, this.actor.tenantId),
      this.db
        .prepare(`UPDATE tenants SET timezone=?,locale=?,payload_json=?,updated_at=? WHERE id=?`)
        .bind(
          text(country["default_timezone"]),
          text(country["default_locale"]),
          JSON.stringify(payload),
          stamp,
          this.actor.tenantId,
        ),
      this.db
        .prepare(
          "UPDATE tenant_onboarding_profiles SET country_code=?,updated_by=?,updated_at=? WHERE tenant_id=?",
        )
        .bind(text(location["country_code"]), this.actor.id, stamp, this.actor.tenantId),
    ];
  }

  private async currencyStatements(response: Record<string, unknown>) {
    const baseCurrency = requiredCode(response["baseCurrency"], 3, "Base currency");
    const location = await this.db
      .prepare(
        "SELECT country_code FROM tenant_business_locations WHERE tenant_id=? AND status='CONFIRMED'",
      )
      .bind(this.actor.tenantId)
      .first<DbRow>();
    if (!location) throw validation("Confirm the business location before selecting currency");
    const base = await this.currency(baseCurrency);
    const secondary = Array.isArray(response["secondaryCurrencies"])
      ? response["secondaryCurrencies"].map((value) => requiredCode(value, 3, "Secondary currency"))
      : [];
    if (new Set(secondary).size !== secondary.length || secondary.includes(baseCurrency)) {
      throw validation("Secondary currencies must be unique and different from the base currency");
    }
    for (const code of secondary) await this.currency(code);
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<DbRow>();
    if (!tenant) throw notFound("Tenant was not found");
    const previous = text(tenant["default_currency"]);
    if (previous !== baseCurrency && (await this.hasFinancialActivity())) {
      throw invalidTransition("Base currency is locked after authoritative financial activity");
    }
    const stamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare("UPDATE tenants SET default_currency=?,updated_at=? WHERE id=?")
        .bind(baseCurrency, stamp, this.actor.tenantId),
      this.db
        .prepare(
          "UPDATE legal_entities SET base_currency=?,updated_by=?,updated_at=? WHERE tenant_id=?",
        )
        .bind(baseCurrency, this.actor.id, stamp, this.actor.tenantId),
      this.db
        .prepare(
          "UPDATE enterprise_nodes SET currency=?,updated_by=?,updated_at=?,version=version+1 WHERE tenant_id=?",
        )
        .bind(baseCurrency, this.actor.id, stamp, this.actor.tenantId),
      this.db
        .prepare("UPDATE accounts SET currency=? WHERE tenant_id=? AND currency=?")
        .bind(baseCurrency, this.actor.tenantId, previous),
      this.db
        .prepare(
          "UPDATE tenant_accepted_currencies SET is_base=0,status='INACTIVE',updated_by=?,updated_at=? WHERE tenant_id=?",
        )
        .bind(this.actor.id, stamp, this.actor.tenantId),
      this.acceptedCurrencyUpsert(
        base.code,
        true,
        {
          paymentEligible: true,
          cashEligible: true,
          digitalPaymentEligible: true,
          exchangeRatePolicy: "LEGAL_ENTITY",
          rateFreshnessMinutes: 1_440,
          roundingPolicy: "HALF_UP",
          changePolicy: "TENDER_CURRENCY",
          branchIds: [],
          paymentMethodIds: [],
        },
        stamp,
      ),
    ];
    for (const code of secondary) {
      statements.push(
        this.acceptedCurrencyUpsert(code, false, currencyConfiguration(response, code), stamp),
      );
    }
    return statements;
  }

  private acceptedCurrencyUpsert(
    code: string,
    isBase: boolean,
    config: ReturnType<typeof currencyConfiguration>,
    stamp: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO tenant_accepted_currencies
          (tenant_id,currency_code,is_base,status,payment_eligible,cash_eligible,
           digital_payment_eligible,exchange_rate_policy,rate_freshness_minutes,rounding_policy,
           change_policy,branch_ids_json,payment_method_ids_json,effective_from,effective_to,
           created_by,created_at,updated_by,updated_at)
         VALUES (?,?,?,'ACTIVE',?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)
         ON CONFLICT(tenant_id,currency_code) DO UPDATE SET is_base=excluded.is_base,status='ACTIVE',
           payment_eligible=excluded.payment_eligible,cash_eligible=excluded.cash_eligible,
           digital_payment_eligible=excluded.digital_payment_eligible,
           exchange_rate_policy=excluded.exchange_rate_policy,
           rate_freshness_minutes=excluded.rate_freshness_minutes,
           rounding_policy=excluded.rounding_policy,change_policy=excluded.change_policy,
           branch_ids_json=excluded.branch_ids_json,
           payment_method_ids_json=excluded.payment_method_ids_json,
           effective_to=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      )
      .bind(
        this.actor.tenantId,
        code,
        isBase ? 1 : 0,
        config.paymentEligible ? 1 : 0,
        config.cashEligible ? 1 : 0,
        config.digitalPaymentEligible ? 1 : 0,
        config.exchangeRatePolicy,
        config.rateFreshnessMinutes,
        config.roundingPolicy,
        config.changePolicy,
        JSON.stringify(config.branchIds),
        JSON.stringify(config.paymentMethodIds),
        stamp,
        this.actor.id,
        stamp,
        this.actor.id,
        stamp,
      );
  }

  private async branchStatements(response: Record<string, unknown>) {
    const name = requiredText(response["name"], "Branch name", 160);
    const code = requiredCode(response["code"], 40, "Branch code", /^[A-Z0-9][A-Z0-9_-]*$/);
    const branchId = optionalText(response["branchId"], 120) ?? this.actor.branchId;
    this.assertBranch(branchId);
    const stamp = new Date().toISOString();
    return [
      this.db
        .prepare(
          `UPDATE branches SET code=?,name=?,lifecycle_state='CONFIGURING',version=version+1
           WHERE tenant_id=? AND id=? AND lifecycle_state IN ('DRAFT','CONFIGURING')`,
        )
        .bind(code, name, this.actor.tenantId, branchId),
      this.db
        .prepare(
          "UPDATE enterprise_nodes SET code=?,name=?,updated_by=?,updated_at=?,version=version+1 WHERE tenant_id=? AND branch_id=?",
        )
        .bind(`BRANCH-${code}`, name, this.actor.id, stamp, this.actor.tenantId, branchId),
    ];
  }

  private async branchLocationStatements(response: Record<string, unknown>) {
    const branchId = optionalText(response["branchId"], 120) ?? this.actor.branchId;
    this.assertBranch(branchId);
    const branch = await this.db
      .prepare("SELECT payload_json FROM branches WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, branchId)
      .first<DbRow>();
    if (!branch) throw notFound("Branch was not found");
    const payload = parseObject(text(branch["payload_json"]));
    delete payload["onboardingProvisional"];
    if (response["useBusinessLocation"] === true) {
      const location = await this.db
        .prepare("SELECT * FROM tenant_business_locations WHERE tenant_id=? AND status='CONFIRMED'")
        .bind(this.actor.tenantId)
        .first<DbRow>();
      if (!location) throw validation("Confirm the business location first");
      payload["location"] = mapLocation(location);
    } else {
      payload["location"] = {
        city: requiredText(response["city"], "Branch city", 120),
        addressLine: requiredText(response["addressLine"], "Branch address", 300),
      };
    }
    return [
      this.db
        .prepare(
          `UPDATE branches SET payload_json=?,lifecycle_state='CONFIGURING',version=version+1
           WHERE tenant_id=? AND id=? AND lifecycle_state IN ('DRAFT','CONFIGURING')`,
        )
        .bind(JSON.stringify(payload), this.actor.tenantId, branchId),
    ];
  }

  private async branchPolicyStatements(
    column: "operating_hours_json" | "service_modes_json",
    value: unknown,
  ) {
    const branchId = this.actor.branchId;
    this.assertBranch(branchId);
    if (column === "service_modes_json") {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.some((entry) => typeof entry !== "string")
      ) {
        throw validation("Select at least one service mode");
      }
    } else if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw validation("Configure opening hours to continue");
    }
    const stamp = new Date().toISOString();
    return [
      this.db
        .prepare(
          `UPDATE branch_operating_profiles SET ${column}=?,updated_by=?,updated_at=? WHERE tenant_id=? AND branch_id=?`,
        )
        .bind(JSON.stringify(value), this.actor.id, stamp, this.actor.tenantId, branchId),
    ];
  }

  private async currency(code: string): Promise<CurrencyReference> {
    const row = await this.db
      .prepare(
        "SELECT code,name,symbol,minor_digits FROM currency_reference WHERE code=? AND active=1",
      )
      .bind(code)
      .first<DbRow>();
    if (!row) throw validation(`Currency ${code} is not available`);
    return mapCurrency(row);
  }

  private async assertBaseAndAcceptedCurrency(
    baseCurrency: string,
    tenderCurrency: string,
    paymentCategory: PaymentMethodCategory | false,
    branchId?: string,
    paymentMethodId?: string,
    paymentMethodMetadata?: Record<string, unknown>,
  ) {
    const base = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<DbRow>();
    if (!base || text(base["default_currency"]) !== baseCurrency) {
      throw validation("Payment base currency does not match the restaurant base currency");
    }
    const accepted = await this.db
      .prepare(
        `SELECT payment_eligible,cash_eligible,digital_payment_eligible,branch_ids_json,
                payment_method_ids_json
         FROM tenant_accepted_currencies
         WHERE tenant_id=? AND currency_code=? AND is_base=0 AND status='ACTIVE'`,
      )
      .bind(this.actor.tenantId, tenderCurrency)
      .first<DbRow>();
    const cashRequired = paymentCategory === "CASH";
    const digitalRequired = paymentCategory !== false && paymentCategory !== "CASH";
    if (
      !accepted ||
      !accepted["payment_eligible"] ||
      (cashRequired && !accepted["cash_eligible"]) ||
      (digitalRequired && !accepted["digital_payment_eligible"])
    ) {
      throw validation("Tender currency is not enabled for this payment type");
    }
    const branchIds = parseStringArray(text(accepted["branch_ids_json"]));
    if (branchId && branchIds.length && !branchIds.includes(branchId)) {
      throw validation("Tender currency is not enabled for this branch");
    }
    const paymentMethodIds = parseStringArray(text(accepted["payment_method_ids_json"]));
    if (paymentMethodId && paymentMethodIds.length && !paymentMethodIds.includes(paymentMethodId)) {
      throw validation("Tender currency is not enabled for this payment method");
    }
    const providerCurrencies = Array.isArray(paymentMethodMetadata?.["supportedCurrencies"])
      ? paymentMethodMetadata["supportedCurrencies"].filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (
      digitalRequired &&
      providerCurrencies.length &&
      !providerCurrencies.includes(tenderCurrency)
    ) {
      throw validation("The configured payment provider does not support this currency");
    }
  }

  private async hasFinancialActivity() {
    const row = await this.db
      .prepare(
        `SELECT CASE WHEN
           EXISTS (SELECT 1 FROM invoices WHERE tenant_id=? LIMIT 1) OR
           EXISTS (SELECT 1 FROM payment_transactions WHERE tenant_id=? LIMIT 1) OR
           EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id=? LIMIT 1) OR
           EXISTS (SELECT 1 FROM inventory_movements WHERE tenant_id=? LIMIT 1) OR
           EXISTS (SELECT 1 FROM opening_stock_batches WHERE tenant_id=? LIMIT 1) OR
           EXISTS (SELECT 1 FROM supplier_invoices WHERE tenant_id=? LIMIT 1) OR
           EXISTS (SELECT 1 FROM gift_card_ledger WHERE tenant_id=? LIMIT 1)
           OR EXISTS (
             SELECT 1 FROM authoritative_records WHERE tenant_id=? AND entity_type IN
               ('state:bills','state:payments','payments:transactions','payments:journals') LIMIT 1
           )
         THEN 1 ELSE 0 END AS present`,
      )
      .bind(...Array(8).fill(this.actor.tenantId))
      .first<{ present: number }>();
    return Boolean(row?.present);
  }

  private assertBranch(branchId: string) {
    if (branchId === this.actor.branchId) return;
    if (
      this.actor.branchScope.type === "ALL" &&
      this.actor.permissions.includes(permissions.branchSwitch) &&
      this.actor.assignedBranchIds.includes(branchId)
    )
      return;
    throw new ServerOperationError(
      "TENANT_SCOPE_VIOLATION",
      403,
      "Branch is outside the active scope",
    );
  }

  private require(permission: PermissionCode) {
    if (!this.actor.permissions.includes(permission)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        `Permission ${permission} is required`,
      );
    }
  }

  private audit(
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
           correlation_id,session_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        this.actor.branchId,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        entityType,
        entityId,
        "Authenticated onboarding or currency command",
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        JSON.stringify(metadata),
        new Date().toISOString(),
      );
  }
}

export function convertTenderToBaseMinor(input: {
  tenderAmountMinor: number;
  baseMinorDigits: number;
  tenderMinorDigits: number;
  rateNumerator: number;
  rateDenominator: number;
}) {
  assertSafePositive(input.tenderAmountMinor, "Tender amount");
  const numerator =
    BigInt(input.tenderAmountMinor) *
    BigInt(input.rateNumerator) *
    10n ** BigInt(input.baseMinorDigits);
  const denominator = BigInt(input.rateDenominator) * 10n ** BigInt(input.tenderMinorDigits);
  return safeNumber(roundDivide(numerator, denominator));
}

export function convertBaseToTenderMinor(input: {
  baseAmountMinor: number;
  baseMinorDigits: number;
  tenderMinorDigits: number;
  rateNumerator: number;
  rateDenominator: number;
}) {
  assertSafePositive(input.baseAmountMinor, "Base amount");
  const numerator =
    BigInt(input.baseAmountMinor) *
    BigInt(input.rateDenominator) *
    10n ** BigInt(input.tenderMinorDigits);
  const denominator = BigInt(input.rateNumerator) * 10n ** BigInt(input.baseMinorDigits);
  return safeNumber(roundDivide(numerator, denominator));
}

function roundDivide(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw validation("FX denominator must be positive");
  return (numerator + denominator / 2n) / denominator;
}

function safeNumber(value: bigint) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw validation("Converted amount exceeds safe range");
  return Number(value);
}

function assertSafePositive(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw validation(`${label} must be a positive integer`);
}

function mapCountry(row: DbRow): CountryReference {
  return {
    code: text(row["code"]),
    name: text(row["name"]),
    administrativeLevel1Label: text(row["administrative_level_1_label"]),
    defaultCurrencyCode: text(row["default_currency_code"]),
    callingCode: text(row["calling_code"]),
    defaultTimezone: text(row["default_timezone"]),
    defaultLocale: text(row["default_locale"]),
  };
}

function mapCurrency(row: DbRow): CurrencyReference {
  return {
    code: text(row["code"] ?? row["currency_code"]),
    name: text(row["name"]),
    symbol: text(row["symbol"]),
    minorDigits: integer(row["minor_digits"]),
  };
}

function mapAcceptedCurrency(row: DbRow): AcceptedCurrency {
  return {
    ...mapCurrency(row),
    isBase: Boolean(row["is_base"]),
    status: text(row["status"]) as AcceptedCurrency["status"],
    paymentEligible: Boolean(row["payment_eligible"]),
    cashEligible: Boolean(row["cash_eligible"]),
    digitalPaymentEligible: Boolean(row["digital_payment_eligible"]),
    exchangeRatePolicy: text(row["exchange_rate_policy"]) as AcceptedCurrency["exchangeRatePolicy"],
    rateFreshnessMinutes: integer(row["rate_freshness_minutes"]),
    roundingPolicy: text(row["rounding_policy"]) as AcceptedCurrency["roundingPolicy"],
    changePolicy: text(row["change_policy"]) as AcceptedCurrency["changePolicy"],
    branchIds: parseStringArray(text(row["branch_ids_json"])),
    paymentMethodIds: parseStringArray(text(row["payment_method_ids_json"])),
  };
}

function decimalMajorToMinor(value: unknown, currency: CurrencyReference) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw validation("Invoice monetary value is invalid");
  }
  return parseMajorAmount(value, currency.code);
}

function mapLocation(row: DbRow): BusinessLocation {
  return {
    countryCode: text(row["country_code"]),
    administrativeLevel1: text(row["administrative_level_1"]),
    administrativeLevel2: text(row["administrative_level_2"]),
    city: text(row["city"]),
    addressLine: text(row["address_line"]),
    postalCode: text(row["postal_code"]),
    latitudeMicrodegrees: nullableInteger(row["latitude_microdegrees"]),
    longitudeMicrodegrees: nullableInteger(row["longitude_microdegrees"]),
    status: text(row["status"]) as BusinessLocation["status"],
  };
}

function mapQuote(row: DbRow): FxPaymentQuote {
  return {
    id: text(row["id"]),
    branchId: text(row["branch_id"]),
    invoiceId: text(row["invoice_id"]),
    paymentMethodId: text(row["payment_method_id"]),
    baseCurrency: text(row["base_currency"]),
    tenderCurrency: text(row["tender_currency"]),
    baseAmountMinor: integer(row["base_amount_minor"]),
    tenderAmountMinor: integer(row["tender_amount_minor"]),
    convertedBaseAmountMinor: integer(row["converted_base_amount_minor"]),
    roundingAdjustmentMinor: integer(row["rounding_adjustment_minor"]),
    rateNumerator: integer(row["rate_numerator"]),
    rateDenominator: integer(row["rate_denominator"]),
    rateSourceId: text(row["rate_source_id"]),
    rateTimestamp: text(row["rate_timestamp"]),
    quality: "MANUAL",
    expiresAt: text(row["expires_at"]),
    status: text(row["status"]) as FxPaymentQuote["status"],
  };
}

function currencyConfiguration(response: Record<string, unknown>, code: string) {
  const raw = Array.isArray(response["currencyConfigurations"])
    ? response["currencyConfigurations"].find(
        (candidate) => isObject(candidate) && candidate["currencyCode"] === code,
      )
    : undefined;
  const config = isObject(raw) ? raw : {};
  return {
    paymentEligible: config["paymentEligible"] !== false,
    cashEligible: config["cashEligible"] !== false,
    digitalPaymentEligible: config["digitalPaymentEligible"] === true,
    exchangeRatePolicy: enumValue(
      config["exchangeRatePolicy"],
      ["MANUAL", "PROVIDER", "HQ", "LEGAL_ENTITY"],
      "MANUAL",
    ),
    rateFreshnessMinutes: positiveInteger(config["rateFreshnessMinutes"], 1_440, 43_200),
    roundingPolicy: enumValue(config["roundingPolicy"], ["HALF_UP", "UP", "DOWN"], "HALF_UP"),
    changePolicy: enumValue(
      config["changePolicy"],
      ["TENDER_CURRENCY", "BASE_CURRENCY", "NO_CHANGE"],
      "TENDER_CURRENCY",
    ),
    branchIds: stringArray(config["branchIds"]),
    paymentMethodIds: stringArray(config["paymentMethodIds"]),
  } as const;
}

function validateGenericStep(step: number, response: Record<string, unknown>) {
  if (step === 8) requiredText(response["businessType"], "Business type", 80);
  if (step === 13 && !["CONFIGURE_NOW", "DO_LATER"].includes(text(response["choice"]))) {
    throw validation("Choose whether to configure tax now or later");
  }
  if (step === 14 && !["CONFIGURE_NOW", "DO_LATER"].includes(text(response["choice"]))) {
    throw validation("Choose whether to configure payment methods now or later");
  }
  if (step >= 15 && step <= 19 && !text(response["choice"])) {
    throw validation("Choose an option to continue");
  }
  if (step === 20 && response["confirmed"] !== true)
    throw validation("Review and confirm the onboarding summary");
}

function redactStepResponse(step: number, response: Record<string, unknown>) {
  if (step !== 5 && step !== 10) return response;
  return {
    countryCode: response["countryCode"],
    cityProvided: Boolean(response["city"]),
    addressProvided: Boolean(response["addressLine"]),
    coordinatesProvided:
      response["latitudeMicrodegrees"] !== undefined &&
      response["longitudeMicrodegrees"] !== undefined,
  };
}

function requiredText(value: unknown, label: string, max: number) {
  const result = text(value).trim().replace(/\s+/g, " ");
  if (result.length < 2 || result.length > max) throw validation(`${label} is required`);
  return result;
}

function optionalText(value: unknown, max: number) {
  const result = text(value).trim().replace(/\s+/g, " ");
  if (result.length > max) throw validation("Text value is too long");
  return result || null;
}

function requiredCode(value: unknown, length: number, label: string, pattern = /^[A-Z]+$/) {
  const result = text(value).trim().toUpperCase();
  if (
    !pattern.test(result) ||
    result.length < (length === 40 ? 2 : length) ||
    result.length > length
  ) {
    throw validation(`${label} is invalid`);
  }
  return result;
}

function optionalCoordinate(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max)
    throw validation("Location coordinates are invalid");
  return result;
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function integer(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isSafeInteger(result) ? result : 0;
}

function nullableInteger(value: unknown) {
  return value === null || value === undefined ? null : integer(value);
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(value || "{}");
    return isObject(result) ? result : {};
  } catch {
    return {};
  }
}

function parseNumberArray(value: string) {
  try {
    const result: unknown = JSON.parse(value || "[]");
    return Array.isArray(result)
      ? result.filter((entry): entry is number => Number.isInteger(entry))
      : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string) {
  try {
    return stringArray(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result > 0 && result <= max ? result : fallback;
}

function enumValue<const T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

function validation(message: string) {
  return new ServerOperationError("VALIDATION_FAILED", 400, message);
}

function invalidTransition(message: string) {
  return new ServerOperationError("INVALID_STATE_TRANSITION", 409, message);
}

function notFound(message: string) {
  return new ServerOperationError("VALIDATION_FAILED", 404, message);
}
