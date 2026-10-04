import type { D1Database } from "@/server/database/d1";
import type { ObjectStoreBinding } from "@/server/environment";
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
  object_version: string;
  scan_evidence_id: string | null;
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
    const permittedExtensions: Record<string, readonly string[]> = {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
      "application/pdf": [".pdf"],
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    };
    if (!permittedExtensions[input.contentType]?.includes(safeExtension(input.fileName))) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        415,
        "Filename extension does not match file type",
      );
    }
    assertFileSignature(input.contentType, input.bytes);
    const id = crypto.randomUUID();
    const visibility = input.objectClass === "PUBLIC_ASSET" ? "public" : "private";
    const extension = safeExtension(input.fileName);
    const objectKey = `${input.tenantId}/${visibility}/${id}${extension}`;
    const checksum = await sha256(input.bytes);
    const stamp = new Date().toISOString();
    const status = input.objectClass === "IMPORT_QUARANTINE" ? "PENDING_SCAN" : "ACTIVE";
    const storedObject = await this.bucket.put(objectKey, input.bytes, {
      httpMetadata: {
        contentType: input.contentType,
        cacheControl: visibility === "public" ? "public, max-age=3600" : "private, no-store",
      },
      customMetadata: { tenantId: input.tenantId, objectId: id, visibility, checksum },
    });
    const objectVersion = objectStoreVersion(storedObject, checksum);
    try {
      await this.db
        .prepare(
          `INSERT INTO stored_objects
            (tenant_id,id,branch_id,object_key,object_class,content_type,size_bytes,
             checksum_sha256,status,created_by,created_at,deleted_at,metadata_json,object_version)
           VALUES (?,?,?,?,?,?,?,?, ?,?,?,NULL,?,?)`,
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
          status,
          input.actorId,
          stamp,
          JSON.stringify({ originalFileName: boundedFileName(input.fileName) }),
          objectVersion,
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
      checksum,
      objectKey,
      objectVersion,
      status,
    };
  }

  async findQuarantine(tenantId: string, id: string) {
    return this.db
      .prepare(
        `SELECT tenant_id,id,branch_id,object_key,object_class,content_type,size_bytes,
                checksum_sha256,status,created_by,created_at,metadata_json,object_version,
                scan_evidence_id
         FROM stored_objects WHERE tenant_id=? AND id=? AND object_class='IMPORT_QUARANTINE'
           AND status IN ('PENDING_SCAN','QUARANTINED','ACTIVE')`,
      )
      .bind(tenantId, id)
      .first<StoredObjectRecord>();
  }

  async recordScan(input: {
    tenantId: string;
    id: string;
    clean: boolean;
    evidence: Record<string, unknown>;
  }) {
    await this.db
      .prepare(
        `UPDATE stored_objects SET status=?,scan_evidence_json=?,scan_evidence_id=?
         WHERE tenant_id=? AND id=? AND object_class='IMPORT_QUARANTINE'`,
      )
      .bind(
        input.clean ? "ACTIVE" : "QUARANTINED",
        JSON.stringify(input.evidence),
        typeof input.evidence["evidenceId"] === "string" ? input.evidence["evidenceId"] : null,
        input.tenantId,
        input.id,
      )
      .run();
  }

  async remove(tenantId: string, id: string) {
    const record = await this.findQuarantine(tenantId, id);
    if (!record) return;
    await this.bucket.delete(record.object_key);
    await this.db
      .prepare("UPDATE stored_objects SET status='DELETED',deleted_at=? WHERE tenant_id=? AND id=?")
      .bind(new Date().toISOString(), tenantId, id)
      .run();
  }

  async findPrivate(tenantId: string, id: string) {
    return this.db
      .prepare(
        `SELECT tenant_id,id,branch_id,object_key,object_class,content_type,size_bytes,
                checksum_sha256,status,created_by,created_at,metadata_json,object_version,
                scan_evidence_id
         FROM stored_objects
         WHERE tenant_id=? AND id=? AND status='ACTIVE'
           AND object_class<>'IMPORT_QUARANTINE'`,
      )
      .bind(tenantId, id)
      .first<StoredObjectRecord>();
  }

  async findPublic(restaurantSlug: string, id: string) {
    return this.db
      .prepare(
        `SELECT o.tenant_id,o.id,o.branch_id,o.object_key,o.object_class,o.content_type,
                o.size_bytes,o.checksum_sha256,o.status,o.created_by,o.created_at,o.metadata_json,
                o.object_version,o.scan_evidence_id
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
    if (
      object.customMetadata?.["tenantId"] !== record.tenant_id ||
      object.customMetadata?.["objectId"] !== record.id ||
      object.customMetadata?.["checksum"] !== record.checksum_sha256
    ) {
      throw new ServerOperationError(
        "DATABASE_UNAVAILABLE",
        409,
        "Stored file identity no longer matches its quarantine record",
      );
    }
    const remoteVersion = object.version ?? object.etag;
    if (remoteVersion && record.object_version !== remoteVersion) {
      throw new ServerOperationError(
        "DATABASE_UNAVAILABLE",
        409,
        "Stored file version no longer matches its quarantine record",
      );
    }
    const source = object.body ?? (object.arrayBuffer ? await object.arrayBuffer() : undefined);
    const body =
      source instanceof ArrayBuffer
        ? source
        : source
          ? await new Response(source).arrayBuffer()
          : undefined;
    if (!body)
      throw new ServerOperationError(
        "DATABASE_UNAVAILABLE",
        503,
        "Stored file body is unavailable",
      );
    if ((await sha256(body)) !== record.checksum_sha256) {
      throw new ServerOperationError(
        "DATABASE_UNAVAILABLE",
        409,
        "Stored file content no longer matches its quarantine fingerprint",
      );
    }
    return { body, contentType: object.httpMetadata?.contentType ?? record.content_type };
  }
}

function objectStoreVersion(value: unknown, checksum: string) {
  if (value && typeof value === "object") {
    const candidate = value as { version?: unknown; etag?: unknown };
    if (typeof candidate.version === "string" && candidate.version) return candidate.version;
    if (typeof candidate.etag === "string" && candidate.etag) return candidate.etag;
  }
  // The key is immutable and randomly generated. A checksum-derived version preserves
  // exact-object binding for compatible stores that do not expose native version IDs.
  return `sha256:${checksum}`;
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

/** Lightweight content sniffing supplements, but does not replace, antivirus scanning. */
function assertFileSignature(type: string, buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  let valid = false;
  switch (type) {
    case "image/jpeg":
      valid = starts(0xff, 0xd8, 0xff);
      break;
    case "image/png":
      valid = starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
      break;
    case "image/webp":
      valid =
        starts(0x52, 0x49, 0x46, 0x46) &&
        [8, 9, 10, 11].every((index, offset) => bytes[index] === [0x57, 0x45, 0x42, 0x50][offset]);
      break;
    case "application/pdf":
      valid = starts(0x25, 0x50, 0x44, 0x46, 0x2d);
      break;
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      valid = starts(0x50, 0x4b, 0x03, 0x04);
      break;
    case "text/csv":
      valid = !bytes.includes(0);
      break;
    default:
      valid = false;
  }
  if (!valid) {
    throw new ServerOperationError(
      "VALIDATION_FAILED",
      415,
      "File signature does not match its type",
    );
  }
}
