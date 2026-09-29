import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function identityHash(identity) {
  return createHash("sha256").update(identity).digest("hex");
}

/**
 * Fail-closed local spool claim.
 * A claim is durably written BEFORE invoking the OS printer. If the bridge
 * crashes mid-spool, a replay gets UNCERTAIN, not a duplicate print.
 */
export async function acceptSpoolJob({ dataDir, job, printerName, dryRun, spool }) {
  await mkdir(dataDir, { recursive: true });
  const identity = String(job.id);
  if (!identity || identity.length > 160) {
    return { status: 400, accepted: false, message: "Invalid bridge print identity" };
  }
  const fingerprint = identityHash(
    JSON.stringify({
      orderId: job.orderId,
      documentType: job.documentType,
      printerName: printerName ?? job.printerId,
      content: job.content,
    }),
  );
  const markerPath = join(dataDir, `claim-${identityHash(identity)}.json`);
  let claim;
  try {
    claim = await open(markerPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let previous;
    try {
      previous = JSON.parse(await readFile(markerPath, "utf8"));
    } catch {
      return {
        status: 409,
        accepted: false,
        uncertain: true,
        message: "Existing bridge claim could not be read; investigate before reprinting",
      };
    }
    if (previous.fingerprint !== fingerprint) {
      return {
        status: 409,
        accepted: false,
        uncertain: true,
        message: "Same print identity cannot carry different content or printer target",
      };
    }
    if (previous.status === "SPOOL_ACCEPTED") {
      return {
        status: 202,
        accepted: true,
        replayed: true,
        bridgeJobId: previous.bridgeJobId,
        dryRun: previous.dryRun,
        physicalPrintConfirmed: false,
        message: "Previously accepted by this local OS spool; no duplicate sent",
      };
    }
    return {
      status: 409,
      accepted: false,
      uncertain: true,
      bridgeJobId: previous.bridgeJobId,
      message: "Existing printer attempt has uncertain outcome; manual review is required",
    };
  }
  const bridgeJobId = randomUUID();
  const claimed = {
    id: identity,
    fingerprint,
    bridgeJobId,
    status: "CLAIMED",
    dryRun,
    createdAt: new Date().toISOString(),
  };
  try {
    await claim.writeFile(JSON.stringify(claimed), "utf8");
    await claim.sync();
  } finally {
    await claim.close();
  }

  const spoolPath = join(dataDir, `${bridgeJobId}.txt`);
  try {
    await writeFile(spoolPath, job.content, { encoding: "utf8", mode: 0o600, flush: true });
    const result = dryRun
      ? { printed: true, command: "dry-run", message: "Dry-run: spooled without a real printer" }
      : await spool(spoolPath, printerName ?? job.printerId);
    if (!result.printed) {
      await writeFile(markerPath, JSON.stringify({ ...claimed, status: "UNCERTAIN" }), {
        encoding: "utf8",
        flush: true,
      });
      return {
        status: 502,
        accepted: false,
        uncertain: true,
        bridgeJobId,
        message: "OS spool did not confirm acceptance; physical output remains uncertain",
      };
    }
    await writeFile(
      markerPath,
      JSON.stringify({ ...claimed, status: "SPOOL_ACCEPTED", updatedAt: new Date().toISOString() }),
      { encoding: "utf8", flush: true },
    );
    return {
      status: 202,
      accepted: true,
      bridgeJobId,
      dryRun,
      physicalPrintConfirmed: false,
      message: dryRun
        ? "Dry-run accepted; no paper printed"
        : "Operating-system spool accepted; physical output is not independently confirmed",
    };
  } catch {
    // Leave the pre-written CLAIMED marker as uncertain crash/restart evidence.
    return {
      status: 503,
      accepted: false,
      uncertain: true,
      bridgeJobId,
      message: "Printer attempt outcome uncertain; review rather than automatically retry",
    };
  }
}
