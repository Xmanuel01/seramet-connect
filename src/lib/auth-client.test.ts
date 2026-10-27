import { afterEach, describe, expect, it, vi } from "vitest";
import { enterRestaurant, revokeAllBrowserSessions } from "@/lib/auth-client";
import { permissions } from "@/platform/permissions";

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

describe("restaurant entry", () => {
  it.each([
    {
      status: "IN_PROGRESS" as const,
      allowed: [permissions.dashboardView, permissions.setupView],
      path: "/seramet-setup",
    },
    {
      status: "COMPLETED" as const,
      allowed: [permissions.dashboardView, permissions.setupView],
      path: "/",
    },
    { status: undefined, allowed: [permissions.dashboardView, permissions.setupView], path: "/" },
    { status: "IN_PROGRESS" as const, allowed: [permissions.dashboardView], path: "/" },
    { status: "IN_PROGRESS" as const, allowed: [permissions.attendanceUse], path: "/attendance" },
  ])(
    "routes $status using authoritative permissions to $path",
    async ({ status, allowed, path }) => {
      const assign = vi.fn();
      const setItem = vi.fn();
      vi.stubGlobal("window", { localStorage: { setItem }, location: { assign } });
      const request = vi.fn(async () => Response.json({ actor: { permissions: allowed } }));
      vi.stubGlobal("fetch", request);
      await enterRestaurant({
        tenantId: "owner-tenant",
        slug: "fixture",
        name: "Fixture",
        onboardingStatus: status,
      });
      expect(setItem).toHaveBeenCalledWith("seramet.session.tenant-id", "owner-tenant");
      expect(assign).toHaveBeenCalledWith(path);
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps explicit attendance destinations unchanged", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem: vi.fn() }, location: { assign } });
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    await enterRestaurant(
      {
        tenantId: "owner-tenant",
        slug: "fixture",
        name: "Fixture",
        onboardingStatus: "IN_PROGRESS",
      },
      "/attendance",
    );
    expect(assign).toHaveBeenCalledWith("/attendance");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not use onboarding metadata when the authoritative session is rejected", async () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem: vi.fn() }, location: { assign } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await enterRestaurant({
      tenantId: "owner-tenant",
      slug: "fixture",
      name: "Fixture",
      onboardingStatus: "IN_PROGRESS",
    });
    expect(assign).toHaveBeenCalledWith("/");
    expect(assign).not.toHaveBeenCalledWith("/seramet-setup");
  });
});
