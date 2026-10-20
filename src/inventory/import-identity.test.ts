import { expect, it } from "vitest";
import { inventoryUploadKey } from "./import-identity";
it("preserves distinct upload identities through the existing 80-character worker-ID limit", async () => {
  const input = {
    branchId: "branch-with-a-long-identifier-".repeat(3),
    filename: "store.csv",
    mimeType: "text/csv",
    skipExisting: true,
    fileDigest: "a".repeat(64),
  };
  const first = await inventoryUploadKey(input);
  expect(first).toBe(await inventoryUploadKey(input));
  const legacyId = (key: string) => `setup-import-prepare-${key}`.slice(0, 80);
  for (const change of [
    { fileDigest: "b".repeat(64) },
    { branchId: "different-branch" },
    { skipExisting: false },
    { filename: "other.csv" },
  ])
    expect(legacyId(await inventoryUploadKey({ ...input, ...change }))).not.toBe(legacyId(first));
});
