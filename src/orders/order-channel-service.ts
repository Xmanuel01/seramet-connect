import {
  getConfigurationRepository,
  PlatformConfigurationError,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import type { OrderChannelDefinition } from "@/platform/types";
import { deliverySettings, deliveryContactSchema } from "@/delivery/delivery-charge";

export class OrderChannelValidationError extends Error {}

export function orderChannelDispatchError(
  channel: (Pick<OrderChannelDefinition, "requiresCustomer" | "requiresAddress"> & Partial<Pick<OrderChannelDefinition, "metadata">>) | undefined,
  details: { customerId?: string; delivery?: { recipientName?: string; address?: string } },
) {
  if (channel?.metadata && ["RESTAURANT", "PROVIDER"].includes(deliverySettings({ metadata: channel.metadata })?.fulfilment ?? "")) {
    const parsed = deliveryContactSchema.safeParse(details.delivery ?? {});
    return parsed.success ? null : "Delivery contact details are invalid or too long.";
  }
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
