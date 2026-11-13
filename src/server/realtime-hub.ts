import type { RealtimeEvent } from "@/server/realtime";

/**
 * Server push for live updates.
 *
 * One Durable Object per restaurant (tenant) holds that restaurant's browser WebSockets.
 * Sockets are accepted with the hibernation API, so an idle restaurant costs no Durable
 * Object duration: the object sleeps until a write announces an event or a socket closes.
 *
 * Writers still insert into `realtime_events` (the catch-up log) and then call
 * `notifyRealtimeHub`, which hands the new rows to the restaurant's object. The object fans
 * each event out only to sockets whose authenticated scope may see it.
 *
 * Why one object per tenant rather than per tenant+branch: tenant-wide events
 * (branch_id NULL, e.g. a published menu) and owners watching several branches would
 * otherwise need one notification per branch object. A restaurant has tens of open
 * devices at most, so one object filtering by branch is cheaper and simpler, and the
 * object key is the same tenant boundary every other check uses.
 */

export const REALTIME_HUB_CLASS = "SerametRealtimeHub";
export const REALTIME_SOCKET_PATH = "/api/seramet/realtime/socket";

/** Replay passed from the Worker to the object at upgrade; larger gaps ask for a resync. */
export const REALTIME_REPLAY_LIMIT = 50;
const REPLAY_HEADER_LIMIT = 32_000;
const RECENT_LIMIT = 200;
const RECENT_WINDOW_MS = 60_000;
const ZERO_ID = "00000000-0000-0000-0000-000000000000";

export type RealtimeHubStub = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

export type RealtimeHubNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown, options?: { locationHint?: string }): RealtimeHubStub;
};

/**
 * A Durable Object lives where it is first created. Every caller (requests placed next to
 * the database, queue and cron runs anywhere) asks for Western Europe, so each restaurant's
 * hub sits beside the Workers and the database (Supabase eu-west-1) that notify it.
 */
const HUB_LOCATION = { locationHint: "weur" };

function hubStub(hub: RealtimeHubNamespace, tenantId: string) {
  return hub.get(hub.idFromName(realtimeHubName(tenantId)), HUB_LOCATION);
}

/** What an authenticated socket may see, fixed at upgrade time and kept across hibernation. */
export type RealtimeSocketScope = {
  tenantId: string;
  actorId: string;
  /** The branch the client subscribed to; events of other branches are not sent. */
  branchId?: string;
  /** Branches the actor may read, used when no single branch was subscribed. */
  branches: "ALL" | string[];
  /** Kitchen-station devices see station-tagged events for their own stations only. */
  kitchenStationIds?: string[];
};

export type RealtimeReplay = {
  events: RealtimeEvent[];
  /** The gap was larger than the replay (or older than retention): reload a snapshot. */
  truncated: boolean;
  /** The cursor the client resumed from, if any. */
  cursor?: string;
};

export type RealtimeServerMessage =
  | { type: "event"; cursor: string; event: RealtimeEvent }
  | { type: "ready"; cursor: string }
  | { type: "resync" };

export function realtimeHubName(tenantId: string) {
  return `tenant:${tenantId}`;
}

export function realtimeCursor(event: Pick<RealtimeEvent, "createdAt" | "id">) {
  return `${event.createdAt}|${event.id}`;
}

function compareCursor(left: string, right: string) {
  // ISO-8601 UTC timestamps and lowercase UUIDs both order lexically.
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Tenant, branch and station visibility, the same rules the SSE stream's query applies. */
export function eventVisibleTo(
  event: Pick<RealtimeEvent, "branchId" | "payload">,
  scope: RealtimeSocketScope,
) {
  if (event.branchId) {
    if (scope.branchId) {
      if (event.branchId !== scope.branchId) return false;
    } else if (scope.branches !== "ALL" && !scope.branches.includes(event.branchId)) {
      return false;
    }
  }
  const station = event.payload?.["kitchenStationId"];
  if (typeof station === "string" && scope.kitchenStationIds !== undefined) {
    return scope.kitchenStationIds.includes(station);
  }
  return true;
}

/**
 * Announce committed `realtime_events` rows to the restaurant's sockets. Never throws: the
 * rows are already durable, and clients catch up from the log when they reconnect.
 */
export async function notifyRealtimeHub(
  hub: RealtimeHubNamespace | undefined,
  tenantId: string,
  events: RealtimeEvent[],
) {
  if (!hub || !events.length) return;
  try {
    const stub = hubStub(hub, tenantId);
    const response = await withTimeout(
      stub.fetch("https://realtime-hub/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId, events }),
      }),
      // The write has committed; never hold its response long for a push.
      1_500,
    );
    await response.body?.cancel();
  } catch (error) {
    console.warn("seramet-realtime-hub:notify-failed", {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * JSON as a header value: JSON.stringify already escapes control characters, and escaping
 * everything outside ASCII keeps the value legal without the 2-3x growth of percent-encoding.
 */
function headerJson(value: unknown) {
  return JSON.stringify(value).replace(
    /[^ -~]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime hub timed out")), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Worker side of the upgrade: hand the authenticated socket to the restaurant's object. */
export function connectToRealtimeHub(
  hub: RealtimeHubNamespace,
  request: Request,
  scope: RealtimeSocketScope,
  replay: RealtimeReplay,
) {
  let encodedReplay = headerJson(replay);
  if (encodedReplay.length > REPLAY_HEADER_LIMIT) {
    encodedReplay = headerJson({ events: [], truncated: true, cursor: replay.cursor });
  }
  const headers = new Headers({
    upgrade: "websocket",
    "x-seramet-realtime-scope": headerJson(scope),
    "x-seramet-realtime-replay": encodedReplay,
  });
  for (const name of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return hubStub(hub, scope.tenantId).fetch("https://realtime-hub/connect", { headers });
}

// ---------------------------------------------------------------------------------------
// Durable Object

export type HubSocket = {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

export type HubState = {
  acceptWebSocket(socket: HubSocket, tags?: string[]): void;
  getWebSockets(tag?: string): HubSocket[];
  setWebSocketAutoResponse?(pair: unknown): void;
};

/** Platform constructors, replaceable in tests (Node has no WebSocketPair or 101 Response). */
export const realtimeHubRuntime = {
  createPair(): [HubSocket, HubSocket] {
    const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, HubSocket> })
      .WebSocketPair;
    const pair = new Pair();
    return [pair[0], pair[1]];
  },
  upgradeResponse(client: HubSocket): Response {
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  },
  autoResponsePair(): unknown {
    const Pair = (
      globalThis as unknown as {
        WebSocketRequestResponsePair?: new (request: string, response: string) => unknown;
      }
    ).WebSocketRequestResponsePair;
    return Pair ? new Pair("ping", "pong") : undefined;
  },
};

type RecentEvent = { cursor: string; event: RealtimeEvent; receivedAt: number };

export class SerametRealtimeHub {
  /**
   * Events announced while this object was awake. They close the short window between the
   * Worker's catch-up query and the socket being accepted. Memory only: a hibernated object
   * has received nothing recently, so there is nothing to bridge.
   */
  private recent: RecentEvent[] = [];

  constructor(
    private readonly state: HubState,
    _env?: unknown,
  ) {
    // Heartbeats are answered by the runtime without waking (or billing) the object.
    const pair = realtimeHubRuntime.autoResponsePair();
    if (pair && state.setWebSocketAutoResponse) state.setWebSocketAutoResponse(pair);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") return this.publish(request);
    if (url.pathname === "/connect" && request.headers.get("upgrade") === "websocket") {
      return this.connect(request);
    }
    return new Response("Not found", { status: 404 });
  }

  private async publish(request: Request) {
    const body = (await request.json()) as { tenantId?: unknown; events?: unknown };
    if (typeof body.tenantId !== "string" || !Array.isArray(body.events)) {
      return new Response("Invalid publish", { status: 400 });
    }
    const tenantId = body.tenantId;
    const now = Date.now();
    this.recent = this.recent.filter((entry) => now - entry.receivedAt < RECENT_WINDOW_MS);
    const events = (body.events as RealtimeEvent[]).filter(
      (event) => event && typeof event.id === "string" && typeof event.createdAt === "string",
    );
    for (const event of events) {
      this.recent.push({ cursor: realtimeCursor(event), event, receivedAt: now });
    }
    if (this.recent.length > RECENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_LIMIT);

    // Serialise each event once, however many devices receive it.
    const messages = events.map((event) => ({
      event,
      text: JSON.stringify({
        type: "event",
        cursor: realtimeCursor(event),
        event,
      } satisfies RealtimeServerMessage),
    }));
    let delivered = 0;
    for (const socket of this.state.getWebSockets()) {
      const scope = socketScope(socket);
      // Defence in depth: the object name is the tenant, and so is every socket's scope.
      if (!scope || scope.tenantId !== tenantId) continue;
      for (const message of messages) {
        if (!eventVisibleTo(message.event, scope)) continue;
        if (sendText(socket, message.text)) delivered += 1;
      }
    }
    return Response.json({ ok: true, delivered });
  }

  private connect(request: Request) {
    const scope = parseHeader<RealtimeSocketScope>(request, "x-seramet-realtime-scope");
    const replay = parseHeader<RealtimeReplay>(request, "x-seramet-realtime-replay") ?? {
      events: [],
      truncated: false,
    };
    if (!scope?.tenantId || !scope.actorId) {
      return new Response("Missing socket scope", { status: 400 });
    }
    const [client, server] = realtimeHubRuntime.createPair();
    this.state.acceptWebSocket(server, [`actor:${scope.actorId}`]);
    server.serializeAttachment(scope);

    let cursor = replay.cursor ?? `${new Date(Date.now() - 5_000).toISOString()}|${ZERO_ID}`;
    const sent = new Set<string>();
    if (replay.truncated) send(server, { type: "resync" });
    for (const event of replay.events ?? []) {
      if (!eventVisibleTo(event, scope)) continue;
      const eventCursor = realtimeCursor(event);
      send(server, { type: "event", cursor: eventCursor, event });
      sent.add(event.id);
      if (compareCursor(eventCursor, cursor) > 0) cursor = eventCursor;
    }
    // A resuming client gets every recently announced event the replay did not carry (it
    // drops repeats by id); a fresh one, which has just loaded its data, only the newest.
    const recentFloor = replay.cursor ? "" : cursor;
    for (const entry of this.recent) {
      if (sent.has(entry.event.id) || compareCursor(entry.cursor, recentFloor) <= 0) continue;
      if (!eventVisibleTo(entry.event, scope)) continue;
      send(server, { type: "event", cursor: entry.cursor, event: entry.event });
      sent.add(entry.event.id);
      if (compareCursor(entry.cursor, cursor) > 0) cursor = entry.cursor;
    }
    send(server, { type: "ready", cursor });
    return realtimeHubRuntime.upgradeResponse(client);
  }

  webSocketMessage(socket: HubSocket, message: string | ArrayBuffer) {
    // Runtimes without auto-response still answer heartbeats.
    if (message === "ping") socket.send("pong");
  }

  webSocketClose(socket: HubSocket, code: number, reason: string) {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  webSocketError(socket: HubSocket) {
    try {
      socket.close(1011, "Socket error");
    } catch {
      // Already closed.
    }
  }
}

function socketScope(socket: HubSocket) {
  try {
    const value = socket.deserializeAttachment() as RealtimeSocketScope | null;
    return value && typeof value.tenantId === "string" ? value : null;
  } catch {
    return null;
  }
}

function send(socket: HubSocket, message: RealtimeServerMessage) {
  return sendText(socket, JSON.stringify(message));
}

function sendText(socket: HubSocket, text: string) {
  try {
    socket.send(text);
    return true;
  } catch {
    return false;
  }
}

function parseHeader<T>(request: Request, name: string): T | null {
  const value = request.headers.get(name);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
