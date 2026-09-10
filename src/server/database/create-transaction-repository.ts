import { MemoryTransactionRepository, type TransactionRepository } from "@/lib/seramet-repository";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import type { D1Database } from "@/server/database/d1";

export function createTransactionRepository(db?: D1Database): TransactionRepository {
  if (db) return new D1AuthoritativeTransactionRepository(db);
  const runtime = typeof process !== "undefined" ? process.env["NODE_ENV"] : undefined;
  if (runtime !== "development" && runtime !== "test") {
    throw new Error("Authoritative transaction database is required outside development/test");
  }
  return new MemoryTransactionRepository();
}
