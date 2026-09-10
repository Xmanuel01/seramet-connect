import {
  authenticateSerametRequest,
  authorizeBranchRead,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { ServerOperationError } from "@/server/errors";
import { TenantObjectStorage, type StoredObjectClass } from "@/server/object-storage";

export async function handleObjectStorageApi(request: Request, env: SerametEnv) {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith("/api/seramet/files") &&
    !url.pathname.startsWith("/api/seramet/public/assets/")
  )
    return null;
  if (!env.SERAMET_DB || !env.SERAMET_OBJECTS) {
    throw new ServerOperationError(
      "EXTERNAL_SERVICE_UNAVAILABLE",
      503,
      "Object storage is unavailable",
    );
  }
  const storage = new TenantObjectStorage(
    env.SERAMET_DB,
    env.SERAMET_OBJECTS,
    env.SERAMET_MALWARE_SCANNER,
  );
  const publicMatch = /^\/api\/seramet\/public\/assets\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (publicMatch && request.method === "GET") {
    const record = await storage.findPublic(
      decodeURIComponent(publicMatch[1]!),
      decodeURIComponent(publicMatch[2]!),
    );
    if (!record) return new Response(null, { status: 404 });
    const object = await storage.read(record);
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        "cache-control": "public, max-age=3600",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const actor = await authenticateSerametRequest(request, env);
  if (url.pathname === "/api/seramet/files" && request.method === "POST") {
    requireAny(actor.permissions, [
      permissions.setupImport,
      permissions.digitalMenuManage,
      permissions.setupManage,
    ]);
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 10 * 1024 * 1024 + 64 * 1024) {
      throw new ServerOperationError("VALIDATION_FAILED", 413, "Upload is too large");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ServerOperationError("VALIDATION_FAILED", 400, "A file is required");
    const objectClass = parseObjectClass(form.get("objectClass"));
    const branchId = String(form.get("branchId") ?? "").trim() || undefined;
    if (branchId) authorizeBranchRead(actor, actor.tenantId, branchId);
    const stored = await storage.store({
      tenantId: actor.tenantId,
      ...(branchId ? { branchId } : {}),
      actorId: actor.id,
      objectClass,
      fileName: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
    });
    return Response.json({ ok: true, object: stored }, { status: 201 });
  }
  const privateMatch = /^\/api\/seramet\/files\/([^/]+)$/.exec(url.pathname);
  if (privateMatch && request.method === "GET") {
    requireAny(actor.permissions, [
      permissions.setupView,
      permissions.digitalMenuManage,
      permissions.auditView,
    ]);
    const record = await storage.findPrivate(actor.tenantId, decodeURIComponent(privateMatch[1]!));
    if (!record) return new Response(null, { status: 404 });
    if (record.branch_id) authorizeBranchRead(actor, actor.tenantId, record.branch_id);
    const object = await storage.read(record);
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        "cache-control": "private, no-store",
        "content-disposition": "attachment",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return new Response(null, { status: 405 });
}

function parseObjectClass(value: FormDataEntryValue | null): StoredObjectClass {
  const normalized = String(value ?? "");
  if (
    ["PUBLIC_ASSET", "PRIVATE_DOCUMENT", "IMPORT_QUARANTINE", "EXPORT", "OTHER"].includes(
      normalized,
    )
  ) {
    return normalized as StoredObjectClass;
  }
  throw new ServerOperationError("VALIDATION_FAILED", 400, "Invalid object class");
}

function requireAny(actual: string[], required: string[]) {
  if (!required.some((permission) => actual.includes(permission))) {
    throw new ServerOperationError("PERMISSION_DENIED", 403, "File access permission is required");
  }
}
