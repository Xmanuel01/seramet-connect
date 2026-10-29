import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyExistingCloudflareQueue } from "./verify-cloudflare-queue-response.mjs";

const name = "seramet-staging-file-scan";
for (const result of [[{ queue_name: name }], { queues: [{ name }] }]) {
  test(`accepts a verified existing queue in ${Array.isArray(result) ? "array" : "wrapped"} API results`, () => {
    assert.doesNotThrow(() => verifyExistingCloudflareQueue({ success: true, result }, name));
  });
}
for (const payload of [
  null,
  {},
  { success: false, result: [{ queue_name: name }] },
  { success: "true", result: [{ queue_name: name }] },
  { success: true, result: {} },
  { success: true, result: { queues: null } },
  { success: true, result: [null, { queue_name: "other" }] },
]) {
  test(`rejects failed, malformed or nonmatching queue response ${JSON.stringify(payload)}`, () => {
    assert.throws(() => verifyExistingCloudflareQueue(payload, name));
  });
}
test("requires an explicit queue identity", () => {
  assert.throws(() => verifyExistingCloudflareQueue({ success: true, result: [] }, ""));
});
