import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLovableSource } from "./assert-no-lovable-source.mjs";

test("allows the restored Seramet POS application and normal import code", () => {
  const files = ["src/routes/pos.tsx", "src/lib/menu-import-export.ts", "package.json"];
  assert.deepEqual(
    checkLovableSource(files, () => "Seramet native POS and menu import"),
    [],
  );
});

test("rejects external Lovable SDK dependencies on the active application", () => {
  const failures = checkLovableSource(["package.json"], () =>
    JSON.stringify({ dependencies: { ["@lovable.dev/" + "vite-tanstack-config"]: "2.23.1" } }),
  );
  assert.equal(failures.length, 1);
});

test("rejects accidental document extraction gateway integration", () => {
  const errors = checkLovableSource(
    ["src/lib/upload.ts"],
    () => 'fetch("https://ai.gateway.lovable.dev/v1/chat/completions")',
  );
  assert.equal(errors.length, 1);
});

test("does not mistake normal product source for Lovable integration", () => {
  assert.deepEqual(
    checkLovableSource(
      ["src/routes/data-import.tsx"],
      () => "export function validateCsvRows() { return []; }",
    ),
    [],
  );
});
