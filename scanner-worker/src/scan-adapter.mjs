/** Private, fail-closed ClamAV gateway adapter. No public worker endpoint. */
export async function scanViaClamavGateway(input, env, fetchImpl = fetch) {
  if (!(input?.bytes instanceof ArrayBuffer) || input.bytes.byteLength < 1 ||
      input.bytes.byteLength > 20 * 1024 * 1024) return { status: "ERROR" };
  const upstream = env?.AV_UPSTREAM_URL;
  const token = env?.AV_UPSTREAM_TOKEN;
  if (typeof upstream !== "string" || typeof token !== "string" ||
      token.length < 24) return { status: "ERROR" };
  let url;
  try {
    url = new URL(upstream);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      return { status: "ERROR" };
    }
  } catch { return { status: "ERROR" }; }
  // Avoid transmitting personally identifying uploaded filenames.
  const ext = /\.[a-z0-9]{1,8}$/i.exec(input.fileName ?? "")?.[0]?.toLowerCase() ?? "";
  try {
    const response = await fetchImpl(url.toString(), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/octet-stream",
        "X-File-Extension": ext,
        "X-Original-Content-Type": String(input.contentType ?? "").slice(0, 128),
      },
      body: input.bytes,
    });
    if (!response.ok || response.status !== 200) return { status: "ERROR" };
    const result = await response.json();
    if (!result || result.engine !== "clamav" ||
        typeof result.signatureVersion !== "string" || !result.signatureVersion.trim() ||
        !["CLEAN", "INFECTED"].includes(result.status) ||
        typeof result.reference !== "string" || result.reference.length > 128) {
      return { status: "ERROR" };
    }
    return { status: result.status, reference: result.reference };
  } catch {
    return { status: "ERROR" };
  }
}