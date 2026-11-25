import type { OrderChannelDefinition } from "@/platform/types";

export function usesOnlinePrice(channel: Pick<OrderChannelDefinition, "metadata"> | undefined) {
  return channel?.metadata["useOnlinePrice"] === true;
}

export function resolveOnlineOrderChannel(channels: OrderChannelDefinition[], value: string) {
  // Prefer stable identifiers before legacy display-name references.
  const channel =
    channels.find((candidate) => candidate.id === value) ??
    channels.find((candidate) => candidate.code === value) ??
    channels.find((candidate) => candidate.displayName === value);
  return channel?.enabled && usesOnlinePrice(channel) ? channel : undefined;
}
