import { WorkerEntrypoint } from "cloudflare:workers";
import { scanViaClamavGateway } from "./scan-adapter.mjs";

/** Exposes a private RPC-only service to the Seramet POS Worker. */
export default class SerametMalwareScanner extends WorkerEntrypoint {
  async scan(input) {
    return scanViaClamavGateway(input, this.env);
  }
}
