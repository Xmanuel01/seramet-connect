import { QUANTITY_SCALE, assertScaledInteger, multiplyDivide } from "@/inventory/quantity";
import type {
  AnalyticsQuality,
  ForecastInput,
  PurchaseRecommendationInput,
} from "@/inventory/types";

export function deterministicForecast(input: ForecastInput) {
  if (input.samples.length === 0) {
    return { quantityMicro: 0, quality: "INSUFFICIENT_DATA" as const, sampleCount: 0 };
  }
  for (const sample of input.samples) assertScaledInteger(sample, "forecast sample");
  let quantityMicro: number;
  if (input.method === "WEIGHTED_MOVING_AVERAGE") {
    const weights = input.weights ?? input.samples.map((_, index) => index + 1);
    if (weights.length !== input.samples.length) {
      throw new Error("Forecast weights must match the sample count");
    }
    let weightedTotal = 0n;
    let weightTotal = 0n;
    input.samples.forEach((sample, index) => {
      const weight = weights[index]!;
      assertScaledInteger(weight, "forecast weight");
      if (weight <= 0) throw new Error("Forecast weights must be positive");
      weightedTotal += BigInt(sample) * BigInt(weight);
      weightTotal += BigInt(weight);
    });
    quantityMicro = Number((weightedTotal + weightTotal / 2n) / weightTotal);
  } else {
    const total = input.samples.reduce((sum, sample) => sum + BigInt(sample), 0n);
    quantityMicro = Number(
      (total + BigInt(input.samples.length / 2)) / BigInt(input.samples.length),
    );
  }
  return {
    quantityMicro,
    quality: forecastQuality(input.samples.length),
    sampleCount: input.samples.length,
  };
}

export function buildPurchaseRecommendation(input: PurchaseRecommendationInput) {
  const fields = [
    input.forecastConsumptionMicro,
    input.safetyStockMicro,
    input.targetClosingStockMicro,
    input.onHandMicro,
    input.incomingConfirmedMicro,
  ];
  fields.forEach((value) => assertScaledInteger(value, "recommendation quantity"));
  const recommendedBaseMicro = Math.max(
    0,
    input.forecastConsumptionMicro +
      input.safetyStockMicro +
      input.targetClosingStockMicro -
      input.onHandMicro -
      input.incomingConfirmedMicro,
  );
  const purchaseUnitMicro = multiplyDivide(
    recommendedBaseMicro,
    input.purchaseConversionDenominator,
    input.purchaseConversionNumerator,
    "recommended purchase quantity",
  );
  const orderDate = new Date(`${input.asOfDate}T00:00:00.000Z`);
  if (Number.isNaN(orderDate.getTime())) throw new Error("Recommendation date is invalid");
  orderDate.setUTCDate(orderDate.getUTCDate() - Math.max(0, input.leadTimeDays));
  return {
    recommendedBaseMicro,
    recommendedPurchaseUnitMicro: roundUpPurchaseUnit(purchaseUnitMicro),
    recommendedOrderDate: orderDate.toISOString().slice(0, 10),
    explanation: {
      forecastConsumptionMicro: input.forecastConsumptionMicro,
      safetyStockMicro: input.safetyStockMicro,
      targetClosingStockMicro: input.targetClosingStockMicro,
      lessOnHandMicro: input.onHandMicro,
      lessIncomingConfirmedMicro: input.incomingConfirmedMicro,
      leadTimeDays: input.leadTimeDays,
    },
  };
}

export function calculateFoodCostBridge(input: {
  priorCostMinor: number;
  currentCostMinor: number;
  supportedDrivers: ReadonlyArray<{ code: string; amountMinor: number }>;
}) {
  assertScaledInteger(input.priorCostMinor, "prior food cost");
  assertScaledInteger(input.currentCostMinor, "current food cost");
  const changeMinor = input.currentCostMinor - input.priorCostMinor;
  const supportedMinor = input.supportedDrivers.reduce((sum, driver) => {
    assertScaledInteger(driver.amountMinor, "food-cost driver", true);
    return sum + driver.amountMinor;
  }, 0);
  return {
    priorCostMinor: input.priorCostMinor,
    currentCostMinor: input.currentCostMinor,
    changeMinor,
    drivers: input.supportedDrivers,
    unexplainedMinor: changeMinor - supportedMinor,
  };
}

export function theoreticalConsumptionMicro(portions: number, quantityPerPortionMicro: number) {
  assertScaledInteger(portions, "portions");
  assertScaledInteger(quantityPerPortionMicro, "recipe quantity");
  return multiplyDivide(quantityPerPortionMicro, portions * QUANTITY_SCALE, QUANTITY_SCALE);
}

function forecastQuality(sampleCount: number): AnalyticsQuality {
  if (sampleCount >= 28) return "HIGH";
  if (sampleCount >= 14) return "MEDIUM";
  if (sampleCount >= 4) return "LOW";
  return "INSUFFICIENT_DATA";
}

function roundUpPurchaseUnit(quantityMicro: number) {
  if (quantityMicro <= 0) return 0;
  return Math.ceil(quantityMicro / QUANTITY_SCALE) * QUANTITY_SCALE;
}
