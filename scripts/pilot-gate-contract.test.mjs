import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const postgresWorkflow = await readFile(
  new URL("../.github/workflows/pos-postgres.yml", import.meta.url),
  "utf8",
);

test("the full pilot gate includes the local gate and PostgreSQL certification", () => {
  assert.equal(
    packageJson.scripts["test:pilot"],
    "npm run test:pilot:local && npm run test:pos-postgres && npm run test:menu-import-postgres",
  );
  assert.equal(
    packageJson.scripts["test:menu-import-postgres"],
    "vite-node scripts/verify-menu-import-postgres.ts",
  );
  assert.match(packageJson.scripts["test:pilot:local"], /npm run test:e2e/);
  assert.match(postgresWorkflow, /run: npm run test:pilot/);
});
