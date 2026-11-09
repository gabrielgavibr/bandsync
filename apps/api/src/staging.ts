/**
 * Staging entry point: the same application, with the built web app served from files embedded in
 * the Worker bundle (src/generated/webAssets.ts, produced by scripts/embed-web.mjs) instead of the
 * static-assets binding. Behaviour matches `not_found_handling: single-page-application`.
 */

import type { Env } from "./env";
import { webAssets } from "./generated/webAssets";
import app from "./index";

export { MusicBrainzGatewayDO } from "./durable/MusicBrainzGatewayDO";
export { PrepareJobDO } from "./durable/PrepareJobDO";
export { RehearsalSessionDO } from "./durable/RehearsalSessionDO";

const decoded = new Map<string, Uint8Array>();
function bytes(path: string, base64: string): Uint8Array {
  let b = decoded.get(path);
  if (!b) {
    const bin = atob(base64);
    b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) b[i] = bin.charCodeAt(i);
    decoded.set(path, b);
  }
  return b;
}

function serve(request: Request): Response {
  const url = new URL(request.url);
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  let asset = webAssets[path];
  // SPA fallback: unknown paths without a file extension get the app shell.
  if (!asset && !/\.[a-z0-9]+$/i.test(path)) {
    path = "/index.html";
    asset = webAssets[path];
  }
  if (!asset) return new Response("Not found", { status: 404 });
  const immutable = path.startsWith("/assets/");
  const headers = new Headers({
    "content-type": asset.type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  const body = request.method === "HEAD" ? null : bytes(path, asset.body);
  return new Response(body, { headers });
}

const embeddedAssets = {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => serve(new Request(input, init)),
};

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, { ...env, ASSETS: embeddedAssets as unknown as Fetcher }, ctx);
  },
};
