export async function requireInventoryResponse(response: Response, resource: string) {
  if (response.ok) return;
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
  };
  const detail = payload.message ?? payload.error;
  // The full text is for logs; the status and server message let the page show plain words.
  throw Object.assign(
    new Error(`${resource} query failed (${response.status})${detail ? `: ${detail}` : ""}`),
    { httpStatus: response.status, serverMessage: detail ?? "" },
  );
}
