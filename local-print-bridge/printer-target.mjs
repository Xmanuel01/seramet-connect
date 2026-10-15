import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export function permittedAddress(address, localTest = false) {
  if (localTest && ["127.0.0.1", "::1"].includes(address)) return true;
  if (isIP(address) !== 4) return false;
  const [a, b, c, d] = address.split(".").map(Number);
  if (d === 0 || d === 255) return false;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168 && !(c === 0 && d === 0))
  );
}

export async function resolvePrinterTarget(target, { localTest = false, resolve = lookup } = {}) {
  if (target.transport !== "TCP") throw new Error("INVALID_TRANSPORT");
  const port = target.port ?? 9100;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("INVALID_PORT");
  if (typeof target.host !== "string" || !/^[a-zA-Z0-9.:-]{1,253}$/.test(target.host)) {
    throw new Error("INVALID_HOST");
  }
  const addresses = isIP(target.host)
    ? [{ address: target.host, family: isIP(target.host) }]
    : await resolve(target.host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !permittedAddress(address, localTest))) {
    throw new Error("DESTINATION_DENIED");
  }
  // Connect to the checked numeric address, never resolve the hostname again.
  return { host: addresses[0].address, family: addresses[0].family, port };
}
