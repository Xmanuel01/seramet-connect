import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

export type CookbookMethodStep = {
  step: number;
  title?: string;
  instruction: string;
  durationMinutes?: number;
  temperature?: string;
  checkpoint?: string;
};

export type CookbookMedia = {
  type: "IMAGE" | "VIDEO" | "DOCUMENT" | "LINK";
  url: string;
  label?: string;
};

export type CookbookDraftInput = {
  recipeId: string;
  recipeVersionId: string;
  prepMinutes: number;
  cookMinutes: number;
  portionLabel?: string;
  imageUrl?: string;
  chefNotes?: string;
  method: CookbookMethodStep[];
  media?: CookbookMedia[];
  sourceDocument?: string;
  sourceReference?: string;
  changeSummary: string;
};

export type CookbookPublishInput = {
  contentVersionId: string;
  changeSummary?: string;
};

export type CookbookCopyPreviousInput = {
  recipeId: string;
  targetRecipeVersionId: string;
  changeSummary?: string;
};

type ContentRow = {
  id: string;
  recipe_id: string;
  recipe_version_id: string;
  revision: number;
  status: "DRAFT" | "PUBLISHED";
  prep_minutes: number;
  cook_minutes: number;
  portion_label: string | null;
  image_url: string | null;
  chef_notes: string | null;
  method_json: string;
  media_json: string;
  source_document: string | null;
  source_reference: string | null;
  change_summary: string | null;
  created_by: string;
  created_at: string;
};

export class CookbookService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async library(branchId: string) {
    this.require(permissions.cookbookView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);

    const recipes = await this.db
      .prepare(
        "SELECT r.id,r.name,r.menu_item_id,r.production_item_id,r.branch_override_id," +
          " r.current_version_id,rv.version,rv.yield_quantity_minor,rv.yield_unit_id," +
          " u.symbol AS yield_unit_symbol,m.code AS menu_item_code,m.name AS menu_item_name," +
          " p.code AS production_item_code,p.name AS production_item_name" +
          " FROM recipes r" +
          " JOIN recipe_versions rv ON rv.tenant_id=r.tenant_id AND rv.id=r.current_version_id" +
          " LEFT JOIN unit_definitions u ON u.tenant_id=rv.tenant_id AND u.id=rv.yield_unit_id" +
          " LEFT JOIN menu_catalog_items m ON m.tenant_id=r.tenant_id AND m.id=r.menu_item_id" +
          " LEFT JOIN inventory_items p ON p.tenant_id=r.tenant_id AND p.id=r.production_item_id" +
          " WHERE r.tenant_id=? AND r.active=1 AND (r.branch_override_id IS NULL OR r.branch_override_id=?)" +
          " ORDER BY COALESCE(r.name,m.name,p.name),r.id",
      )
      .bind(this.actor.tenantId, branchId)
      .all<Record<string, unknown>>();

    const rows: Array<Record<string, unknown>> = [];
    for (const recipe of recipes.results ?? []) {
      const recipeId = String(recipe["id"]);
      const recipeVersionId = String(recipe["current_version_id"]);
      const [latest, published, ingredients, priorPublished] = await Promise.all([
        this.latestContent(recipeVersionId),
        this.latestContent(recipeVersionId, "PUBLISHED"),
        this.ingredients(recipeVersionId),
        this.previousPublished(recipeId, recipeVersionId),
      ]);
      rows.push({
        ...recipe,
        latestContent: latest ? serializeContent(latest) : null,
        publishedContent: published ? serializeContent(published) : null,
        ingredients,
        previousPublishedContent: priorPublished ? serializeContent(priorPublished) : null,
      });
    }
    return {
      branchId,
      recipes: rows,
      generatedAt: new Date().toISOString(),
    };
  }

  async history(recipeVersionId: string) {
    this.require(permissions.cookbookView);
    const recipe = await this.assertRecipeVersionAccessible(recipeVersionId);
    if (recipe.branch_override_id) {
      authorizeBranchRead(this.actor, this.actor.tenantId, recipe.branch_override_id);
    }
    const rows = await this.db
      .prepare(
        "SELECT * FROM cookbook_recipe_content_versions" +
          " WHERE tenant_id=? AND recipe_version_id=? ORDER BY revision DESC",
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .all<ContentRow>();
    return (rows.results ?? []).map(serializeContent);
  }

  async saveDraft(input: CookbookDraftInput) {
    this.require(permissions.cookbookManage);
    const recipe = await this.assertRecipeVersionAccessible(input.recipeVersionId, input.recipeId);
    if (recipe.branch_override_id) {
      authorizeBranchRead(this.actor, this.actor.tenantId, recipe.branch_override_id);
    }
    const revision = await this.nextRevision(input.recipeVersionId);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO cookbook_recipe_content_versions" +
            " (tenant_id,id,recipe_id,recipe_version_id,revision,status,prep_minutes,cook_minutes," +
            " portion_label,image_url,chef_notes,method_json,media_json,source_document," +
            " source_reference,change_summary,created_by,created_at)" +
            " VALUES (?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          this.actor.tenantId,
          id,
          input.recipeId,
          input.recipeVersionId,
          revision,
          input.prepMinutes,
          input.cookMinutes,
          input.portionLabel ?? null,
          input.imageUrl ?? null,
          input.chefNotes ?? null,
          JSON.stringify(input.method),
          JSON.stringify(input.media ?? []),
          input.sourceDocument ?? null,
          input.sourceReference ?? null,
          input.changeSummary,
          this.actor.id,
          stamp,
        ),
      this.audit("COOKBOOK_DRAFT_CREATED", id, recipe.branch_override_id, stamp, {
        recipeId: input.recipeId,
        recipeVersionId: input.recipeVersionId,
        revision,
      }),
    ]);
    return { id, recipeId: input.recipeId, recipeVersionId: input.recipeVersionId, revision };
  }

  async publish(input: CookbookPublishInput) {
    this.require(permissions.cookbookPublish);
    const source = await this.db
      .prepare("SELECT * FROM cookbook_recipe_content_versions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.contentVersionId)
      .first<ContentRow>();
    if (!source) {
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Cookbook draft not found");
    }
    const recipe = await this.assertRecipeVersionAccessible(
      source.recipe_version_id,
      source.recipe_id,
    );
    if (recipe.branch_override_id) {
      authorizeBranchRead(this.actor, this.actor.tenantId, recipe.branch_override_id);
    }
    const revision = await this.nextRevision(source.recipe_version_id);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const summary = input.changeSummary ?? source.change_summary ?? "Published cookbook revision";
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO cookbook_recipe_content_versions" +
            " (tenant_id,id,recipe_id,recipe_version_id,revision,status,prep_minutes,cook_minutes," +
            " portion_label,image_url,chef_notes,method_json,media_json,source_document," +
            " source_reference,change_summary,created_by,created_at)" +
            " VALUES (?,?,?,?,?,'PUBLISHED',?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          this.actor.tenantId,
          id,
          source.recipe_id,
          source.recipe_version_id,
          revision,
          source.prep_minutes,
          source.cook_minutes,
          source.portion_label,
          source.image_url,
          source.chef_notes,
          source.method_json,
          source.media_json,
          source.source_document,
          source.source_reference,
          summary,
          this.actor.id,
          stamp,
        ),
      this.audit("COOKBOOK_REVISION_PUBLISHED", id, recipe.branch_override_id, stamp, {
        recipeId: source.recipe_id,
        recipeVersionId: source.recipe_version_id,
        revision,
        sourceContentVersionId: source.id,
      }),
    ]);
    return { id, recipeId: source.recipe_id, recipeVersionId: source.recipe_version_id, revision };
  }

  async copyPreviousPublished(input: CookbookCopyPreviousInput) {
    this.require(permissions.cookbookManage);
    const recipe = await this.assertRecipeVersionAccessible(
      input.targetRecipeVersionId,
      input.recipeId,
    );
    if (recipe.branch_override_id) {
      authorizeBranchRead(this.actor, this.actor.tenantId, recipe.branch_override_id);
    }
    const previous = await this.previousPublished(input.recipeId, input.targetRecipeVersionId);
    if (!previous) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        404,
        "No published cookbook content exists on an earlier recipe version",
      );
    }
    const revision = await this.nextRevision(input.targetRecipeVersionId);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO cookbook_recipe_content_versions" +
            " (tenant_id,id,recipe_id,recipe_version_id,revision,status,prep_minutes,cook_minutes," +
            " portion_label,image_url,chef_notes,method_json,media_json,source_document," +
            " source_reference,change_summary,created_by,created_at)" +
            " VALUES (?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          this.actor.tenantId,
          id,
          input.recipeId,
          input.targetRecipeVersionId,
          revision,
          previous.prep_minutes,
          previous.cook_minutes,
          previous.portion_label,
          previous.image_url,
          previous.chef_notes,
          previous.method_json,
          previous.media_json,
          previous.source_document,
          previous.source_reference,
          input.changeSummary ?? "Copied from previous recipe version",
          this.actor.id,
          stamp,
        ),
      this.audit("COOKBOOK_PREVIOUS_REVISION_COPIED", id, recipe.branch_override_id, stamp, {
        recipeId: input.recipeId,
        recipeVersionId: input.targetRecipeVersionId,
        revision,
        sourceContentVersionId: previous.id,
        sourceRecipeVersionId: previous.recipe_version_id,
      }),
    ]);
    return { id, recipeId: input.recipeId, recipeVersionId: input.targetRecipeVersionId, revision };
  }

  private async ingredients(recipeVersionId: string) {
    const rows = await this.db
      .prepare(
        "SELECT c.id,c.inventory_item_id,c.sub_recipe_id,c.quantity_minor,c.unit_id," +
          " c.waste_factor_bps,c.optional,u.symbol AS unit_symbol," +
          " i.name AS inventory_item_name,s.name AS sub_recipe_name" +
          " FROM recipe_version_components c" +
          " LEFT JOIN unit_definitions u ON u.tenant_id=c.tenant_id AND u.id=c.unit_id" +
          " LEFT JOIN inventory_items i ON i.tenant_id=c.tenant_id AND i.id=c.inventory_item_id" +
          " LEFT JOIN recipes s ON s.tenant_id=c.tenant_id AND s.id=c.sub_recipe_id" +
          " WHERE c.tenant_id=? AND c.recipe_version_id=?" +
          " ORDER BY COALESCE(i.name,s.name),c.id",
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  private async latestContent(
    recipeVersionId: string,
    status?: "DRAFT" | "PUBLISHED",
  ): Promise<ContentRow | null> {
    const statement = status
      ? this.db.prepare(
          "SELECT * FROM cookbook_recipe_content_versions" +
            " WHERE tenant_id=? AND recipe_version_id=? AND status=?" +
            " ORDER BY revision DESC LIMIT 1",
        )
      : this.db.prepare(
          "SELECT * FROM cookbook_recipe_content_versions" +
            " WHERE tenant_id=? AND recipe_version_id=? ORDER BY revision DESC LIMIT 1",
        );
    return status
      ? statement.bind(this.actor.tenantId, recipeVersionId, status).first<ContentRow>()
      : statement.bind(this.actor.tenantId, recipeVersionId).first<ContentRow>();
  }

  private async previousPublished(recipeId: string, currentRecipeVersionId: string) {
    return this.db
      .prepare(
        "SELECT c.* FROM cookbook_recipe_content_versions c" +
          " JOIN recipe_versions rv ON rv.tenant_id=c.tenant_id AND rv.id=c.recipe_version_id" +
          " WHERE c.tenant_id=? AND c.recipe_id=? AND c.status='PUBLISHED'" +
          " AND c.recipe_version_id<>? ORDER BY rv.version DESC,c.revision DESC LIMIT 1",
      )
      .bind(this.actor.tenantId, recipeId, currentRecipeVersionId)
      .first<ContentRow>();
  }

  private async nextRevision(recipeVersionId: string) {
    const row = await this.db
      .prepare(
        "SELECT COALESCE(MAX(revision),0)+1 AS revision" +
          " FROM cookbook_recipe_content_versions WHERE tenant_id=? AND recipe_version_id=?",
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .first<{ revision: number }>();
    return row?.revision ?? 1;
  }

  private async assertRecipeVersionAccessible(recipeVersionId: string, recipeId?: string) {
    const row = await this.db
      .prepare(
        "SELECT r.id AS recipe_id,r.branch_override_id,rv.id AS recipe_version_id" +
          " FROM recipe_versions rv JOIN recipes r" +
          " ON r.tenant_id=rv.tenant_id AND r.id=rv.recipe_id" +
          " WHERE rv.tenant_id=? AND rv.id=? AND r.active=1",
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .first<{
        recipe_id: string;
        branch_override_id: string | null;
        recipe_version_id: string;
      }>();
    if (!row || (recipeId && row.recipe_id !== recipeId)) {
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Recipe version not found");
    }
    return row;
  }

  private require(permission: string) {
    if (!this.actor.permissions.includes(permission as never)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        permission + " permission is required",
      );
    }
  }

  private audit(
    action: string,
    entityId: string,
    branchId: string | null,
    stamp: string,
    metadata: Record<string, unknown>,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO audit_events" +
          " (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason," +
          " correlation_id,session_id,metadata_json,created_at)" +
          " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        branchId ?? this.actor.branchId ?? null,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        "COOKBOOK_CONTENT",
        entityId,
        null,
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        JSON.stringify(metadata),
        stamp,
      );
  }
}

function serializeContent(row: ContentRow) {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    recipeVersionId: row.recipe_version_id,
    revision: row.revision,
    status: row.status,
    prepMinutes: row.prep_minutes,
    cookMinutes: row.cook_minutes,
    portionLabel: row.portion_label,
    imageUrl: row.image_url,
    chefNotes: row.chef_notes,
    method: parseArray<CookbookMethodStep>(row.method_json),
    media: parseArray<CookbookMedia>(row.media_json),
    sourceDocument: row.source_document,
    sourceReference: row.source_reference,
    changeSummary: row.change_summary,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
