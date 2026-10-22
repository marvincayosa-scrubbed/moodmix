import { test } from "node:test";
import assert from "node:assert/strict";
import { matchingItunesMedia, isAudioPreview } from "../lib/artwork";
import { GET } from "../app/api/preview/route";
import { GET as artwork } from "../app/api/artwork/route";
const item = {
  kind: "song",
  trackName: "Holocene",
  artistName: "Bon Iver",
  artworkUrl100: "https://is1-ssl.mzstatic.com/image.jpg",
  previewUrl:
    "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/clip.m4a",
  trackViewUrl: "https://music.apple.com/us/album/holocene/123?i=456",
};
test("iTunes previews require exact title and artist, safe audio and store URLs", () => {
  const matched = matchingItunesMedia([item], "HOLOCENE!", "Bon Iver");
  assert.deepEqual(matched, {
    artwork: item.artworkUrl100,
    preview: { url: item.previewUrl, storeUrl: item.trackViewUrl },
  });
  assert.ok(isAudioPreview(matched.preview));
  for (const entry of [
    { ...item, trackName: "Holocene Live" },
    { ...item, artistName: "Cover Artist" },
    { ...item, kind: "music-video" },
  ])
    assert.equal(
      matchingItunesMedia([entry], "Holocene", "Bon Iver").preview,
      null,
    );
  for (const previewUrl of [
    "http://audio-ssl.itunes.apple.com/clip.m4a",
    "https://evil.test/clip.m4a",
    "https://audio-ssl.itunes.apple.com.evil.test/clip.m4a",
    "javascript:alert(1)",
    "data:audio/wav;base64,",
    "https://user:secret@audio-ssl.itunes.apple.com/clip.m4a",
  ])
    assert.equal(
      matchingItunesMedia([{ ...item, previewUrl }], "Holocene", "Bon Iver")
        .preview,
      null,
    );
  for (const trackViewUrl of [
    undefined,
    "https://evil.test/song",
    "http://music.apple.com/song",
  ])
    assert.equal(
      matchingItunesMedia([{ ...item, trackViewUrl }], "Holocene", "Bon Iver")
        .preview,
      null,
    );
  assert.equal(
    matchingItunesMedia(
      [{ ...item, previewUrl: undefined }],
      "Holocene",
      "Bon Iver",
    ).artwork,
    item.artworkUrl100,
  );
  assert.equal(
    matchingItunesMedia(
      [{ ...item, artworkUrl100: undefined }],
      "Holocene",
      "Bon Iver",
    ).preview?.url,
    item.previewUrl,
  );
  assert.equal(
    matchingItunesMedia([null, {}, "bad"], "Holocene", "Bon Iver").preview,
    null,
  );
  assert.equal(
    matchingItunesMedia(
      [{ ...item, trackName: "!", artistName: "?" }],
      "!",
      "?",
    ).preview,
    null,
  );
  assert.ok(
    !isAudioPreview({ url: item.previewUrl, storeUrl: "https://evil.test" }),
  );
});
test("public preview API has no credential or generation dependency", async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const req = (query = "title=Holocene&artist=Bon%20Iver") =>
    new Request(`http://localhost/api/preview?${query}`);
  await t.test("invalid input makes no upstream calls", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return Response.json({});
    };
    for (const q of [
      "title=x",
      "artist=x",
      "title=%20&artist=x",
      `title=${"a".repeat(201)}&artist=x`,
    ])
      assert.equal((await GET(req(q))).status, 400);
    assert.equal(calls, 0);
  });
  await t.test(
    "valid lookup calls public iTunes without authorization and returns only matched preview",
    async () => {
      let calls = 0;
      global.fetch = async (input, options) => {
        calls++;
        const url = new URL(String(input));
        assert.equal(url.origin, "https://itunes.apple.com");
        assert.equal(url.searchParams.get("term"), "Holocene Bon Iver");
        assert.equal(url.searchParams.get("entity"), "song");
        assert.equal(new Headers(options?.headers).get("authorization"), null);
        assert.ok(options?.signal);
        return Response.json({ results: [item] });
      };
      const r = await GET(req());
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), {
        preview: { url: item.previewUrl, storeUrl: item.trackViewUrl },
      });
      assert.equal(calls, 1);
    },
  );
  await t.test(
    "unmatched song or missing preview gives a graceful null",
    async () => {
      for (const entry of [
        { ...item, artistName: "Other Artist" },
        { ...item, previewUrl: undefined },
      ]) {
        global.fetch = async () => Response.json({ results: [entry] });
        const r = await GET(req());
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { preview: null });
      }
    },
  );
  await t.test(
    "artwork remains available without an audio sample",
    async () => {
      global.fetch = async () =>
        Response.json({ results: [{ ...item, previewUrl: undefined }] });
      assert.deepEqual(await (await artwork(req())).json(), {
        artwork: item.artworkUrl100,
      });
    },
  );
  for (const status of [403, 429, 500])
    await t.test(
      `iTunes ${status} returns safe error without retries`,
      async () => {
        let calls = 0;
        global.fetch = async () => {
          calls++;
          return new Response("private provider response", { status });
        };
        const r = await GET(req());
        assert.equal(r.status, 503);
        assert.equal((await r.json()).error.code, "PREVIEW_UNAVAILABLE");
        assert.equal(calls, 1);
      },
    );
  await t.test("timeout returns unavailable without retries", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw new DOMException("Timeout", "TimeoutError");
    };
    assert.equal((await GET(req())).status, 503);
    assert.equal(calls, 1);
  });
  await t.test("malformed provider result returns unavailable", async () => {
    global.fetch = async () => Response.json({ unexpected: "value" });
    assert.equal((await GET(req())).status, 503);
  });
});
