import { describe, expect, it } from "vitest";
import { ManagedCredentialResolver } from "@/integrations/runtime/credential-resolver";
import { createEncryptedObjectSecretBinding } from "@/server/encrypted-object-secrets";
import type { ObjectStoreBinding } from "@/server/environment";
import { createSecretStore } from "@/server/secrets";

const key = Buffer.alloc(32, 7).toString("base64");
const reference = "managed://seramet/tenant-a/connection-mpesa";
const secrets = JSON.stringify({
  consumerKey: "ck-live",
  consumerSecret: "cs-live",
  passkey: "pk",
});

describe("restaurant credentials encrypted in object storage", () => {
  it("round-trips without storing any credential in plain text", async () => {
    const objects = memoryObjects();
    const binding = createEncryptedObjectSecretBinding(objects, key);
    await binding.put!(reference, secrets);
    const stored = [...objects.data.values()].join("");
    expect(stored).not.toContain("ck-live");
    expect(stored).not.toContain("cs-live");
    expect([...objects.data.keys()]).toEqual(["credentials/v1/tenant-a/connection-mpesa.json"]);
    expect((await binding.get(reference))?.value).toBe(secrets);
  });

  it("cannot be read under another restaurant's reference or with another key", async () => {
    const objects = memoryObjects();
    await createEncryptedObjectSecretBinding(objects, key).put!(reference, secrets);
    objects.data.set(
      "credentials/v1/tenant-b/connection-mpesa.json",
      objects.data.get("credentials/v1/tenant-a/connection-mpesa.json")!,
    );
    await expect(
      createEncryptedObjectSecretBinding(objects, key).get(
        "managed://seramet/tenant-b/connection-mpesa",
      ),
    ).rejects.toThrow();
    await expect(
      createEncryptedObjectSecretBinding(objects, Buffer.alloc(32, 9).toString("base64")).get(
        reference,
      ),
    ).rejects.toThrow();
  });

  it("only stores references Seramet created, and needs a 32-byte key", async () => {
    const binding = createEncryptedObjectSecretBinding(memoryObjects(), key);
    await expect(binding.put!("env://SERAMET_MPESA_PASSKEY", "x")).rejects.toThrow(/managed/);
    await expect(binding.put!("managed://seramet/../x", "x")).rejects.toThrow(/managed/);
    await expect(
      createEncryptedObjectSecretBinding(memoryObjects(), "c2hvcnQ=").put!(reference, "x"),
    ).rejects.toThrow(/32 bytes/);
  });

  it("is the server store when a key and object storage exist, and feeds the payment runtime", async () => {
    const env = {
      SERAMET_OBJECTS: memoryObjects(),
      SERAMET_CREDENTIAL_ENCRYPTION_KEY: key,
      SERAMET_SECRET_STORE: "cloudflare-worker-secrets",
    };
    const store = createSecretStore(env);
    await store.store!(reference, secrets);
    const resolver = new ManagedCredentialResolver(() => store);
    expect(await resolver.hasSecret(reference)).toBe(true);
    expect(await resolver.getSecret(reference)).toEqual(JSON.parse(secrets));
    expect(await resolver.hasSecret("secret://seramet/demo/daraja")).toBe(false);
  });
});

function memoryObjects(): ObjectStoreBinding & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async head(objectKey) {
      return data.has(objectKey) ? {} : null;
    },
    async get(objectKey) {
      const value = data.get(objectKey);
      if (value === undefined) return null;
      return { arrayBuffer: async () => new TextEncoder().encode(value).buffer as ArrayBuffer };
    },
    async put(objectKey, value) {
      data.set(objectKey, typeof value === "string" ? value : String(value));
      return {};
    },
    async delete(objectKey) {
      for (const item of Array.isArray(objectKey) ? objectKey : [objectKey]) data.delete(item);
    },
  };
}
