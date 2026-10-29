import { DatabaseSerializationError } from "@/server/errors";

// Only repeat rolled-back, idempotent authentication metadata writes, never a
// business transaction or an authorization decision.
export async function retryAuthMetadata<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (!(error instanceof DatabaseSerializationError) || attempt >= 4) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 25 * 2 ** attempt + Math.floor(Math.random() * 25)),
      );
    }
  }
}
