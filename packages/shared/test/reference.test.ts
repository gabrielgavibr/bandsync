import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeOEmbed,
  parseReferenceLink,
  referenceEmbedUrl,
  referenceLinkFrom,
  referenceOEmbedUrl,
  safeThumbnailUrl,
} from "../src/autoarrange/reference";
import { hasReferenceDependents, prepareSongSchema } from "../src/autoarrange/types";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "musicbrainz", name), "utf8"));

const ok = (input: string) => {
  const r = parseReferenceLink(input);
  if (!r.ok) throw new Error(`${input} -> ${r.reason}`);
  return r.link;
};
const problem = (input: string) => {
  const r = parseReferenceLink(input);
  return r.ok ? "accepted" : r.reason;
};

describe("reference links", () => {
  it("recognises the usual YouTube shapes and rebuilds a clean link", () => {
    for (const input of [
      "https://www.youtube.com/watch?v=JZqFoTIAJj8",
      "https://youtube.com/watch?v=JZqFoTIAJj8&list=PL123&index=4",
      "http://m.youtube.com/watch?feature=share&v=JZqFoTIAJj8",
      "https://youtu.be/JZqFoTIAJj8?si=AbCdEf&t=30",
      "https://www.youtube.com/embed/JZqFoTIAJj8",
      "https://www.youtube.com/shorts/JZqFoTIAJj8",
      "https://www.youtube.com/live/JZqFoTIAJj8?feature=share",
      "  https://WWW.YouTube.com/watch?v=JZqFoTIAJj8  ",
    ]) {
      expect(ok(input), input).toEqual({
        platform: "youtube",
        externalId: "JZqFoTIAJj8",
        url: "https://www.youtube.com/watch?v=JZqFoTIAJj8",
      });
    }
  });

  it("keeps YouTube Music apart from YouTube", () => {
    expect(ok("https://music.youtube.com/watch?v=JZqFoTIAJj8&feature=share")).toEqual({
      platform: "youtube_music",
      externalId: "JZqFoTIAJj8",
      url: "https://music.youtube.com/watch?v=JZqFoTIAJj8",
    });
    expect(problem("https://music.youtube.com/playlist?list=OLAK5uy_abc")).toBe("unsupported_link");
  });

  it("recognises Spotify track links, localised links and URIs", () => {
    const expected = {
      platform: "spotify",
      externalId: "4cOdK2wGLETKBW3PvgPWqT",
      url: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    };
    for (const input of [
      "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
      "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=0123456789abcdef",
      "https://open.spotify.com/intl-pt/track/4cOdK2wGLETKBW3PvgPWqT",
      "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT?utm_source=oembed",
      "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
    ]) {
      expect(ok(input), input).toEqual(expected);
    }
  });

  it("refuses anything that is not a plain http(s) link", () => {
    for (const input of [
      "",
      "   ",
      "Pérola Negra Natiruts",
      "javascript:alert(document.cookie)",
      "JAVASCRIPT:alert(1)//https://www.youtube.com/watch?v=JZqFoTIAJj8",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://www.youtube.com/abc",
      "ftp://youtu.be/JZqFoTIAJj8",
      "//www.youtube.com/watch?v=JZqFoTIAJj8",
      "www.youtube.com/watch?v=JZqFoTIAJj8",
      "https://user@www.youtube.com/watch?v=JZqFoTIAJj8",
      "https://www.youtube.com:444/watch?v=JZqFoTIAJj8",
      "https://www.youtube.com/watch?v=JZqFoTIAJj8 https://evil.example",
      "https://www.youtube.com/watch?v=JZqFoTIAJj8\u0000",
      `https://www.youtube.com/watch?v=JZqFoTIAJj8&x=${"a".repeat(2000)}`,
    ]) {
      expect(problem(input), JSON.stringify(input)).toBe("invalid_url");
    }
  });

  it("refuses sites without a connector, including look-alike hosts", () => {
    for (const input of [
      "https://vimeo.com/76979871",
      "https://soundcloud.com/artist/track",
      "https://www.deezer.com/br/track/3135556",
      "https://music.apple.com/br/album/x/1?i=2",
      "https://youtube.com.evil.example/watch?v=JZqFoTIAJj8",
      "https://notyoutube.com/watch?v=JZqFoTIAJj8",
      "https://evil.example/www.youtube.com/watch?v=JZqFoTIAJj8",
      "https://open.spotify.com.evil.example/track/4cOdK2wGLETKBW3PvgPWqT",
      "https://spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
      "http://127.0.0.1/watch?v=JZqFoTIAJj8",
      "http://[::1]/watch?v=JZqFoTIAJj8",
    ]) {
      expect(problem(input), input).toBe("unsupported_platform");
    }
  });

  it("refuses links of a supported site that are not one recording", () => {
    for (const input of [
      "https://www.youtube.com/",
      "https://www.youtube.com/playlist?list=PLabc",
      "https://www.youtube.com/@NatirutsVEVO",
      "https://www.youtube.com/results?search_query=perola+negra",
      "https://www.youtube.com/watch?v=tooShort",
      "https://www.youtube.com/watch?v=JZqFoTIAJj8<script>",
      "https://youtu.be/",
      "https://open.spotify.com/album/6N9PS4QXF1D0OWPk0Sxtb4",
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      "https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt",
      "https://open.spotify.com/episode/4cOdK2wGLETKBW3PvgPWqT",
      "https://open.spotify.com/track/short",
      "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT/extra",
      "spotify:album:6N9PS4QXF1D0OWPk0Sxtb4",
      "https://spotify.link/AbCdEfGhIj",
    ]) {
      expect(problem(input), input).toBe("unsupported_link");
    }
  });

  it("builds players and metadata endpoints only from platform and id", () => {
    expect(referenceEmbedUrl("youtube", "JZqFoTIAJj8")).toBe(
      "https://www.youtube-nocookie.com/embed/JZqFoTIAJj8",
    );
    expect(referenceEmbedUrl("youtube_music", "JZqFoTIAJj8")).toBe(
      "https://www.youtube-nocookie.com/embed/JZqFoTIAJj8",
    );
    expect(referenceEmbedUrl("spotify", "4cOdK2wGLETKBW3PvgPWqT")).toBe(
      "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT",
    );
    const bases = { youtube: "https://www.youtube.com", spotify: "https://open.spotify.com" };
    expect(referenceOEmbedUrl("youtube_music", "JZqFoTIAJj8", bases)).toBe(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DJZqFoTIAJj8&format=json",
    );
    expect(referenceOEmbedUrl("spotify", "4cOdK2wGLETKBW3PvgPWqT", bases)).toBe(
      "https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4cOdK2wGLETKBW3PvgPWqT",
    );
  });

  it("rebuilds stored links and ignores stored values that are not valid", () => {
    expect(referenceLinkFrom("spotify", "4cOdK2wGLETKBW3PvgPWqT")?.url).toBe(
      "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
    );
    expect(referenceLinkFrom("youtube", "JZqFoTIAJj8")?.platform).toBe("youtube");
    expect(referenceLinkFrom("youtube", '"><script>')).toBeNull();
    expect(referenceLinkFrom("vimeo", "76979871")).toBeNull();
    expect(referenceLinkFrom(null, "JZqFoTIAJj8")).toBeNull();
    expect(referenceLinkFrom("spotify", null)).toBeNull();
  });

  it("shows thumbnails only from the platforms' own image hosts", () => {
    expect(safeThumbnailUrl("https://i.ytimg.com/vi/JZqFoTIAJj8/hqdefault.jpg")).toBe(
      "https://i.ytimg.com/vi/JZqFoTIAJj8/hqdefault.jpg",
    );
    expect(safeThumbnailUrl("https://image-cdn-ak.spotifycdn.com/image/ab67")).toBeTruthy();
    expect(safeThumbnailUrl("https://i.scdn.co/image/ab67")).toBeTruthy();
    for (const bad of [
      "http://i.ytimg.com/vi/x/hqdefault.jpg",
      "https://ytimg.com.evil.example/x.jpg",
      "https://evil.example/i.ytimg.com/x.jpg",
      "javascript:alert(1)",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "https://i.ytimg.com:8443/x.jpg",
      null,
      42,
      undefined,
    ]) {
      expect(safeThumbnailUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("platform metadata (real oEmbed answers)", () => {
  it("reads title, channel and thumbnail of a YouTube video without calling the channel the artist", () => {
    const info = normalizeOEmbed(
      ok("https://youtu.be/JZqFoTIAJj8"),
      fixture("youtube-oembed-perola-negra.json"),
    );
    expect(info).toMatchObject({
      platform: "youtube",
      title:
        "Natiruts - Pérola Negra (Natiruts Acústico Ao Vivo no Rio de Janeiro) ft. Luiz Melodia",
      author: "NatirutsVEVO",
      artistGuess: null,
      thumbnailUrl: "https://i.ytimg.com/vi/JZqFoTIAJj8/hqdefault.jpg",
      embeddable: true,
      metadata: "complete",
    });
  });

  it("reports Spotify's answer as partial: a track title and cover, no artist, no duration", () => {
    const info = normalizeOEmbed(
      ok("spotify:track:4cOdK2wGLETKBW3PvgPWqT"),
      fixture("spotify-oembed-track.json"),
    );
    expect(info).toMatchObject({
      platform: "spotify",
      title: "Never Gonna Give You Up",
      author: null,
      artistGuess: null,
      metadata: "partial",
    });
    expect(info.thumbnailUrl).toMatch(/^https:\/\/image-cdn-[a-z]+\.spotifycdn\.com\/image\//);
  });

  // The answers below are written for the test (not captures) to cover shapes we did not record.
  it("takes the artist only from an auto-generated topic channel", () => {
    const link = ok("https://music.youtube.com/watch?v=JZqFoTIAJj8");
    expect(
      normalizeOEmbed(link, { title: "Esotérico", author_name: "Gilberto Gil - Topic" }),
    ).toMatchObject({
      title: "Esotérico",
      author: "Gilberto Gil - Topic",
      artistGuess: "Gilberto Gil",
    });
    expect(
      normalizeOEmbed(link, { title: "Esotérico", author_name: "Canal do João" }).artistGuess,
    ).toBeNull();
  });

  it("survives empty, odd and hostile answers", () => {
    const link = ok("https://youtu.be/JZqFoTIAJj8");
    for (const junk of [null, undefined, "text", 42, [], {}]) {
      expect(normalizeOEmbed(link, junk)).toMatchObject({
        title: null,
        author: null,
        thumbnailUrl: null,
        metadata: "missing",
      });
    }
    const hostile = normalizeOEmbed(link, {
      title: "   ",
      author_name: { toString: () => "x" },
      thumbnail_url: "javascript:alert(1)",
      html: '<iframe src="https://evil.example"></iframe>',
    });
    expect(hostile).toMatchObject({ title: null, author: null, thumbnailUrl: null });
    // The player always comes from platform and id, never from the answer's html.
    expect(hostile.url).toBe("https://www.youtube.com/watch?v=JZqFoTIAJj8");
    expect(JSON.stringify(hostile)).not.toContain("evil.example");
  });
});

describe("prepare request", () => {
  it("accepts a link-identified recording only together with a link", () => {
    const base = { newSong: { title: "Pérola Negra" }, recording: { source: "link" } };
    expect(prepareSongSchema.safeParse(base).success).toBe(false);
    expect(
      prepareSongSchema.safeParse({ ...base, referenceUrl: "https://youtu.be/JZqFoTIAJj8" })
        .success,
    ).toBe(true);
    // The older field name still works.
    expect(
      prepareSongSchema.safeParse({ ...base, youtubeUrl: "https://youtu.be/JZqFoTIAJj8" }).success,
    ).toBe(true);
  });

  it("knows what makes replacing a reference a decision", () => {
    const none = {
      analyses: 0,
      audioAssets: 0,
      confirmedValues: [],
      sections: 0,
      readyMaterials: 0,
    };
    expect(hasReferenceDependents(none)).toBe(false);
    expect(hasReferenceDependents({ ...none, confirmedValues: ["band_bpm"] })).toBe(true);
    expect(hasReferenceDependents({ ...none, analyses: 1 })).toBe(true);
    expect(hasReferenceDependents({ ...none, audioAssets: 1 })).toBe(true);
    expect(hasReferenceDependents({ ...none, sections: 3 })).toBe(true);
    expect(hasReferenceDependents({ ...none, readyMaterials: 1 })).toBe(true);
  });
});
