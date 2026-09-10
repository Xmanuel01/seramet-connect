import {
  getConfigurationRepository,
  PlatformConfigurationError,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";

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
