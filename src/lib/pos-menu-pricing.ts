import type { Product } from "./menu-product";
import type { OrderChannelDefinition } from "@/platform/types";
import { majorFromMinor, parseMajorAmount } from "@/payments/money";
import { usesOnlinePrice } from "./online-order-channels";

export function posMenuPrice(
  product: Product,
  channel: Pick<OrderChannelDefinition, "metadata"> | undefined,
  branch: string,
  defaultCurrency: string,
) {
  const currency = product.currency ?? defaultCurrency;
  const branchPrice = product.branchPrices?.[branch];
  const normalMinor =
    branchPrice !== undefined
      ? parseMajorAmount(branchPrice, currency)
      : (product.priceMinor ?? parseMajorAmount(product.price, currency));
  const online = product.onlinePriceMinor;
  const priceMinor =
    usesOnlinePrice(channel) &&
    typeof online === "number" &&
    Number.isSafeInteger(online) &&
    online >= 0
      ? online
      : normalMinor;
  return { price: majorFromMinor(priceMinor, currency), priceMinor, currency };
}
