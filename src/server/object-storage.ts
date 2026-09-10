import type { D1Database } from "@/server/database/d1";
import type { MalwareScanner, ObjectStoreBinding } from "@/server/environment";
import { ServerOperationError } from "@/server/errors";

export type StoredObjectClass =
  | "PUBLIC_ASSET"
  | "PRIVATE_DOCUMENT"
  | "IMPORT_QUARANTINE"
  | "EXPORT"
  | "BACKUP_METADATA"
  | "OTHER";

export type StoredObjectRecord = {
  tenant_id: string;
  id: string;
  branch_id: string | null;
  object_key: string;
  object_class: StoredObjectClass;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  status: "PENDING_SCAN" | "ACTIVE" | "QUARANTINED" | "DELETED";
  created_by: string;
  created_at: string;
  metadata_json: string;
};

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const maxBytes = 10 * 1024 * 1024;

export class TenantObjectStorage {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: ObjectStoreBinding,
    private readonly scanner?: MalwareScanner,
  ) {}

  async store(input: {
    tenantId: string;
    branchId?: string;
    actorId: string;
    objectClass: StoredObjectClass;
    fileName: string;
    contentType: string;
    bytes: ArrayBuffer;
  }) {
    if (!allowedTypes.has(input.contentType)) {
      throw new ServerOperationError("VALIDATION_FAILED", 415, "File type is not allowed");
    }
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxBytes) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        413,
        "File must be between 1 byte and 10 MB",
      );
    }
    const scan = this.scanner
      ? await this.scanner.scan({
          bytes: input.bytes,
          contentType: input.contentType,
          fileName: input.fileName,
        })
      : { status: "ERROR" as const };
    const productionLike = Boolean(this.scanner);
    if (scan.status === "INFECTED") {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        422,
        "File did not pass security scanning",
      );
    }
    if (productionLike && scan.status !== "CLEAN") {
      throw new ServerOperationError(
        "EXTERNAL_SERVICE_UNAVAILABLE",
        503,
        "File security scanning is temporarily unavailable",
      );
    }
    const id = crypto.randomUUID();
    const visibility = input.objectClass === "PUBLIC_ASSET" ? "public" : "private";
    const extension = safeExtension(input.fileName);
    const objectKey = `${input.tenantId}/${visibility}/${id}${extension}`;
    const checksum = await sha256(input.bytes);
    const stamp = new Date().toISOString();
    await this.bucket.put(objectKey, input.bytes, {
      httpMetadata: {
        contentType: input.contentType,
        cacheControl: visibility === "public" ? "public, max-age=3600" : "private, no-store",
      },
      customMetadata: { tenantId: input.tenantId, objectId: id, visibility, checksum },
    });
    try {
      await this.db
        .prepare(
          `INSERT INTO stored_objects
            (tenant_id,id,branch_id,object_key,object_class,content_type,size_bytes,
             checksum_sha256,status,created_by,created_at,deleted_at,metadata_json)
           VALUES (?,?,?,?,?,?,?,?, 'ACTIVE',?,?,NULL,?)`,
        )
        .bind(
          input.tenantId,
          id,
          input.branchId ?? null,
          objectKey,
          input.objectClass,
          input.contentType,
          input.bytes.byteLength,
          checksum,
          input.actorId,
          stamp,
          JSON.stringify({
            originalFileName: boundedFileName(input.fileName),
            scanReference: scan.reference ?? null,
          }),
        )
        .run();
    } catch (error) {
      await this.bucket.delete(objectKey).catch(() => undefined);
      throw error;
    }
    return {
      id,
      objectClass: input.objectClass,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
    };
  }

  async findPrivate(tenantId: string, id: string) {
    return this.db
      .prepare(
        `SELECT tenant_id,id,branch_id,object_key,object_class,content_type,size_bytes,
                checksum_sha256,status,created_by,created_at,metadata_json
         FROM stored_objects WHERE tenant_id=? AND id=? AND status='ACTIVE'`,
      )
      .bind(tenantId, id)
      .first<StoredObjectRecord>();
  }

  async findPublic(restaurantSlug: string, id: string) {
    return this.db
      .prepare(
        `SELECT o.tenant_id,o.id,o.branch_id,o.object_key,o.object_class,o.content_type,
                o.size_bytes,o.checksum_sha256,o.status,o.created_by,o.created_at,o.metadata_json
         FROM stored_objects o JOIN tenants t ON t.id=o.tenant_id
         WHERE t.slug=? AND t.active=1 AND o.id=? AND o.object_class='PUBLIC_ASSET'
           AND o.status='ACTIVE'`,
      )
      .bind(restaurantSlug, id)
      .first<StoredObjectRecord>();
  }

  async read(record: StoredObjectRecord) {
    const object = await this.bucket.get(record.object_key);
    if (!object) throw new ServerOperationError("DATABASE_UNAVAILABLE", 404, "File is unavailable");
    const body = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : undefined);
    if (!body)
      throw new ServerOperationError(
        "DATABASE_UNAVAILABLE",
        503,
        "Stored file body is unavailable",
      );
    return { body, contentType: object.httpMetadata?.contentType ?? record.content_type };
  }
}

function safeExtension(fileName: string) {
  const match = /\.[a-z0-9]{1,8}$/i.exec(fileName.trim());
  return match ? match[0]!.toLowerCase() : "";
}

function boundedFileName(value: string) {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, 180);
}

async function sha256(value: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
