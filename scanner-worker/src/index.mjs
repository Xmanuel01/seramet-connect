import { WorkerEntrypoint } from "cloudflare:workers";
import { scanViaClamavGateway } from "./scan-adapter.mjs";

/** Exposes a private RPC-only service to the Seramet POS Worker. */
export default class SerametMalwareScanner extends WorkerEntrypoint {
  // Cloudflare requires a registered event handler, even for an RPC-only service.
  // Never expose file scanning over HTTP. The Worker has no public routes.
  async fetch() {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  async scan(input) {
    return scanViaClamavGateway(input, this.env);
  }
}
