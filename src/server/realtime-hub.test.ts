import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { validateRuntimeConfiguration } from "@/server/environment";
import { RestaurantRegistrationService } from "@/server/registration-service";
import { publishRealtimeEvent, type RealtimeEvent } from "@/server/realtime";
import { handleRealtimeApi, realtimeReplay, realtimeSocketScope } from "@/server/realtime-api";
import {
  connectToRealtimeHub,
  eventVisibleTo,
  notifyRealtimeHub,
  realtimeHubName,
  realtimeHubRuntime,
  SerametRealtimeHub,
  type HubSocket,
  type HubState,
  type RealtimeHubNamespace,
  type RealtimeServerMessage,
  type RealtimeSocketScope,
} from "@/server/realtime-hub";

/** One end of a fake WebSocket pair: what the server sends lands in the client's inbox. */
class FakeSocket implements HubSocket {
  inbox: string[] = [];
  closed = false;
  private attachment: unknown;
  peer?: FakeSocket;
  send(message: string) {
    if (this.closed) throw new Error("closed");
    this.peer!.inbox.push(message);
  }
  close() {
    this.closed = true;
    if (this.peer) this.peer.closed = true;
  }
  serializeAttachment(value: unknown) {
    // Durable Objects store attachments structured-cloned; keep that behaviour.
    this.attachment = structuredClone(value);
  }
  deserializeAttachment() {
    return this.attachment;
  }
  messages(): RealtimeServerMessage[] {
    return this.inbox.map((value) => JSON.parse(value) as RealtimeServerMessage);
  }
  events() {
    return this.messages().flatMap((message) => (message.type === "event" ? [message.event] : []));
  }
}

class FakeState implements HubState {
  sockets: FakeSocket[] = [];
  acceptWebSocket(socket: HubSocket) {
    this.sockets.push(socket as FakeSocket);
  }
  getWebSockets() {
    return this.sockets.filter((socket) => !socket.closed);
  }
}

/** A Durable Object namespace: one hub instance per name, as Cloudflare guarantees. */
class FakeNamespace implements RealtimeHubNamespace {
  hubs = new Map<string, SerametRealtimeHub>();
  idFromName(name: string) {
    return name;
  }
  get(id: unknown) {
    const name = String(id);
    let hub = this.hubs.get(name);
    if (!hub) {
      hub = new SerametRealtimeHub(new FakeState());
      this.hubs.set(name, hub);
    }
    const target = hub;
    return {
      fetch: (input: Request | string, init?: RequestInit) =>
        target.fetch(typeof input === "string" ? new Request(input, init) : input),
    };
  }
}

let lastClient: FakeSocket | undefined;
const originalRuntime = { ...realtimeHubRuntime };

beforeEach(() => {
  realtimeHubRuntime.createPair = () => {
    const client = new FakeSocket();
    const server = new FakeSocket();
    client.peer = server;
    server.peer = client;
    lastClient = client;
    return [client, server];
  };
  // Node's Response refuses status 101; the client end is what the Worker would return.
  realtimeHubRuntime.upgradeResponse = (client) => {
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, "client", { value: client });
    return response;
  };
  realtimeHubRuntime.autoResponsePair = () => undefined;
});

afterEach(() => {
  Object.assign(realtimeHubRuntime, originalRuntime);
  vi.restoreAllMocks();
});

async function openSocket(
  hub: RealtimeHubNamespace,
  scope: RealtimeSocketScope,
  replay: Parameters<typeof connectToRealtimeHub>[3] = { events: [], truncated: false },
) {
  const request = new Request("https://pos.example.test/api/seramet/realtime/socket", {
    headers: { upgrade: "websocket" },
  });
  const response = await connectToRealtimeHub(hub, request, scope, replay);
  return (response as Response & { client: FakeSocket }).client;
}

function event(overrides: Partial<RealtimeEvent> = {}): RealtimeEvent {
  return {
    id: crypto.randomUUID(),
    branchId: "branch-a1",
    topic: "transactions",
    entityType: "TRANSACTION_COMMAND",
    entityId: crypto.randomUUID(),
    eventType: "addOrderItem",
    correlationId: crypto.randomUUID(),
    payload: { revision: 1 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const scope = (overrides: Partial<RealtimeSocketScope> = {}): RealtimeSocketScope => ({
  tenantId: "tenant-a",
  actorId: "actor-1",
  branches: "ALL",
  ...overrides,
});

describe("realtime hub fan-out", () => {
  it("delivers a write for restaurant A to A's sockets only", async () => {
    const hub = new FakeNamespace();
    const a1 = await openSocket(hub, scope({ branchId: "branch-a1" }));
    const a2 = await openSocket(hub, scope({ actorId: "actor-2", branchId: "branch-a2" }));
    const aOwner = await openSocket(hub, scope({ actorId: "owner-a" }));
    const b = await openSocket(
      hub,
      scope({ tenantId: "tenant-b", actorId: "actor-b", branchId: "branch-b1" }),
    );
    for (const socket of [a1, a2, aOwner, b]) socket.inbox = [];

    const write = event({ branchId: "branch-a1" });
    await notifyRealtimeHub(hub, "tenant-a", [write]);

    expect(a1.events().map((item) => item.id)).toEqual([write.id]);
    expect(aOwner.events().map((item) => item.id)).toEqual([write.id]);
    // Same restaurant, other branch: not visible.
    expect(a2.events()).toEqual([]);
    // Other restaurant: different object, never notified.
    expect(b.inbox).toEqual([]);
    expect([...hub.hubs.keys()].sort()).toEqual([
      realtimeHubName("tenant-a"),
      realtimeHubName("tenant-b"),
    ]);

    const menu = event({ branchId: null, topic: "menu" });
    await notifyRealtimeHub(hub, "tenant-a", [menu]);
    expect(a2.events().map((item) => item.id)).toEqual([menu.id]);
    expect(b.inbox).toEqual([]);
  });

  it("drops a publish whose tenant does not match the sockets' scope", async () => {
    const hub = new FakeNamespace();
    const a1 = await openSocket(hub, scope({ branchId: "branch-a1" }));
    a1.inbox = [];
    const stub = hub.get(hub.idFromName(realtimeHubName("tenant-a")));
    const response = await stub.fetch("https://realtime-hub/publish", {
      method: "POST",
      body: JSON.stringify({ tenantId: "tenant-b", events: [event()] }),
    });
    expect(await response.json()).toEqual({ ok: true, delivered: 0 });
    expect(a1.inbox).toEqual([]);
  });

  it("limits branch-less sockets to the actor's readable branches", async () => {
    const hub = new FakeNamespace();
    const cashier = await openSocket(hub, scope({ branches: ["branch-a1"] }));
    cashier.inbox = [];
    const other = event({ branchId: "branch-a2" });
    const own = event({ branchId: "branch-a1" });
    await notifyRealtimeHub(hub, "tenant-a", [other, own]);
    expect(cashier.events().map((item) => item.id)).toEqual([own.id]);
  });

  it("keeps station-tagged events on their kitchen station devices", () => {
    const tagged = { branchId: "branch-a1", payload: { kitchenStationId: "grill" } };
    expect(eventVisibleTo(tagged, scope({ kitchenStationIds: ["grill"] }))).toBe(true);
    expect(eventVisibleTo(tagged, scope({ kitchenStationIds: ["bar"] }))).toBe(false);
    expect(eventVisibleTo(tagged, scope())).toBe(true);
  });

  it("stops delivering to closed sockets and never throws on a failed notify", async () => {
    const hub = new FakeNamespace();
    const a1 = await openSocket(hub, scope({ branchId: "branch-a1" }));
    a1.close();
    await expect(notifyRealtimeHub(hub, "tenant-a", [event()])).resolves.toBeUndefined();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken: RealtimeHubNamespace = {
      idFromName: (name) => name,
      get: () => ({ fetch: () => Promise.reject(new Error("object unavailable")) }),
    };
    await expect(notifyRealtimeHub(broken, "tenant-a", [event()])).resolves.toBeUndefined();
    await expect(notifyRealtimeHub(undefined, "tenant-a", [event()])).resolves.toBeUndefined();
  });

  it("answers heartbeats", () => {
    const hubObject = new SerametRealtimeHub(new FakeState());
    const socket = new FakeSocket();
    const peer = new FakeSocket();
    socket.peer = peer;
    hubObject.webSocketMessage(socket, "ping");
    expect(peer.inbox).toEqual(["pong"]);
  });

  it("bridges events announced between the catch-up query and the socket being accepted", async () => {
    const hub = new FakeNamespace();
    const before = event({ createdAt: "2026-11-12T10:00:00.000Z" });
    const during = event({ createdAt: "2026-11-12T10:00:01.000Z" });
    await notifyRealtimeHub(hub, "tenant-a", [before, during]);
    const socket = await openSocket(hub, scope({ branchId: "branch-a1" }), {
      events: [before],
      truncated: false,
      cursor: "2026-11-12T09:59:59.000Z|00000000-0000-0000-0000-000000000000",
    });
    expect(socket.events().map((item) => item.id)).toEqual([before.id, during.id]);
    expect(socket.messages().at(-1)).toEqual({
      type: "ready",
      cursor: `${during.createdAt}|${during.id}`,
    });
  });
});

describe.sequential("realtime catch-up from the event log", () => {
  let database: SqliteD1TestDatabase;
  let tenantA: { tenantId: string; branchId: string };
  let tenantB: { tenantId: string; branchId: string };

  beforeEach(async () => {
    database = createMigratedTestDatabase();
    tenantA = await register("realtime-a", "subject-a", "registration-realtime-0001");
    tenantB = await register("realtime-b", "subject-b", "registration-realtime-0002");
  });

  afterEach(() => database.close());

  async function register(slug: string, subject: string, idempotencyKey: string) {
    const issuedAt = Math.floor(Date.now() / 1000);
    return new RestaurantRegistrationService(database).register(
      {
        provider: "supabase",
        subject,
        sessionId: `supabase:${subject}`,
        email: `${subject}@example.test`,
        emailVerified: true,
        issuedAt: issuedAt - 60,
        expiresAt: issuedAt + 3600,
      },
      {
        idempotencyKey,
        administratorName: "Restaurant Owner",
        slug,
        legalName: `${slug} Limited`,
        tradingName: slug,
        countryCode: "KE",
        currency: "KES",
        timezone: "Africa/Nairobi",
        locale: "en-KE",
        brandCode: "PRIMARY",
        brandName: slug,
        branchCode: "MAIN",
        branchName: "Main Branch",
        businessDayCutoffMinutes: 240,
        negativeStockPolicy: "MANAGER_OVERRIDE",
        serviceModes: ["DINE_IN", "TAKEAWAY"],
      },
    );
  }

  function publish(
    hub: RealtimeHubNamespace,
    tenant: { tenantId: string; branchId: string },
    entityId: string,
  ) {
    return publishRealtimeEvent(
      database,
      {
        tenantId: tenant.tenantId,
        branchId: tenant.branchId,
        topic: "orders",
        entityType: "ORDER",
        entityId,
        eventType: "UPDATED",
        correlationId: crypto.randomUUID(),
      },
      hub,
    );
  }

  async function reconnect(
    hub: RealtimeHubNamespace,
    socketScope: RealtimeSocketScope,
    cursor: string,
  ) {
    const replay = await realtimeReplay(database, socketScope, cursor);
    return openSocket(hub, socketScope, replay);
  }

  it("replays exactly the missed events after a reconnect, then resumes live", async () => {
    const hub = new FakeNamespace();
    const scopeA = scope({
      tenantId: tenantA.tenantId,
      branchId: tenantA.branchId,
      branches: [tenantA.branchId],
    });
    const first = await openSocket(hub, scopeA);
    await publish(hub, tenantA, "order-1");
    const live = first.messages().filter((message) => message.type === "event");
    expect(live.map((message) => message.event.entityId)).toEqual(["order-1"]);
    const cursor = live.at(-1)!.cursor;

    // The tab goes offline: writes land in the log while no socket is open.
    first.close();
    // Let the object forget them, as a hibernated object would.
    hub.hubs.clear();
    await publish(hub, tenantA, "order-2");
    await publish(hub, tenantB, "order-b");
    await publish(hub, tenantA, "order-3");

    const second = await reconnect(hub, scopeA, cursor);
    expect(second.events().map((item) => item.entityId)).toEqual(["order-2", "order-3"]);
    const ready = second.messages().at(-1);
    expect(ready?.type).toBe("ready");

    await publish(hub, tenantA, "order-4");
    expect(second.events().map((item) => item.entityId)).toEqual(["order-2", "order-3", "order-4"]);
  });

  it("asks for a snapshot reload when the gap exceeds the replay", async () => {
    const hub = new FakeNamespace();
    const scopeA = scope({ tenantId: tenantA.tenantId, branchId: tenantA.branchId });
    const cursor = `${new Date(Date.now() - 1_000).toISOString()}|00000000-0000-0000-0000-000000000000`;
    for (let index = 0; index < 52; index += 1) await publish(hub, tenantA, `order-${index}`);
    hub.hubs.clear();
    const socket = await reconnect(hub, scopeA, cursor);
    expect(socket.messages()[0]).toEqual({ type: "resync" });
    expect(socket.events()).toHaveLength(50);

    const stale = await realtimeReplay(
      database,
      scopeA,
      `${new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString()}|00000000-0000-0000-0000-000000000000`,
    );
    expect(stale).toMatchObject({ events: [], truncated: true });
  });

  it("never replays another restaurant's events", async () => {
    const hub = new FakeNamespace();
    const cursor = `${new Date(Date.now() - 1_000).toISOString()}|00000000-0000-0000-0000-000000000000`;
    await publish(hub, tenantB, "order-b");
    const replay = await realtimeReplay(
      database,
      scope({ tenantId: tenantA.tenantId, branchId: tenantA.branchId }),
      cursor,
    );
    expect(replay.events).toEqual([]);
  });
});

describe("realtime socket upgrade", () => {
  const actor = (overrides: Partial<ServerActor> = {}): ServerActor => ({
    id: "actor-1",
    name: "Cashier",
    tenantId: "tenant-a",
    roleIds: [],
    permissions: [],
    assignedBranchIds: ["branch-a1", "branch-a2"],
    assignedBranches: [],
    branchScope: { type: "BRANCH", branchId: "branch-a1" },
    branchId: "branch-a1",
    role: "CASHIER" as ServerActor["role"],
    branch: "Main",
    ...overrides,
  });
  const url = (query: string) =>
    new URL(`https://pos.example.test/api/seramet/realtime/socket?${query}`);

  it("fixes tenant, branch and station scope from the authenticated actor", () => {
    expect(realtimeSocketScope(actor(), url("tenant=tenant-a&branchId=branch-a1"))).toEqual({
      tenantId: "tenant-a",
      actorId: "actor-1",
      branchId: "branch-a1",
      branches: ["branch-a1"],
    });
    expect(
      realtimeSocketScope(
        actor({ permissions: [permissions.branchSwitch], kitchenStationIds: ["grill"] }),
        url(""),
      ),
    ).toEqual({
      tenantId: "tenant-a",
      actorId: "actor-1",
      branches: ["branch-a1", "branch-a2"],
      kitchenStationIds: ["grill"],
    });
    expect(() => realtimeSocketScope(actor(), url("tenant=tenant-b"))).toThrow(/Cross-tenant/);
    expect(() => realtimeSocketScope(actor(), url("branchId=branch-a2"))).toThrow();
  });

  it("refuses non-upgrade requests, missing push bindings and foreign origins", async () => {
    const hub = new FakeNamespace();
    const env = { SERAMET_DB: {} as SerametEnv["SERAMET_DB"], SERAMET_REALTIME_HUB: hub };
    const plain = await handleRealtimeApi(
      new Request("https://pos.example.test/api/seramet/realtime/socket"),
      env,
    );
    expect(plain?.status).toBe(426);
    const upgrade = (origin: string) =>
      new Request("https://pos.example.test/api/seramet/realtime/socket", {
        headers: { upgrade: "websocket", origin },
      });
    await expect(handleRealtimeApi(upgrade("https://pos.example.test"), {})).rejects.toMatchObject({
      status: 503,
    });
    await expect(handleRealtimeApi(upgrade("https://evil.example"), env)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("requires the hub binding in production readiness", () => {
    const issues = validateRuntimeConfiguration({ SERAMET_ENVIRONMENT: "production" });
    expect(issues.map((issue) => issue.code)).toContain("REALTIME_HUB_REQUIRED");
    const ready = validateRuntimeConfiguration({
      SERAMET_ENVIRONMENT: "production",
      SERAMET_REALTIME_HUB: new FakeNamespace(),
    });
    expect(ready.map((issue) => issue.code)).not.toContain("REALTIME_HUB_REQUIRED");
  });
});
