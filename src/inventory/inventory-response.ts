export async function requireInventoryResponse(response: Response, resource: string) {
  if (response.ok) return;
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
  const detail = payload.message ?? payload.error;
  throw new Error(`${resource} query failed (${response.status})${detail ? `: ${detail}` : ""}`);
}
