import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeAllBrowserSessions } from "@/lib/auth-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sign out", () => {
  it("revokes administrator and employee sessions together", async () => {
    const request = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", request);

    await revokeAllBrowserSessions();

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith("/api/seramet/public/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    expect(request).toHaveBeenCalledWith("/api/seramet/public/employee/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  });

  it("does not claim a successful logout if employee revocation fails", async () => {
    const request = vi.fn(
      async (url: string) =>
        new Response(null, {
          status: url.includes("/employee/logout") ? 503 : 200,
        }),
    );
    vi.stubGlobal("fetch", request);

    await expect(revokeAllBrowserSessions()).rejects.toThrow(
      "Could not confirm that all sessions were revoked",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("fails safely if either logout request cannot reach the server", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.includes("/auth/logout")) throw new Error("offline");
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", request);

    await expect(revokeAllBrowserSessions()).rejects.toThrow(
      "Could not confirm that all sessions were revoked",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});
