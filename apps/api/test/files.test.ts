import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, BASE, createBand, json, register } from "./helpers";

describe("files", () => {
  it("uploads to R2 and only members can download", async () => {
    const s = await register();
    const outsider = await register();
    const bandId = await createBand(s);
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "partitura.pdf", {
        type: "application/pdf",
      }),
    );
    const up = await SELF.fetch(`${BASE}/api/bands/${bandId}/files`, {
      method: "POST",
      body: form,
      headers: { cookie: s.cookie },
    });
    expect(up.status).toBe(201);
    const { file } = await json(up);
    expect(file.contentType).toBe("application/pdf");

    const dl = await api("GET", file.url, undefined, s.cookie);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/pdf");
    expect((await dl.arrayBuffer()).byteLength).toBe(5);

    expect((await api("GET", file.url, undefined, outsider.cookie)).status).toBe(404);
    expect((await api("GET", file.url)).status).toBe(401);

    const bad = new FormData();
    bad.set("file", new File(["<script>"], "x.html", { type: "text/html" }));
    const rej = await SELF.fetch(`${BASE}/api/bands/${bandId}/files`, {
      method: "POST",
      body: bad,
      headers: { cookie: s.cookie },
    });
    expect(rej.status).toBe(415);
  });
});
