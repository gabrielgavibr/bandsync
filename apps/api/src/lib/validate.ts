import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors";

export async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new ApiError("validation_error", "invalid JSON body");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError(
      "validation_error",
      "invalid request",
      result.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
        message: i.message,
      })),
    );
  }
  return result.data;
}
