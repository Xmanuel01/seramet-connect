import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptSpoolJob } from "./spool-ledger.mjs";

const ticket = {
  id: "KPO-ONE:PRODUCTION_PRINT:copy-1",
  orderId: "ORD-001",
  documentType: "FOOD_KOT",
  printerId: "Kitchen 1",
  content: "Table 1\\nBeef pilau x 1",
};

async function isolated(run) {
  const folder = await mkdtemp(join(tmpdir(), "seramet-spool-"));
  try {
    await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("spools each stable identity once, including after simulated restart", async () => {
  await isolated(async (dataDir) => {
    let prints = 0;
    const spool = async () => {
      prints += 1;
      return { printed: true, message: "accepted" };
    };
    const input = { dataDir, job: ticket, printerName: "Kitchen 1", dryRun: false, spool };
    const first = await acceptSpoolJob(input);
    const afterRestart = await acceptSpoolJob(input);
    assert.equal(first.status, 202);
    assert.equal(first.physicalPrintConfirmed, false);
    assert.equal(afterRestart.status, 202);
    assert.equal(afterRestart.replayed, true);
    assert.equal(prints, 1);
    assert.equal(first.bridgeJobId, afterRestart.bridgeJobId);
    assert.ok((await readFile(join(dataDir, `${first.bridgeJobId}.txt`), "utf8")).includes("pilau"));
  });
});

test("concurrent submissions cannot spool the same KOT twice", async () => {
  await isolated(async (dataDir) => {
    let release;
    const blocker = new Promise((resolve) => { release = resolve; });
    let prints = 0;
    const input = {
      dataDir,
      job: ticket,
      printerName: "Kitchen 1",
      dryRun: false,
      spool: async () => {
        prints += 1;
        await blocker;
        return { printed: true };
      },
    };
    const first = acceptSpoolJob(input);
    // Wait for the marker to exist without relying on fixed delays.
    let concurrent;
    for (let i = 0; i < 300; i += 1) {
      concurrent = await acceptSpoolJob(input);
      if (concurrent.status === 409) break;
      if (concurrent.replayed) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    release();
    await first;
    assert.equal(prints, 1);
    assert.equal(concurrent?.accepted === false || concurrent?.replayed === true, true);
  });
});

test("ambiguous spool failure remains uncertain and is never auto-reprinted", async () => {
  await isolated(async (dataDir) => {
    let attempts = 0;
    const input = {
      dataDir,
      job: ticket,
      printerName: "Kitchen 1",
      dryRun: false,
      spool: async () => {
        attempts += 1;
        throw new Error("The printer response was lost after a possible physical print");
      },
    };
    const first = await acceptSpoolJob(input);
    const retry = await acceptSpoolJob(input);
    assert.equal(first.uncertain, true);
    assert.equal(retry.status, 409);
    assert.equal(retry.uncertain, true);
    assert.equal(attempts, 1);
  });
});

test("the same ID cannot silently print changed content or another printer target", async () => {
  await isolated(async (dataDir) => {
    const input = {
      dataDir,
      job: ticket,
      printerName: "Kitchen 1",
      dryRun: true,
      spool: async () => { throw new Error("dry-run must never call the physical printer"); },
    };
    await acceptSpoolJob(input);
    const mismatch = await acceptSpoolJob({
      ...input,
      job: { ...ticket, content: "Two items instead of one" },
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.accepted, false);
    const auditedReprint = await acceptSpoolJob({
      ...input,
      job: { ...ticket, id: "KPO-REPRINT:PRODUCTION_PRINT:copy-1" },
    });
    assert.equal(auditedReprint.status, 202);
    assert.equal(auditedReprint.dryRun, true);
  });
});
