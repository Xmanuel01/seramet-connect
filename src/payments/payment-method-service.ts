import {
  getConfigurationRepository,
  PlatformConfigurationError,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import {
  TransactionEngine,
  type PaymentMethod,
  type TransactionState,
} from "@/lib/transaction-engine";

export class PaymentMethodService {
  constructor(private repository: ConfigurationRepository = getConfigurationRepository()) {}

  listActive(tenantId: string) {
    return this.repository.listPaymentMethods(tenantId, true);
  }

  requireActive(tenantId: string, paymentMethodIdOrCode: string) {
    const method = this.listActive(tenantId).find(
      (item) => item.id === paymentMethodIdOrCode || item.code === paymentMethodIdOrCode,
    );
    if (!method) throw new PlatformConfigurationError("No active payment methods");
    return method;
  }
}

export function createPaymentIntentForProvider(
  state: TransactionState,
  invoiceId: string,
  method: PaymentMethod,
  amount: number,
  createdBy: string,
  customerPhone?: string,
) {
  return TransactionEngine.createPaymentIntent(state, invoiceId, {
    amount,
    method,
    createdBy,
    ...(customerPhone ? { customerPhone } : {}),
  });
}
