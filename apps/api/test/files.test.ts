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

  it("serves byte ranges of a private audio file, to members only", async () => {
    const s = await register();
    const outsider = await register();
    const bandId = await createBand(s);
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const form = new FormData();
    form.set("file", new File([bytes], "ensaio.mp3", { type: "audio/mpeg" }));
    const { file } = await json(
      await SELF.fetch(`${BASE}/api/bands/${bandId}/files`, {
        method: "POST",
        body: form,
        headers: { cookie: s.cookie },
      }),
    );
    const get = (range: string | null, cookie = s.cookie) =>
      SELF.fetch(`${BASE}${file.url}`, {
        headers: { cookie, ...(range ? { range } : {}) },
      });

    const whole = await get(null);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect((await whole.arrayBuffer()).byteLength).toBe(1000);

    // What iOS asks first, a jump into the middle, an open end and a suffix.
    const probe = await get("bytes=0-1");
    expect(probe.status).toBe(206);
    expect(probe.headers.get("content-range")).toBe("bytes 0-1/1000");
    expect(probe.headers.get("content-length")).toBe("2");
    expect([...new Uint8Array(await probe.arrayBuffer())]).toEqual([0, 1]);

    const middle = await get("bytes=500-509");
    expect(middle.status).toBe(206);
    expect(middle.headers.get("content-range")).toBe("bytes 500-509/1000");
    expect([...new Uint8Array(await middle.arrayBuffer())]).toEqual([...bytes.slice(500, 510)]);

    const tail = await get("bytes=990-");
    expect(tail.headers.get("content-range")).toBe("bytes 990-999/1000");
    expect((await tail.arrayBuffer()).byteLength).toBe(10);

    const suffix = await get("bytes=-4");
    expect(suffix.headers.get("content-range")).toBe("bytes 996-999/1000");

    const beyond = await get("bytes=900-5000");
    expect(beyond.headers.get("content-range")).toBe("bytes 900-999/1000");

    const unsatisfiable = await get("bytes=1000-");
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("content-range")).toBe("bytes */1000");

    // Permissions are checked on every partial request too.
    expect((await get("bytes=0-1", outsider.cookie)).status).toBe(404);
    expect(
      (await SELF.fetch(`${BASE}${file.url}`, { headers: { range: "bytes=0-1" } })).status,
    ).toBe(401);
  });
});
