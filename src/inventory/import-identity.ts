export async function inventoryUploadKey(input: {
  branchId: string;
  filename: string;
  mimeType: string;
  skipExisting: boolean;
  fileDigest: string;
}) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        input.branchId,
        input.filename,
        input.mimeType,
        input.skipExisting,
        input.fileDigest,
      ]),
    ),
  );
  // Keep entropy at the front: legacy worker IDs truncate long human-readable keys.
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
