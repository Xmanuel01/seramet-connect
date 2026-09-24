import type {
  CookbookDraftInput,
  CookbookMedia,
  CookbookMethodStep,
  CookbookPublishInput,
} from "@/cookbook/schemas";
import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

type RecipeRow = {
  id: string;
  name: string | null;
  menu_item_id: string;
  production_item_id: string | null;
  branch_override_id: string | null;
  current_version_id: string | null;
  version: number | null;
  yield_quantity_minor: number | null;
  yield_unit_id: string | null;
  yield_unit_symbol: string | null;
  menu_item_code: string | null;
  menu_item_name: string | null;
  production_item_code: string | null;
  production_item_name: string | null;
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
  created_by_name: string | null;
  created_at: string;
  idempotency_key: string | null;
};

type ComponentRow = {
  id: string;
  inventory_item_id: string | null;
  sub_recipe_id: string | null;
  quantity_minor: number;
  unit_id: string;
  waste_factor_bps: number;
  optional: number;
  station_id: string | null;
  unit_symbol: string | null;
  inventory_item_code: string | null;
  inventory_item_name: string | null;
  sub_recipe_name: string | null;
};

export class CookbookService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async overview(branchId: string) {
    this.require(permissions.cookbookView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
    const recipes = await this.db
      .prepare(
        `SELECT r.id,r.name,r.menu_item_id,r.production_item_id,r.branch_override_id,
                r.current_version_id,rv.version,rv.yield_quantity_minor,rv.yield_unit_id,
                u.symbol AS yield_unit_symbol,m.code AS menu_item_code,m.name AS menu_item_name,
                p.code AS production_item_code,p.name AS production_item_name
           FROM recipes r
           LEFT JOIN recipe_versions rv
             ON rv.tenant_id=r.tenant_id AND rv.id=r.current_version_id
           LEFT JOIN unit_definitions u
             ON u.tenant_id=rv.tenant_id AND u.id=rv.yield_unit_id
           LEFT JOIN menu_catalog_items m
             ON m.tenant_id=r.tenant_id AND m.id=r.menu_item_id
           LEFT JOIN inventory_items p
             ON p.tenant_id=r.tenant_id AND p.id=r.production_item_id
          WHERE r.tenant_id=? AND r.active=1 AND r.current_version_id IS NOT NULL
            AND (r.branch_override_id IS NULL OR r.branch_override_id=?)
            AND NOT (
              r.branch_override_id IS NULL
              AND EXISTS (
                SELECT 1 FROM recipes o
                 WHERE o.tenant_id=r.tenant_id AND o.active=1 AND o.branch_override_id=?
                   AND (
                     (r.production_item_id IS NULL AND o.production_item_id IS NULL
                       AND o.menu_item_id=r.menu_item_id)
                     OR
                     (r.production_item_id IS NOT NULL
                       AND o.production_item_id=r.production_item_id)
                   )
              )
            )
          ORDER BY COALESCE(r.name,m.name,p.name),r.id`,
      )
      .bind(this.actor.tenantId, branchId, branchId)
      .all<RecipeRow>();

    const content = await this.db
      .prepare(
        `SELECT c.*,u.name AS created_by_name
           FROM cookbook_recipe_content_versions c
           LEFT JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.created_by
           JOIN recipes r ON r.tenant_id=c.tenant_id AND r.id=c.recipe_id
          WHERE c.tenant_id=? AND c.recipe_version_id=r.current_version_id
            AND r.active=1
            AND (r.branch_override_id IS NULL OR r.branch_override_id=?)
          ORDER BY c.recipe_id,c.revision DESC,c.created_at DESC`,
      )
      .bind(this.actor.tenantId, branchId)
      .all<ContentRow>();

    const byRecipe = new Map<
      string,
      { draft: ReturnType<typeof normalizeContent> | null; published: ReturnType<typeof normalizeContent> | null }
    >();
    for (const row of content.results ?? []) {
      const current = byRecipe.get(row.recipe_id) ?? { draft: null, published: null };
      if (row.status === "DRAFT" && !current.draft) current.draft = normalizeContent(row);
      if (row.status === "PUBLISHED" && !current.published) {
        current.published = normalizeContent(row);
      }
      byRecipe.set(row.recipe_id, current);
    }

    return {
      branchId,
      recipes: (recipes.results ?? []).map((recipe) => {
        const state = byRecipe.get(recipe.id) ?? { draft: null, published: null };
        return {
          ...recipe,
          target_name: targetName(recipe),
          target_code: targetCode(recipe),
          published: state.published,
          draft: state.draft,
          has_unpublished_changes:
            Boolean(state.draft) &&
            (!state.published || Number(state.draft?.revision) > Number(state.published.revision)),
          publication_status: state.published
            ? state.draft && state.draft.revision > state.published.revision
              ? "DRAFT_CHANGES"
              : "PUBLISHED"
            : state.draft
              ? "DRAFT_ONLY"
              : "MISSING",
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  async detail(branchId: string, recipeId: string) {
    this.require(permissions.cookbookView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
    const recipe = await this.visibleRecipe(branchId, recipeId);
    if (!recipe.current_version_id) {
      throw new ServerOperationError("VALIDATION_FAILED", 409, "Recipe has no active version");
    }

    const [components, currentContent, previousPublished] = await Promise.all([
      this.db
        .prepare(
          `SELECT c.id,c.inventory_item_id,c.sub_recipe_id,c.quantity_minor,c.unit_id,
                  c.waste_factor_bps,c.optional,c.station_id,u.symbol AS unit_symbol,
                  i.code AS inventory_item_code,i.name AS inventory_item_name,
                  s.name AS sub_recipe_name
             FROM recipe_version_components c
             LEFT JOIN unit_definitions u
               ON u.tenant_id=c.tenant_id AND u.id=c.unit_id
             LEFT JOIN inventory_items i
               ON i.tenant_id=c.tenant_id AND i.id=c.inventory_item_id
             LEFT JOIN recipes s
               ON s.tenant_id=c.tenant_id AND s.id=c.sub_recipe_id
            WHERE c.tenant_id=? AND c.recipe_version_id=?
            ORDER BY COALESCE(i.name,s.name),c.id`,
        )
        .bind(this.actor.tenantId, recipe.current_version_id)
        .all<ComponentRow>(),
      this.db
        .prepare(
          `SELECT c.*,u.name AS created_by_name
             FROM cookbook_recipe_content_versions c
             LEFT JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.created_by
            WHERE c.tenant_id=? AND c.recipe_id=? AND c.recipe_version_id=?
            ORDER BY c.revision DESC,c.created_at DESC`,
        )
        .bind(this.actor.tenantId, recipe.id, recipe.current_version_id)
        .all<ContentRow>(),
      this.db
        .prepare(
          `SELECT c.*,u.name AS created_by_name
             FROM cookbook_recipe_content_versions c
             LEFT JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.created_by
            WHERE c.tenant_id=? AND c.recipe_id=? AND c.recipe_version_id<>?
              AND c.status='PUBLISHED'
            ORDER BY c.created_at DESC,c.revision DESC
            LIMIT 1`,
        )
        .bind(this.actor.tenantId, recipe.id, recipe.current_version_id)
        .first<ContentRow>(),
    ]);

    const history = (currentContent.results ?? []).map(normalizeContent);
    const draft = history.find((row) => row.status === "DRAFT") ?? null;
    const published = history.find((row) => row.status === "PUBLISHED") ?? null;

    return {
      branchId,
      recipe: {
        ...recipe,
        target_name: targetName(recipe),
        target_code: targetCode(recipe),
      },
      components: components.results ?? [],
      draft,
      published,
      previousPublished: previousPublished ? normalizeContent(previousPublished) : null,
      history: history.map((row) => ({
        id: row.id,
        revision: row.revision,
        status: row.status,
        changeSummary: row.changeSummary,
        createdBy: row.createdBy,
        createdByName: row.createdByName,
        createdAt: row.createdAt,
      })),
    };
  }

  async saveDraft(input: CookbookDraftInput) {
    this.require(permissions.cookbookManage);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const replay = await this.findByIdempotency(input.idempotencyKey);
    if (replay) return { ...normalizeContent(replay), duplicate: true };

    const recipe = await this.visibleRecipe(input.branchId, input.recipeId);
    if (recipe.current_version_id !== input.recipeVersionId) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "Cookbook content can only be edited against the recipe's active version",
      );
    }
    const revision = await this.nextRevision(input.recipeId, input.recipeVersionId);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO cookbook_recipe_content_versions
            (tenant_id,id,recipe_id,recipe_version_id,revision,status,prep_minutes,cook_minutes,
             portion_label,image_url,chef_notes,method_json,media_json,source_document,
             source_reference,change_summary,created_by,created_at,idempotency_key)
           VALUES (?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          JSON.stringify(input.media),
          input.sourceDocument ?? null,
          input.sourceReference ?? null,
          input.changeSummary ?? null,
          this.actor.id,
          stamp,
          input.idempotencyKey,
        ),
      this.auditStatement(
        "COOKBOOK_DRAFT_SAVED",
        id,
        input.branchId,
        correlationId,
        stamp,
        {
          recipeId: input.recipeId,
          recipeVersionId: input.recipeVersionId,
          revision,
        },
      ),
    ];

    try {
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.findByIdempotency(input.idempotencyKey);
      if (raced) return { ...normalizeContent(raced), duplicate: true };
      throw error;
    }

    const row = await this.contentById(id);
    if (!row) throw new Error("Cookbook draft was not persisted");
    return { ...normalizeContent(row), duplicate: false };
  }

  async publish(input: CookbookPublishInput) {
    this.require(permissions.cookbookPublish);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const replay = await this.findByIdempotency(input.idempotencyKey);
    if (replay) return { ...normalizeContent(replay), duplicate: true };

    const source = await this.contentById(input.contentVersionId);
    if (!source) {
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Cookbook draft not found");
    }
    if (source.status !== "DRAFT") {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "Only a draft cookbook revision can be published",
      );
    }
    const recipe = await this.visibleRecipe(input.branchId, source.recipe_id);
    if (recipe.current_version_id !== source.recipe_version_id) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "Recipe changed after this cookbook draft was created; review the current recipe first",
      );
    }

    const revision = await this.nextRevision(source.recipe_id, source.recipe_version_id);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO cookbook_recipe_content_versions
            (tenant_id,id,recipe_id,recipe_version_id,revision,status,prep_minutes,cook_minutes,
             portion_label,image_url,chef_notes,method_json,media_json,source_document,
             source_reference,change_summary,created_by,created_at,idempotency_key)
           VALUES (?,?,?,?,?,'PUBLISHED',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          input.changeSummary ?? source.change_summary,
          this.actor.id,
          stamp,
          input.idempotencyKey,
        ),
      this.auditStatement(
        "COOKBOOK_REVISION_PUBLISHED",
        id,
        input.branchId,
        correlationId,
        stamp,
        {
          recipeId: source.recipe_id,
          recipeVersionId: source.recipe_version_id,
          revision,
          sourceDraftId: source.id,
          sourceDraftRevision: source.revision,
        },
      ),
    ];

    try {
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.findByIdempotency(input.idempotencyKey);
      if (raced) return { ...normalizeContent(raced), duplicate: true };
      throw error;
    }

    const row = await this.contentById(id);
    if (!row) throw new Error("Published cookbook revision was not persisted");
    return { ...normalizeContent(row), duplicate: false };
  }

  private async visibleRecipe(branchId: string, recipeId: string) {
    const recipe = await this.db
      .prepare(
        `SELECT r.id,r.name,r.menu_item_id,r.production_item_id,r.branch_override_id,
                r.current_version_id,rv.version,rv.yield_quantity_minor,rv.yield_unit_id,
                u.symbol AS yield_unit_symbol,m.code AS menu_item_code,m.name AS menu_item_name,
                p.code AS production_item_code,p.name AS production_item_name
           FROM recipes r
           LEFT JOIN recipe_versions rv
             ON rv.tenant_id=r.tenant_id AND rv.id=r.current_version_id
           LEFT JOIN unit_definitions u
             ON u.tenant_id=rv.tenant_id AND u.id=rv.yield_unit_id
           LEFT JOIN menu_catalog_items m
             ON m.tenant_id=r.tenant_id AND m.id=r.menu_item_id
           LEFT JOIN inventory_items p
             ON p.tenant_id=r.tenant_id AND p.id=r.production_item_id
          WHERE r.tenant_id=? AND r.id=? AND r.active=1
            AND (r.branch_override_id IS NULL OR r.branch_override_id=?)`,
      )
      .bind(this.actor.tenantId, recipeId, branchId)
      .first<RecipeRow>();
    if (!recipe) throw new ServerOperationError("VALIDATION_FAILED", 404, "Recipe not found");
    return recipe;
  }

  private async nextRevision(recipeId: string, recipeVersionId: string) {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(MAX(revision),0) AS revision
           FROM cookbook_recipe_content_versions
          WHERE tenant_id=? AND recipe_id=? AND recipe_version_id=?`,
      )
      .bind(this.actor.tenantId, recipeId, recipeVersionId)
      .first<{ revision: number }>();
    return Number(row?.revision ?? 0) + 1;
  }

  private contentById(id: string) {
    return this.db
      .prepare(
        `SELECT c.*,u.name AS created_by_name
           FROM cookbook_recipe_content_versions c
           LEFT JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.created_by
          WHERE c.tenant_id=? AND c.id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<ContentRow>();
  }

  private findByIdempotency(idempotencyKey: string) {
    return this.db
      .prepare(
        `SELECT c.*,u.name AS created_by_name
           FROM cookbook_recipe_content_versions c
           LEFT JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.created_by
          WHERE c.tenant_id=? AND c.idempotency_key=?`,
      )
      .bind(this.actor.tenantId, idempotencyKey)
      .first<ContentRow>();
  }

  private auditStatement(
    action: string,
    entityId: string,
    branchId: string,
    correlationId: string,
    stamp: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
           correlation_id,session_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        branchId,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        "COOKBOOK_RECIPE_CONTENT",
        entityId,
        null,
        correlationId,
        this.actor.sessionId ?? null,
        JSON.stringify(metadata),
        stamp,
      );
  }

  private require(permission: string) {
    if (!this.actor.permissions.includes(permission as never)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        `${permission} permission is required`,
      );
    }
  }
}

function normalizeContent(row: ContentRow) {
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
    method: safeArray<CookbookMethodStep>(row.method_json),
    media: safeArray<CookbookMedia>(row.media_json),
    sourceDocument: row.source_document,
    sourceReference: row.source_reference,
    changeSummary: row.change_summary,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

function safeArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function targetName(recipe: RecipeRow) {
  return recipe.menu_item_name ?? recipe.production_item_name ?? recipe.name ?? recipe.id;
}

function targetCode(recipe: RecipeRow) {
  return recipe.menu_item_code ?? recipe.production_item_code ?? "";
}
