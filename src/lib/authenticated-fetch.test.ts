import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("authentication recovery navigation", () => {
  it("returns expired ordinary sessions to employee login", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/pos", replace } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    const response = await authenticatedFetch("/api/seramet/transactions");

    expect(response.status).toBe(401);
    expect(replace).toHaveBeenCalledWith("/pos-login?reason=session-expired");
  });

  it.each(["/pos-login", "/login", "/register"])(
    "does not interrupt the public authentication flow at %s",
    async (pathname) => {
      const replace = vi.fn();
      vi.stubGlobal("window", { location: { pathname, replace } });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 401 })),
      );

      await authenticatedFetch("/api/seramet/transactions");

      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("retries a successfully refreshed session without changing its deep link", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/settings", replace } });
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", request);

    expect((await authenticatedFetch("/api/seramet/configuration")).status).toBe(200);
    expect(request).toHaveBeenCalledTimes(3);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not refresh or redirect a failed administrator sign-in request", async () => {
    const request = vi.fn(async () => new Response(null, { status: 401 }));
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { pathname: "/login", replace } });
    vi.stubGlobal("fetch", request);

    await authenticatedFetch("/api/seramet/public/auth/login");

    expect(request).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});
