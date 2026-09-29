import type { DurableQueueBatch } from "@/server/environment";
import type { SerametWorkerMessage } from "@/server/workers";
import { handleWorkerQueue, scheduleDurableWork } from "@/server/workers";
import { resolveEnvironmentFromBindings } from "@/server/runtime-env-resolver";

/**
 * Nitro's cloudflare-module adapter receives queue/cron events itself.
 * It forwards them via these Nitro runtime hooks, rather than invoking
 * extra methods on TanStack Start's src/server.ts HTTP entrypoint.
 */
type CloudflareEventContext = {
  env: unknown;
  batch?: DurableQueueBatch<SerametWorkerMessage>;
};

export type CloudflareHookRegistry = {
  hooks: {
    hook(
      name: "cloudflare:queue" | "cloudflare:scheduled",
      callback: (context: CloudflareEventContext) => Promise<void>,
    ): void;
  };
};

export default function registerSerametCloudflareEvents(nitro: CloudflareHookRegistry) {
  // Also checked in the compiled Worker artifact so missing event wiring fails CI.
  console.info("seramet-cloudflare-event-hooks:registered");

  nitro.hooks.hook("cloudflare:scheduled", async ({ env }) => {
    console.info("seramet-cloudflare-event-hooks:scheduled");
    await scheduleDurableWork(await resolveEnvironmentFromBindings(env));
  });

  nitro.hooks.hook("cloudflare:queue", async ({ batch, env }) => {
    if (!batch) throw new Error("Cloudflare Queue event did not include a batch");
    console.info("seramet-cloudflare-event-hooks:queue", { messages: batch.messages.length });
    await handleWorkerQueue(batch, await resolveEnvironmentFromBindings(env));
  });
}
