import {
  getConfigurationRepository,
  PlatformConfigurationError,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import type { OrderChannelDefinition } from "@/platform/types";

export class OrderChannelValidationError extends Error {}

export function orderChannelDispatchError(
  channel: Pick<OrderChannelDefinition, "requiresCustomer" | "requiresAddress"> | undefined,
  details: { customerId?: string; delivery?: { recipientName?: string; address?: string } },
) {
  const recipient = details.delivery?.recipientName;
  if (
    channel?.requiresCustomer &&
    !(typeof details.customerId === "string" && details.customerId.trim()) &&
    (typeof recipient !== "string" || !recipient.trim() || recipient.trim().length > 120)
  )
    return "Customer name is required before sending to kitchen.";
  const address = details.delivery?.address;
  if (
    channel?.requiresAddress &&
    (typeof address !== "string" || address.trim().length < 5 || address.trim().length > 500)
  )
    return "Delivery address is required (5-500 characters).";
  return null;
}

export class OrderChannelService {
  constructor(private repository: ConfigurationRepository = getConfigurationRepository()) {}

  listActive(tenantId: string) {
    return this.repository.listOrderChannels(tenantId, true);
  }

  requireActive(tenantId: string, channelIdOrCode: string) {
    const channel = this.listActive(tenantId).find(
      (item) => item.id === channelIdOrCode || item.code === channelIdOrCode,
    );
    if (!channel) throw new PlatformConfigurationError("No active order channels");
    return channel;
  }
}
