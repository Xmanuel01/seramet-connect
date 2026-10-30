import type { ObjectStoreBinding } from "@/server/environment";
import type { ManagedSecretStoreBinding } from "@/server/secrets";

/**
 * Restaurant-entered provider credentials, encrypted with AES-256-GCM before they reach object
 * storage. The key is a protected server secret; the reference is bound as additional data, so a
 * ciphertext copied to another restaurant's reference fails to decrypt.
 */
export function createEncryptedObjectSecretBinding(
  objects: ObjectStoreBinding,
  encodedKey: string,
): ManagedSecretStoreBinding {
  let key: Promise<CryptoKey> | undefined;
  const cryptoKey = () => (key ??= importKey(encodedKey));
  return {
    async get(reference) {
      const object = await objects.get(objectKey(reference));
      if (!object) return null;
      const text = object.arrayBuffer
        ? new TextDecoder().decode(await object.arrayBuffer())
        : await new Response(object.body).text();
      const envelope = JSON.parse(text) as Envelope;
      if (envelope.v !== 1 || envelope.alg !== "A256GCM")
        throw new Error("Unsupported credential envelope");
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(envelope.iv), additionalData: encode(reference) },
        await cryptoKey(),
        fromBase64(envelope.ct),
      );
      return { value: new TextDecoder().decode(plain), version: envelope.version };
    },
    async put(reference, value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encode(reference) },
        await cryptoKey(),
        encode(value),
      );
      const version = new Date().toISOString();
      const envelope: Envelope = {
        v: 1,
        alg: "A256GCM",
        iv: toBase64(iv),
        ct: toBase64(new Uint8Array(cipher)),
        version,
      };
      await objects.put(objectKey(reference), JSON.stringify(envelope), {
        httpMetadata: { contentType: "application/json" },
      });
      return { version };
    },
  };
}

type Envelope = { v: 1; alg: "A256GCM"; iv: string; ct: string; version: string };

// Only `managed://seramet/<tenant>/<connection>` references created by Seramet are stored here.
function objectKey(reference: string) {
  const match =
    /^managed:\/\/seramet\/([A-Za-z0-9][A-Za-z0-9._:-]*)\/([A-Za-z0-9][A-Za-z0-9._:-]*)$/.exec(
      reference,
    );
  if (!match) throw new Error("Credential reference is not managed by Seramet");
  return `credentials/v1/${match[1]}/${match[2]}.json`;
}

async function importKey(encoded: string) {
  const raw = fromBase64(encoded.trim());
  if (raw.byteLength !== 32) throw new Error("Credential encryption key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encode(value: string) {
  return new TextEncoder().encode(value);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
