import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DurableQueueBatch } from "@/server/environment";
import type { SerametWorkerMessage } from "@/server/workers";

vi.mock("@/server/runtime-env-resolver", () => ({
  resolveEnvironmentFromBindings: vi.fn(async () => ({
    SERAMET_ENVIRONMENT: "test",
    SERAMET_DB: "resolved-test-db",
  })),
}));
vi.mock("@/server/workers", () => ({
  handleWorkerQueue: vi.fn(async () => undefined),
  scheduleDurableWork: vi.fn(async () => ({ queued: 0 })),
}));

import registerCloudflareEvents, {
  type CloudflareHookRegistry,
} from "@/server/nitro-cloudflare-events";
import { resolveEnvironmentFromBindings } from "@/server/runtime-env-resolver";
import { handleWorkerQueue, scheduleDurableWork } from "@/server/workers";

function createHooks() {
  const callbacks = new Map<
    string,
    (context: { env: unknown; batch?: DurableQueueBatch<SerametWorkerMessage> }) => Promise<void>
  >();
  const plugin = {
    hooks: {
      hook(name, callback) {
        callbacks.set(name, callback);
      },
    },
  } as CloudflareHookRegistry;
  registerCloudflareEvents(plugin);
  return callbacks;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

describe("Nitro Cloudflare event registration", () => {
  it("registers both scheduled and queue handlers and resolves event bindings", async () => {
    const callbacks = createHooks();
    const expectedEnvironment = { SERAMET_ENVIRONMENT: "test", SERAMET_DB: "resolved-test-db" };
    const bindings = { SERAMET_HYPERDRIVE: "staging-test-binding" };
    const batch = {
      queue: "staging-work",
      messages: [],
    } as unknown as DurableQueueBatch<SerametWorkerMessage>;

    expect([...callbacks.keys()].sort()).toEqual(["cloudflare:queue", "cloudflare:scheduled"]);
    await callbacks.get("cloudflare:scheduled")!({ env: bindings });
    await callbacks.get("cloudflare:queue")!({ env: bindings, batch });

    expect(resolveEnvironmentFromBindings).toHaveBeenCalledTimes(2);
    expect(resolveEnvironmentFromBindings).toHaveBeenCalledWith(bindings);
    expect(scheduleDurableWork).toHaveBeenCalledWith(expectedEnvironment);
    expect(handleWorkerQueue).toHaveBeenCalledWith(batch, expectedEnvironment);
  });

  it("rejects malformed Queue events instead of silently acknowledging them", async () => {
    const callbacks = createHooks();
    await expect(callbacks.get("cloudflare:queue")!({ env: {} })).rejects.toThrow(
      "did not include a batch",
    );
    expect(handleWorkerQueue).not.toHaveBeenCalled();
  });
});
