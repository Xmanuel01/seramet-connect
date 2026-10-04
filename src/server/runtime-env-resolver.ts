import type { SerametEnv } from "@/lib/seramet-auth";
import type { D1Database } from "@/server/database/d1";

let localDevelopmentDatabase: Promise<D1Database> | undefined;

/** Resolve identical environment bindings for fetch, Nitro Queue and Nitro Cron events. */
export async function resolveEnvironmentFromBindings(bindingsInput: unknown): Promise<SerametEnv> {
  const bindings =
    bindingsInput && typeof bindingsInput === "object"
      ? (bindingsInput as Record<string, unknown>)
      : {};

  const processEnvironment =
    typeof process !== "undefined" && process.env ? process.env : ({} as Record<string, string>);

  const resolved = {
    ...processEnvironment,
    ...bindings,
  } as SerametEnv;

  if (import.meta.env.DEV) {
    resolved.SERAMET_ENVIRONMENT ??= "development";

    resolved.SERAMET_ENABLE_DEV_AUTH ??= "false";
  }

  if (!resolved.SERAMET_DB && resolved.SERAMET_HYPERDRIVE) {
    const { PostgresD1Database } = await import("./database/postgres-database");

    resolved.SERAMET_DB = PostgresD1Database.fromHyperdrive(resolved.SERAMET_HYPERDRIVE);

    resolved.SERAMET_DATABASE_PROVIDER = "postgres";
  }

  if (import.meta.env.DEV) {
    if (
      !resolved.SERAMET_DB &&
      resolved.SERAMET_ENVIRONMENT === "development" &&
      (resolved.SERAMET_ENABLE_LOCAL_DATABASE === "true" || import.meta.env.DEV)
    ) {
      localDevelopmentDatabase ??= import("./database/local-development-database").then(
        ({ createLocalDevelopmentDatabase }) => createLocalDevelopmentDatabase(),
      );

      resolved.SERAMET_DB = await localDevelopmentDatabase;
    }

    if (
      resolved.SERAMET_ENVIRONMENT === "development" &&
      resolved.SERAMET_ENABLE_DEV_AUTH === "true" &&
      resolved.SERAMET_E2E_IMPORTS === "true" &&
      processEnvironment.CI === "true"
    ) {
      const { installE2EImportBindings } = await import("./e2e-import-bindings");
      installE2EImportBindings(resolved);
    }
  }

  return resolved;
}
