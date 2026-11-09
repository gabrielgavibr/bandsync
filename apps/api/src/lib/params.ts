import type { Context } from "hono";
import { notFound } from "./errors";

/** Reads a required path parameter. Sub-apps mounted with `app.route` do not carry parent param types. */
export function p(c: Context, name: string): string {
  const v = c.req.param(name);
  if (!v) throw notFound(name);
  return v;
}
